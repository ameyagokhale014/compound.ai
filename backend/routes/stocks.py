from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import json
import os
import time
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

# In-memory caches (survive for the process lifetime)
_price_history_cache: dict[str, tuple[float, list]] = {}   # "AAPL:1Y" → (ts, data)
_financials_cache: dict[str, tuple[float, list]] = {}       # symbol → (ts, data)
_dcf_defaults_cache: dict[str, tuple[float, dict]] = {}     # symbol → (ts, data)
_PRICE_HISTORY_TTL = 3600   # 1 hour
_FINANCIALS_TTL    = 3600   # 1 hour
_DCF_TTL           = 3600   # 1 hour


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


@router.get("/market-caps")
def get_market_caps(symbols: str, db: Session = Depends(get_db)):
    """Batch-fetch market cap (in dollars) for a comma-separated list of symbols from cache."""
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    result: dict = {}

    for sym in symbol_list:
        cached = db.query(StockDataCache).filter(StockDataCache.symbol == sym).first()
        if cached:
            data = json.loads(cached.data)
            mc = (
                data.get("yf_info", {}).get("marketCap")
                or (data.get("profile") or {}).get("mktCap")
                or data.get("market_cap")
            )
            result[sym] = int(mc) if mc else None
        else:
            result[sym] = None

    return result


@router.get("/countries")
def get_countries(symbols: str, db: Session = Depends(get_db)):
    """Batch-fetch country for a comma-separated list of symbols. Reads from cache first."""
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    result: dict = {}
    missing: list = []

    for sym in symbol_list:
        cached = db.query(StockDataCache).filter(StockDataCache.symbol == sym).first()
        if cached:
            data = json.loads(cached.data)
            country = (
                data.get("yf_info", {}).get("country")
                or (data.get("profile") or {}).get("country")
            )
            result[sym] = country or None
        else:
            missing.append(sym)

    for sym in missing:
        try:
            info = yf.Ticker(sym).info or {}
            result[sym] = info.get("country") or None
        except Exception:
            result[sym] = None

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


@router.get("/{symbol}/financials")
def get_financials(symbol: str):
    """Return last 5 quarters of key financial metrics for the compound.ai financial snapshot."""
    sym = symbol.upper()
    cached = _financials_cache.get(sym)
    if cached and (time.time() - cached[0]) < _FINANCIALS_TTL:
        return cached[1]
    try:
        t = yf.Ticker(sym)
        qi = t.quarterly_income_stmt
        qc = t.quarterly_cashflow
        qb = t.quarterly_balance_sheet

        if qi is None or qi.empty:
            return []

        def safe(df, key, col):
            try:
                if key in df.index:
                    v = df.loc[key, col]
                    return float(v) if v is not None and not pd.isna(v) else None
            except Exception:
                pass
            return None

        quarters = []
        cols = list(qi.columns[:5])  # most recent first
        for col in reversed(cols):   # oldest → newest for display
            month = col.month if hasattr(col, 'month') else 1
            q_num = (month - 1) // 3 + 1
            label = f"Q{q_num} '{col.strftime('%y')}" if hasattr(col, 'strftime') else str(col.date())
            # ── Income ──────────────────────────────────────────────────────
            revenue       = safe(qi, "Total Revenue", col)
            gross_profit  = safe(qi, "Gross Profit", col)
            op_income     = safe(qi, "Operating Income", col)
            net_income    = safe(qi, "Net Income", col)
            eps           = safe(qi, "Diluted EPS", col)
            # ── Cash flow ───────────────────────────────────────────────────
            op_cf  = safe(qc, "Operating Cash Flow", col)
            capex  = safe(qc, "Capital Expenditure", col)
            fcf    = safe(qc, "Free Cash Flow", col)
            # ── Balance sheet ───────────────────────────────────────────────
            cash       = safe(qb, "Cash Cash Equivalents And Short Term Investments", col) \
                      or safe(qb, "Cash And Cash Equivalents", col)
            total_debt = safe(qb, "Total Debt", col)
            equity     = safe(qb, "Common Stock Equity", col)

            net_cash = (cash - total_debt) if cash is not None and total_debt is not None else None
            gross_margin  = (gross_profit / revenue * 100) if revenue and gross_profit else None
            op_margin     = (op_income / revenue * 100)    if revenue and op_income else None
            net_margin    = (net_income / revenue * 100)   if revenue and net_income else None
            fcf_margin    = (fcf / revenue * 100)          if revenue and fcf else None
            debt_equity   = (total_debt / equity)          if equity and equity != 0 and total_debt else None

            quarters.append({
                "label":       label,
                "date":        str(col.date()),
                "revenue":     revenue,
                "gross_profit": gross_profit,
                "gross_margin": gross_margin,
                "op_income":   op_income,
                "op_margin":   op_margin,
                "net_income":  net_income,
                "net_margin":  net_margin,
                "eps":         eps,
                "op_cf":       op_cf,
                "capex":       capex,
                "fcf":         fcf,
                "fcf_margin":  fcf_margin,
                "cash":        cash,
                "total_debt":  total_debt,
                "net_cash":    net_cash,
                "equity":      equity,
                "debt_equity": debt_equity,
            })

        _financials_cache[sym] = (time.time(), quarters)
        return quarters
    except Exception as e:
        print(f"[stocks] financials {sym}: {e}")
        return []


