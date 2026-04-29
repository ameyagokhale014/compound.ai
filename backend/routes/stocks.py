from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import json
import os
import requests
import yfinance as yf
import pandas as pd

from database import get_db
from models import StockDataCache
import price_poller

router = APIRouter(prefix="/stocks", tags=["stocks"])

FMP_KEY = os.environ.get("FMP_API_KEY", "")
FMP_BASE = "https://financialmodelingprep.com/api/v3"
CACHE_TTL = timedelta(hours=24)


def _fmp(path: str, params: dict = {}):
    if not FMP_KEY:
        return []
    try:
        r = requests.get(f"{FMP_BASE}{path}", params={**params, "apikey": FMP_KEY}, timeout=12)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"[stocks] FMP {path}: {e}")
        return []


def _fetch_fmp(symbol: str) -> dict:
    data: dict = {}

    profile = _fmp(f"/profile/{symbol}")
    if isinstance(profile, list) and profile:
        data["profile"] = profile[0]

    income = _fmp(f"/income-statement/{symbol}", {"limit": 10})
    if isinstance(income, list):
        data["income_statement"] = income

    cf = _fmp(f"/cash-flow-statement/{symbol}", {"limit": 10})
    if isinstance(cf, list):
        data["cash_flow"] = cf

    km = _fmp(f"/key-metrics/{symbol}", {"limit": 10})
    if isinstance(km, list):
        data["key_metrics"] = km

    seg = _fmp(f"/revenue-product-segmentation", {"symbol": symbol, "period": "annual"})
    if isinstance(seg, list):
        data["revenue_segments"] = seg

    rec = _fmp(f"/analyst-stock-recommendations/{symbol}")
    if isinstance(rec, list):
        data["analyst_recommendations"] = rec[:8]

    pt = _fmp(f"/price-target/{symbol}")
    if isinstance(pt, list):
        data["price_targets"] = pt[:8]

    return data


def _fetch_yf_financials(symbol: str) -> dict:
    """Pull annual income statement, cash flow from yfinance and format FMP-compatible."""
    t = yf.Ticker(symbol)
    result: dict = {}

    # ── Income statement ──────────────────────────────────────────────────────
    try:
        stmt = t.income_stmt  # rows=metrics, cols=dates (most recent first)
        if stmt is not None and not stmt.empty:
            INCOME_MAP = {
                "Total Revenue": "revenue",
                "Gross Profit": "grossProfit",
                "Operating Income": "operatingIncome",
                "Net Income": "netIncome",
                "EBITDA": "ebitda",
                "Diluted EPS": "epsDiluted",
                "Basic EPS": "eps",
            }
            rows = []
            for col in stmt.columns[:10]:
                row: dict = {"date": str(col.date())}
                for yf_key, fmp_key in INCOME_MAP.items():
                    if yf_key in stmt.index:
                        val = stmt.loc[yf_key, col]
                        if val is not None and not pd.isna(val):
                            row[fmp_key] = float(val)
                if "revenue" in row and row["revenue"] != 0:
                    if "grossProfit" in row:
                        row["grossProfitRatio"] = row["grossProfit"] / row["revenue"]
                    if "operatingIncome" in row:
                        row["operatingIncomeRatio"] = row["operatingIncome"] / row["revenue"]
                    if "netIncome" in row:
                        row["netIncomeRatio"] = row["netIncome"] / row["revenue"]
                rows.append(row)
            if rows:
                result["income_statement"] = rows
    except Exception as e:
        print(f"[stocks] yf income {symbol}: {e}")

    # ── Cash flow ─────────────────────────────────────────────────────────────
    try:
        cf = t.cash_flow
        if cf is not None and not cf.empty:
            CF_MAP = {
                "Operating Cash Flow": "operatingCashFlow",
                "Free Cash Flow": "freeCashFlow",
                "Capital Expenditure": "capitalExpenditure",
            }
            rows_cf = []
            for col in cf.columns[:10]:
                row_cf: dict = {"date": str(col.date())}
                for yf_key, fmp_key in CF_MAP.items():
                    if yf_key in cf.index:
                        val = cf.loc[yf_key, col]
                        if val is not None and not pd.isna(val):
                            row_cf[fmp_key] = float(val)
                rows_cf.append(row_cf)
            if rows_cf:
                result["cash_flow"] = rows_cf
    except Exception as e:
        print(f"[stocks] yf cashflow {symbol}: {e}")

    return result


