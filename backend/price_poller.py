import asyncio
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import yfinance as yf
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Holding, PriceSnapshot, PortfolioSnapshot, Portfolio, AssetType
import aiohttp

ET = ZoneInfo("America/New_York")

# In-memory cache of latest prices: {symbol: price}
latest_prices: dict[str, float] = {}
# Previous close prices for day-change calculation: {symbol: prev_close}
previous_closes: dict[str, float] = {}
# WebSocket connections to broadcast to
connected_clients: set = set()


def is_market_open() -> bool:
    now = datetime.now(ET)
    if now.weekday() >= 5:  # Saturday/Sunday
        return False
    market_open = now.replace(hour=9, minute=30, second=0, microsecond=0)
    market_close = now.replace(hour=16, minute=0, second=0, microsecond=0)
    return market_open <= now <= market_close


def get_tracked_symbols(db: Session) -> dict[str, str]:
    """Returns {symbol: asset_type} for all unique symbols across all portfolios."""
    holdings = db.query(Holding).all()
    return {h.symbol: h.asset_type for h in holdings}


async def fetch_stock_prices(symbols: list[str]) -> dict[str, float]:
    prices = {}
    if not symbols:
        return prices
    try:
        # yf.download is the most reliable source — always returns primary-exchange data.
        # fast_info can return stale or wrong-exchange prices for some tickers (e.g. BRK-B).
        raw = yf.download(
            " ".join(symbols),
            period="5d",
            progress=False,
            auto_adjust=True,
        )
        if not raw.empty:
            # yf.download always returns a MultiIndex DataFrame — index by symbol name
            close = raw["Close"]  # DataFrame: rows=dates, columns=ticker names
            for sym in symbols:
                if sym in close.columns:
                    series = close[sym].dropna()
                    if len(series) >= 1:
                        prices[sym] = float(series.iloc[-1])
                        if len(series) >= 2 and sym not in previous_closes:
                            previous_closes[sym] = float(series.iloc[-2])
    except Exception as e:
        print(f"[price fetch] download failed: {e}")

    # Fallback: fast_info for any symbols still missing
    missing = [s for s in symbols if s not in prices]
    if missing:
        try:
            tickers = yf.Tickers(" ".join(missing))
            for sym in missing:
                try:
                    info = tickers.tickers[sym].fast_info
                    price = getattr(info, "last_price", None)
                    prev = getattr(info, "previous_close", None)
                    if price:
                        prices[sym] = float(price)
                    if prev and sym not in previous_closes:
                        previous_closes[sym] = float(prev)
                except Exception:
                    pass
        except Exception:
            pass

    return prices


async def fetch_crypto_prices(symbols: list[str]) -> dict[str, float]:
    """Use CoinGecko for crypto. Symbols like BTC-USD, ETH-USD."""
    prices = {}
    if not symbols:
        return prices
    # Map BTC-USD -> bitcoin etc via CoinGecko
    coingecko_ids = {
        "BTC-USD": "bitcoin", "ETH-USD": "ethereum", "SOL-USD": "solana",
        "DOGE-USD": "dogecoin", "ADA-USD": "cardano", "XRP-USD": "ripple",
        "DOT-USD": "polkadot", "AVAX-USD": "avalanche-2", "MATIC-USD": "matic-network",
        "LINK-USD": "chainlink", "LTC-USD": "litecoin", "BCH-USD": "bitcoin-cash",
        "UNI-USD": "uniswap", "ATOM-USD": "cosmos", "FIL-USD": "filecoin",
    }
    ids_to_fetch = []
    sym_to_id = {}
    for sym in symbols:
        cg_id = coingecko_ids.get(sym)
        if cg_id:
            ids_to_fetch.append(cg_id)
            sym_to_id[cg_id] = sym
    if not ids_to_fetch:
        return prices
    try:
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={','.join(ids_to_fetch)}&vs_currencies=usd"
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                data = await resp.json()
                for cg_id, sym in sym_to_id.items():
                    if cg_id in data:
                        prices[sym] = data[cg_id]["usd"]
    except Exception:
        pass
    return prices


async def broadcast_prices(prices: dict[str, float]):
    if not connected_clients:
        return
    message = json.dumps({"type": "price_update", "prices": prices})
    dead = set()
    for ws in connected_clients:
        try:
            await ws.send_text(message)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)


async def snapshot_portfolio_values(db: Session, prices: dict[str, float]):
    portfolios = db.query(Portfolio).all()
    now = datetime.utcnow()
    for portfolio in portfolios:
        total = portfolio.cash_balance or 0.0
        for holding in portfolio.holdings:
            price = prices.get(holding.symbol, latest_prices.get(holding.symbol, 0))
            qty = sum(t.quantity for t in holding.transactions)
            total += price * qty
        snap = PortfolioSnapshot(portfolio_id=portfolio.id, total_value=total, recorded_at=now)
        db.add(snap)
    db.commit()


async def poll_prices():
    """Main polling loop.
    - Market open: fetch every 60 seconds.
    - Market closed: fetch once per hour to keep last-price fresh.
    """
    last_closed_fetch = 0.0
    while True:
        db = SessionLocal()
        try:
            symbol_map = get_tracked_symbols(db)
            if symbol_map:
                stock_syms = [s for s, t in symbol_map.items() if t != AssetType.CRYPTO]
                crypto_syms = [s for s, t in symbol_map.items() if t == AssetType.CRYPTO]

                market_open = is_market_open()
                import time
                now_ts = time.time()
                # Fetch stocks when open (every minute) OR when closed but >1 hour since last fetch
                should_fetch_stocks = market_open or (now_ts - last_closed_fetch > 3600)
                new_prices = {}

                if should_fetch_stocks and stock_syms:
                    new_prices.update(await fetch_stock_prices(stock_syms))
                    if not market_open:
                        last_closed_fetch = now_ts

                if crypto_syms:
                    new_prices.update(await fetch_crypto_prices(crypto_syms))

                if new_prices:
                    latest_prices.update(new_prices)

                    now = datetime.utcnow()
                    for sym, price in new_prices.items():
                        db.add(PriceSnapshot(symbol=sym, price=price, recorded_at=now))
                    db.commit()

                    await snapshot_portfolio_values(db, latest_prices)
                    await broadcast_prices(new_prices)
        except Exception as e:
            print(f"[poller] error: {e}")
        finally:
            db.close()

        await asyncio.sleep(60)


async def fetch_initial_prices(symbols: list[str], asset_types: dict[str, str]) -> dict[str, float]:
    """One-shot fetch for symbols that don't have a cached price yet."""
    stock_syms = [s for s in symbols if asset_types.get(s) != AssetType.CRYPTO]
    crypto_syms = [s for s in symbols if asset_types.get(s) == AssetType.CRYPTO]
    prices = {}
    if stock_syms:
        prices.update(await fetch_stock_prices(stock_syms))
    if crypto_syms:
        prices.update(await fetch_crypto_prices(crypto_syms))
    latest_prices.update(prices)
    return prices
