from fastapi import APIRouter, Query
import yfinance as yf
import asyncio

router = APIRouter(prefix="/search", tags=["search"])

# Common crypto symbols for search
CRYPTO_SYMBOLS = [
    {"symbol": "BTC-USD", "name": "Bitcoin", "type": "crypto"},
    {"symbol": "ETH-USD", "name": "Ethereum", "type": "crypto"},
    {"symbol": "SOL-USD", "name": "Solana", "type": "crypto"},
    {"symbol": "DOGE-USD", "name": "Dogecoin", "type": "crypto"},
    {"symbol": "ADA-USD", "name": "Cardano", "type": "crypto"},
    {"symbol": "XRP-USD", "name": "XRP", "type": "crypto"},
    {"symbol": "DOT-USD", "name": "Polkadot", "type": "crypto"},
    {"symbol": "AVAX-USD", "name": "Avalanche", "type": "crypto"},
    {"symbol": "MATIC-USD", "name": "Polygon", "type": "crypto"},
    {"symbol": "LINK-USD", "name": "Chainlink", "type": "crypto"},
    {"symbol": "LTC-USD", "name": "Litecoin", "type": "crypto"},
    {"symbol": "BCH-USD", "name": "Bitcoin Cash", "type": "crypto"},
    {"symbol": "UNI-USD", "name": "Uniswap", "type": "crypto"},
    {"symbol": "ATOM-USD", "name": "Cosmos", "type": "crypto"},
]


@router.get("/")
async def search_symbols(q: str = Query(..., min_length=1)):
    q_lower = q.lower()

    # Check crypto first
    crypto_matches = [
        c for c in CRYPTO_SYMBOLS
        if q_lower in c["symbol"].lower() or q_lower in c["name"].lower()
    ]

    # Use yfinance search for stocks/ETFs
    stock_results = []
    try:
        results = await asyncio.to_thread(_yf_search, q)
        stock_results = results
    except Exception:
        pass

    return crypto_matches + stock_results


def _yf_search(query: str) -> list:
    try:
        search = yf.Search(query, max_results=10)
        results = []
        for r in (search.quotes or []):
            sym = r.get("symbol", "")
            name = r.get("longname") or r.get("shortname") or sym
            q_type = r.get("quoteType", "").upper()
            if q_type == "ETF":
                asset_type = "etf"
            elif q_type == "MUTUALFUND":
                asset_type = "mutual_fund"
            elif q_type == "CRYPTOCURRENCY":
                asset_type = "crypto"
            else:
                asset_type = "stock"
            results.append({"symbol": sym, "name": name, "type": asset_type})
        return results
    except Exception:
        return []
