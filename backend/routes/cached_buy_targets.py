from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import yfinance as yf

from database import get_db
from models import BuyPriceTarget, Portfolio
import price_poller

router = APIRouter(prefix="/cached-buy-targets", tags=["cached_buy_targets"])

CAGR_USED = 20.0  # investor target annual return %


def compute_target_for_symbol(sym: str) -> Optional[dict]:
    """
    Compute buy price target using analyst consensus (primary) or DCF fallback.

    Primary: base_buy_price = analyst_target_mean / 1.20
    Interpretation: the price you must pay today to earn 20% return if the
    stock reaches the Wall Street 12-month consensus price target.

    The old DCF approach (fwd_eps * growth^5 * PE / 1.20^5) produced wildly
    inflated targets because yfinance earningsGrowth is a TTM figure —
    compounding AMD's 217% TTM growth for 5 years gave a $44k buy price.
    Analyst targets already embed realistic forward expectations so they are
    a much better anchor.
    """
    try:
        t = yf.Ticker(sym)
        info = t.info or {}

        current_price = (
            price_poller.latest_prices.get(sym)
            or float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
        )
        if current_price <= 0:
            return None

        fwd_eps = info.get("forwardEps") or info.get("trailingEps")
        fwd_eps = float(fwd_eps) if fwd_eps else None

        # ── Primary: analyst consensus target ─────────────────────────────
        analyst_target = info.get("targetMeanPrice") or info.get("targetMedianPrice")
        if analyst_target and float(analyst_target) > 0:
            analyst_target = float(analyst_target)
            # Price at which you earn exactly 20% if the stock hits analyst target
            base_buy_price = analyst_target / (1 + CAGR_USED / 100)
            method = "analyst"
        else:
            # ── Fallback: DCF with conservatively capped growth ───────────
            # Cap TTM earningsGrowth at 15% for 5-year projection.
            # TTM figures like NVDA 95% / AMD 217% are one-year anomalies;
            # no company sustains those rates for 5 consecutive years.
            if not fwd_eps or fwd_eps <= 0:
                return None

            eps_growth_rate: Optional[float] = None
            eg = info.get("earningsGrowth")
            if eg is not None:
                eps_growth_rate = min(float(eg) * 100, 15.0)

            if eps_growth_rate is None:
                try:
                    stmt = t.income_stmt
                    if stmt is not None and not stmt.empty:
                        eps_row = None
                        for label in ["Diluted EPS", "Basic EPS"]:
                            if label in stmt.index:
                                eps_row = stmt.loc[label].dropna()
                                break
                        if eps_row is not None and len(eps_row) >= 2:
                            pairs = sorted(
                                [(col, float(val)) for col, val in eps_row.items()],
                                key=lambda x: x[0],
                            )
                            positives = [(c, v) for c, v in pairs if v > 0]
                            if len(positives) >= 2:
                                first_v = positives[0][1]
                                last_v = positives[-1][1]
                                n = len(positives) - 1
                                eps_growth_rate = min(
                                    ((last_v / first_v) ** (1 / n) - 1) * 100,
                                    15.0,
                                )
                except Exception:
                    pass

            if eps_growth_rate is None:
                eps_growth_rate = 8.0
            eps_growth_rate = max(-20.0, eps_growth_rate)

            exit_pe = info.get("forwardPE") or info.get("trailingPE")
            if not exit_pe or float(exit_pe) <= 0 or float(exit_pe) > 100:
                exit_pe = 18.0
            exit_pe = float(exit_pe)

            future_value = fwd_eps * (1 + eps_growth_rate / 100) ** 5 * exit_pe
            base_buy_price = future_value / (1 + CAGR_USED / 100) ** 5
            analyst_target = None
            method = "dcf"

        if base_buy_price <= 0:
            return None

        ratio = current_price / base_buy_price
        if ratio < 0.80:
            signal = "strong_buy"
        elif ratio < 1.0:
            signal = "buy"
        elif ratio < 1.15:
            signal = "near_target"
        else:
            signal = "above_target"

        print(f"[buy-targets] {sym}: method={method} analyst_target={analyst_target} "
              f"base_buy={base_buy_price:.2f} current={current_price:.2f} signal={signal}")

        return {
            "symbol": sym,
            "base_buy_price": round(base_buy_price, 2),
            "forward_eps": round(fwd_eps, 4) if fwd_eps else None,
            "eps_cagr_pct": None,  # not applicable for analyst-target method
            "exit_pe": None,
            "current_price": round(current_price, 2),
            "signal": signal,
            "last_updated": datetime.utcnow(),
        }
    except Exception as e:
        print(f"[cached-buy-targets] {sym}: {e}")
        return None


def refresh_symbols_in_db(symbols: List[str], db: Session) -> int:
    """Refresh buy price targets for given symbols. Returns count refreshed."""
    refreshed = 0
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(compute_target_for_symbol, sym): sym for sym in symbols}
        for future in as_completed(futures):
            result = future.result()
            if result:
                sym = result["symbol"]
                existing = db.query(BuyPriceTarget).filter(BuyPriceTarget.symbol == sym).first()
                if existing:
                    for k, v in result.items():
                        if k != "symbol":
                            setattr(existing, k, v)
                else:
                    db.add(BuyPriceTarget(**result))
                refreshed += 1
    db.commit()
    return refreshed


@router.get("/")
def get_cached_targets(symbols: str, db: Session = Depends(get_db)):
    """Return cached buy price targets for a comma-separated list of symbols."""
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not sym_list:
        return []
    rows = db.query(BuyPriceTarget).filter(BuyPriceTarget.symbol.in_(sym_list)).all()
    return [
        {
            "symbol": r.symbol,
            "base_buy_price": r.base_buy_price,
            "forward_eps": r.forward_eps,
            "eps_cagr_pct": r.eps_cagr_pct,
            "exit_pe": r.exit_pe,
            "current_price": r.current_price,
            "signal": r.signal,
            "last_updated": r.last_updated.isoformat() if r.last_updated else None,
        }
        for r in rows
    ]


class RefreshRequest(BaseModel):
    symbols: Optional[List[str]] = None  # None = refresh all portfolio symbols


@router.post("/refresh")
def refresh_targets(body: RefreshRequest, db: Session = Depends(get_db)):
    """Refresh buy price targets using latest yfinance data (no API key required)."""
    if body.symbols:
        symbols = [s.upper() for s in body.symbols]
    else:
        sym_set: set = set()
        for p in db.query(Portfolio).all():
            for h in p.holdings:
                if h.asset_type != "cash":
                    sym_set.add(h.symbol)
        symbols = list(sym_set)

    if not symbols:
        return {"ok": True, "count": 0}

    count = refresh_symbols_in_db(symbols, db)
    return {"ok": True, "count": count, "symbols": symbols}