def _fetch_yf(symbol: str) -> dict:
    try:
        info = yf.Ticker(symbol).info or {}
        return {
            "yf_info": {
                "longName": info.get("longName") or info.get("shortName", symbol),
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "longBusinessSummary": info.get("longBusinessSummary", ""),
                "website": info.get("website", ""),
                "fullTimeEmployees": info.get("fullTimeEmployees"),
                "marketCap": info.get("marketCap"),
                "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
                "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
                "forwardPE": info.get("forwardPE"),
                "trailingPE": info.get("trailingPE"),
                "forwardEps": info.get("forwardEps"),
                "trailingEps": info.get("trailingEps"),
                "dividendYield": info.get("dividendYield"),
                "beta": info.get("beta"),
                "targetMeanPrice": info.get("targetMeanPrice"),
                "targetLowPrice": info.get("targetLowPrice"),
                "targetHighPrice": info.get("targetHighPrice"),
                "recommendationKey": info.get("recommendationKey"),
                "numberOfAnalystOpinions": info.get("numberOfAnalystOpinions"),
                "revenueGrowth": info.get("revenueGrowth"),
                "earningsGrowth": info.get("earningsGrowth"),
                "grossMargins": info.get("grossMargins"),
                "operatingMargins": info.get("operatingMargins"),
                "profitMargins": info.get("profitMargins"),
                "returnOnEquity": info.get("returnOnEquity"),
                "returnOnAssets": info.get("returnOnAssets"),
                "freeCashflow": info.get("freeCashflow"),
                "totalRevenue": info.get("totalRevenue"),
                "ebitda": info.get("ebitda"),
                "totalDebt": info.get("totalDebt"),
                "totalCash": info.get("totalCash"),
                "pegRatio": info.get("pegRatio"),
                "priceToBook": info.get("priceToBook"),
                "enterpriseToRevenue": info.get("enterpriseToRevenue"),
                "enterpriseToEbitda": info.get("enterpriseToEbitda"),
            }
        }
    except Exception as e:
        print(f"[stocks] yfinance {symbol}: {e}")
        return {}


@router.get("/sectors")
def get_sectors(symbols: str, db: Session = Depends(get_db)):
    """Batch-fetch sector for a comma-separated list of symbols. Reads from cache first."""
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    result: dict = {}
    missing: list = []

    for sym in symbol_list:
        cached = db.query(StockDataCache).filter(StockDataCache.symbol == sym).first()
        if cached:
            data = json.loads(cached.data)
            sector = (
                data.get("yf_info", {}).get("sector")
                or (data.get("profile") or {}).get("sector")
            )
            result[sym] = sector or "Unknown"
        else:
            missing.append(sym)

    for sym in missing:
        try:
            info = yf.Ticker(sym).info or {}
            result[sym] = info.get("sector") or "Unknown"
        except Exception:
            result[sym] = "Unknown"

    return result


@router.get("/{symbol}")
def get_stock(symbol: str, refresh: bool = False, db: Session = Depends(get_db)):
    symbol = symbol.upper()

    if not refresh:
        cached = db.query(StockDataCache).filter(StockDataCache.symbol == symbol).first()
        if cached and (datetime.utcnow() - cached.cached_at) < CACHE_TTL:
            data = json.loads(cached.data)
            data["current_price"] = price_poller.latest_prices.get(symbol) or data.get("current_price", 0)
            data["previous_close"] = price_poller.previous_closes.get(symbol) or data.get("previous_close", 0)
            return data

    data: dict = {}
    if FMP_KEY:
        data.update(_fetch_fmp(symbol))
    data.update(_fetch_yf(symbol))

    # Always pull yfinance financial history as fallback when FMP not configured
    if not data.get("income_statement"):
        yf_fin = _fetch_yf_financials(symbol)
        data.update(yf_fin)

    data["symbol"] = symbol
    data["current_price"] = price_poller.latest_prices.get(symbol, 0)
    data["previous_close"] = price_poller.previous_closes.get(symbol, 0)
    data["fmp_enabled"] = bool(FMP_KEY)

    cached = db.query(StockDataCache).filter(StockDataCache.symbol == symbol).first()
    if cached:
        cached.data = json.dumps(data)
        cached.cached_at = datetime.utcnow()
    else:
        db.add(StockDataCache(symbol=symbol, data=json.dumps(data), cached_at=datetime.utcnow()))
    db.commit()

    return data


@router.get("/{symbol}/price-history")
def get_price_history(symbol: str, period: str = "1Y"):
    period_map = {
        "1M": "1mo", "3M": "3mo", "6M": "6mo",
        "1Y": "1y", "3Y": "3y", "5Y": "5y",
    }
    yf_period = period_map.get(period, "1y")
    try:
        hist = yf.Ticker(symbol.upper()).history(period=yf_period, interval="1d")
        if hist.empty:
            return []
        return [
            {
                "date": str(idx.date()),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            }
            for idx, row in hist.iterrows()
        ]
    except Exception as e:
        print(f"[stocks] price history {symbol}: {e}")
        return []
