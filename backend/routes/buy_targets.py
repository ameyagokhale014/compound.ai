from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from concurrent.futures import ThreadPoolExecutor, as_completed
import yfinance as yf

from database import get_db
from models import Portfolio, Holding
from price_poller import latest_prices

router = APIRouter()


def fetch_target_info(symbol: str) -> dict:
    try:
        info = yf.Ticker(symbol).info
        return {
            "symbol": symbol,
            "target_mean": info.get("targetMeanPrice"),
            "target_low": info.get("targetLowPrice"),
            "target_high": info.get("targetHighPrice"),
            "forward_eps": info.get("forwardEps"),
            "earnings_growth": info.get("earningsGrowth"),
            "recommendation": info.get("recommendationKey", "n/a"),
            "num_analysts": info.get("numberOfAnalystOpinions"),
        }
    except Exception:
        return {"symbol": symbol}


@router.get("/portfolios/{portfolio_id}/buy-targets")
def get_buy_targets(portfolio_id: int, cagr: float = 15.0, db: Session = Depends(get_db)):
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Only non-cash, non-crypto holdings (analyst targets exist for stocks/ETFs)
    holdings = [
        h for h in portfolio.holdings
        if h.asset_type not in ("cash",)
    ]

    symbols = list({h.symbol for h in holdings})

    # Fetch analyst data in parallel
    analyst_data: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(fetch_target_info, sym): sym for sym in symbols}
        for future in as_completed(futures):
            result = future.result()
            analyst_data[result["symbol"]] = result

    multiplier = 1 + cagr / 100.0
    results = []

    for h in holdings:
        data = analyst_data.get(h.symbol, {})
        current = latest_prices.get(h.symbol, 0)

        target_mean = data.get("target_mean")
        target_low = data.get("target_low")
        target_high = data.get("target_high")
        recommendation = data.get("recommendation", "n/a")
        num_analysts = data.get("num_analysts")

        if target_mean and target_mean > 0:
            ideal_mean = target_mean / multiplier
            ideal_low = (target_low / multiplier) if target_low else None
            ideal_high = (target_high / multiplier) if target_high else None
            upside_from_analyst = ((target_mean - current) / current * 100) if current else None

            # Signal based on how current price compares to ideal buy price
            if current <= ideal_mean * 1.02:
                signal = "strong_buy"
            elif current <= ideal_mean * 1.15:
                signal = "fair"
            else:
                signal = "overvalued"

            results.append({
                "holding_id": h.id,
                "symbol": h.symbol,
                "current_price": current,
                "ideal_buy_low": round(ideal_low, 2) if ideal_low else None,
                "ideal_buy_mean": round(ideal_mean, 2),
                "ideal_buy_high": round(ideal_high, 2) if ideal_high else None,
                "analyst_target_mean": target_mean,
                "analyst_target_low": target_low,
                "analyst_target_high": target_high,
                "upside_from_analyst_pct": round(upside_from_analyst, 1) if upside_from_analyst is not None else None,
                "signal": signal,
                "recommendation": recommendation,
                "num_analysts": num_analysts,
                "cagr_used": cagr,
            })
        else:
            results.append({
                "holding_id": h.id,
                "symbol": h.symbol,
                "current_price": current,
                "signal": "no_data",
                "cagr_used": cagr,
            })

    return results