@router.get("/{symbol}/dcf-defaults")
def get_dcf_defaults(symbol: str):
    """Return auto-filled DCF inputs: TTM FCF, shares outstanding, net cash, growth rates."""
    sym = symbol.upper()
    cached = _dcf_defaults_cache.get(sym)
    if cached and (time.time() - cached[0]) < _DCF_TTL:
        return cached[1]
    try:
        t = yf.Ticker(sym)
        info = t.info or {}
        qc   = t.quarterly_cashflow
        qb   = t.quarterly_balance_sheet

        # TTM FCF = sum of last 4 quarters
        ttm_fcf = None
        if qc is not None and not qc.empty and "Free Cash Flow" in qc.index:
            vals = [float(v) for v in qc.loc["Free Cash Flow"].iloc[:4] if v is not None and not pd.isna(v)]
            if vals:
                ttm_fcf = sum(vals)

        # Shares outstanding
        shares = info.get("sharesOutstanding") or info.get("impliedSharesOutstanding")

        # Net cash = cash & equivalents − total debt (most recent quarter)
        net_cash = None
        try:
            cash_key = "Cash Cash Equivalents And Short Term Investments"
            cash = float(qb.loc[cash_key].iloc[0]) if cash_key in qb.index else 0.0
            debt = float(qb.loc["Total Debt"].iloc[0]) if "Total Debt" in qb.index else 0.0
            net_cash = cash - debt
        except Exception:
            total_cash = info.get("totalCash", 0) or 0
            total_debt = info.get("totalDebt", 0) or 0
            net_cash = total_cash - total_debt

        # Revenue growth as suggested starting growth rate (clamp to reasonable range)
        rev_growth = info.get("revenueGrowth")
        suggested_growth = None
        if rev_growth is not None:
            suggested_growth = round(max(2.0, min(50.0, rev_growth * 100)), 1)

        result = {
            "ttm_fcf":         ttm_fcf,
            "shares":          shares,
            "net_cash":        net_cash,
            "suggested_growth": suggested_growth,
            "revenue_growth":  rev_growth,
            "market_cap":      info.get("marketCap"),
            "current_price":   info.get("currentPrice") or info.get("regularMarketPrice"),
        }
        _dcf_defaults_cache[sym] = (time.time(), result)
        return result
    except Exception as e:
        print(f"[stocks] dcf-defaults {sym}: {e}")
        return {}


@router.get("/{symbol}/price-history")
def get_price_history(symbol: str, period: str = "1Y"):
    cache_key = f"{symbol.upper()}:{period}"
    cached = _price_history_cache.get(cache_key)
    if cached and (time.time() - cached[0]) < _PRICE_HISTORY_TTL:
        return cached[1]

    period_map = {
        "1M": "1mo", "3M": "3mo", "6M": "6mo",
        "1Y": "1y", "3Y": "3y", "5Y": "5y",
    }
    yf_period = period_map.get(period, "1y")
    try:
        hist = yf.Ticker(symbol.upper()).history(period=yf_period, interval="1d")
        if hist.empty:
            return []
        result = [
            {
                "date": str(idx.date()),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            }
            for idx, row in hist.iterrows()
        ]
        _price_history_cache[cache_key] = (time.time(), result)
        return result
    except Exception as e:
        print(f"[stocks] price history {symbol}: {e}")
        return []
