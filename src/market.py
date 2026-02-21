# src/market.py
from __future__ import annotations

from typing import Optional
from functools import lru_cache
import math
import yfinance as yf
from src.metrics import compute_peg  # local import to avoid circular issues


# 1) Explicit aliases for symbols that commonly break across providers.
_TICKER_ALIASES: dict[str, str] = {
    "BRK.A": "BRK-A",
    "BRK.B": "BRK-B",
    "BF.A": "BF-A",
    "BF.B": "BF-B",
    "NWS.A": "NWSA",
    "NWS.B": "NWSB",
}

def _normalize_ticker(t: str) -> str:
    return (t or "").strip().upper()

def _candidate_symbols(ticker: str) -> list[str]:
    """
    Generate possible provider-compatible symbols. Order matters.
    """
    t = _normalize_ticker(ticker)
    if not t:
        return []

    cands: list[str] = [t]

    if t in _TICKER_ALIASES:
        cands.append(_TICKER_ALIASES[t])

    if "." in t:
        cands.append(t.replace(".", "-"))

    if "-" in t:
        cands.append(t.replace("-", "."))

    # De-dupe preserve order
    seen = set()
    out = []
    for x in cands:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out

def _safe_float(x) -> Optional[float]:
    try:
        if x is None:
            return None
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    except Exception:
        return None

@lru_cache(maxsize=2048)
def _yf_ticker(symbol: str) -> yf.Ticker:
    # Cached yfinance object (helps avoid rate limiting)
    return yf.Ticker(symbol)

def last_price(ticker: str):
    

    try:
        ticker = (ticker or "").upper().strip()

        # Prevent CASH or invalid symbols
        if ticker.startswith("CASH"):
            return 1.0

        t = yf.Ticker(ticker)

        # Fastest + most reliable
        hist = t.history(period="1d")
        if hist is not None and not hist.empty:
            return float(hist["Close"].iloc[-1])

        # Fallback to info
        info = t.info or {}
        lp = info.get("regularMarketPrice")
        if lp is not None:
            return float(lp)

        return None

    except Exception:
        return None

def _extract_annual_series(df, row_name_candidates: list[str]) -> list[float]:
    """
    Returns annual values newest->oldest from a yfinance statement df
    e.g. ticker.financials or ticker.cashflow
    """
    if df is None or getattr(df, "empty", True):
        return []
    idx = [str(i) for i in df.index]
    for name in row_name_candidates:
        if name in idx:
            s = df.loc[name]
            vals = []
            for col in list(s.index):
                v = _safe_float(s[col])
                if v is not None:
                    vals.append(v)
            # yfinance columns are usually newest->oldest already, but ensure order:
            return vals
    return []

def _cagr(values_newest_to_oldest: list[float], years: int) -> Optional[float]:
    """
    CAGR using annual points: newest vs value 'years' ago.
    Needs at least years+1 points.
    """
    if not values_newest_to_oldest or len(values_newest_to_oldest) < years + 1:
        return None
    newest = values_newest_to_oldest[0]
    older = values_newest_to_oldest[years]
    if newest is None or older is None or older == 0:
        return None
    if newest <= 0 or older <= 0:
        return None
    return (newest / older) ** (1.0 / years) - 1.0

def _yoy(values_newest_to_oldest: list[float]) -> Optional[float]:
    """
    1y growth = (newest/prior)-1
    """
    if not values_newest_to_oldest or len(values_newest_to_oldest) < 2:
        return None
    newest = values_newest_to_oldest[0]
    prior = values_newest_to_oldest[1]
    if prior is None or prior == 0:
        return None
    return newest / prior - 1.0

@lru_cache(maxsize=2048)
def get_fundamentals(ticker: str) -> dict:
    """
    Best-effort fundamentals/targets/growth for UI.
    PEG is computed internally (robust) instead of trusting Yahoo.
    """

    out = {
        "forward_pe": None,
        "forward_peg": None,
        "quick_ratio": None,
        "current_ratio": None,
        "rev_g_1y": None, "rev_g_3y": None, "rev_g_5y": None,
        "ocf_g_1y": None, "ocf_g_3y": None, "ocf_g_5y": None,
        "fcf_g_1y": None, "fcf_g_3y": None, "fcf_g_5y": None,
        "target_1y": None, "target_3y": None, "target_5y": None,
        "fair_value": None,
        "price_by_fair_value": None,
    }

    for sym in _candidate_symbols(ticker):
        try:
            tk = _yf_ticker(sym)
            info = getattr(tk, "info", {}) or {}

            forward_pe = _safe_float(info.get("forwardPE"))
            earnings_growth = _safe_float(info.get("earningsGrowth"))  # e.g. 0.25
            out["forward_pe"] = forward_pe
            out["quick_ratio"] = _safe_float(info.get("quickRatio"))
            out["current_ratio"] = _safe_float(info.get("currentRatio"))

            # ---------------------------
            # Revenue growth (for fallback PEG)
            # ---------------------------
            fin = getattr(tk, "financials", None)
            rev_vals = _extract_annual_series(fin, ["Total Revenue", "TotalRevenue"])
            rev_g_3y = _cagr(rev_vals, 3)
            out["rev_g_1y"] = _yoy(rev_vals)
            out["rev_g_3y"] = rev_g_3y
            out["rev_g_5y"] = _cagr(rev_vals, 5)

            # ---------------------------
            # Compute PEG properly
            # ---------------------------
            peg = None

            # Preferred: earnings growth (true PEG definition)
            if forward_pe and earnings_growth and earnings_growth > 0:
                peg = compute_peg(forward_pe, earnings_growth * 100)

            # Fallback: use 3Y revenue CAGR
            elif forward_pe and rev_g_3y and rev_g_3y > 0:
                peg = compute_peg(forward_pe, rev_g_3y * 100)

            out["forward_peg"] = peg

            # ---------------------------
            # Targets
            # ---------------------------
            target_mean = _safe_float(info.get("targetMeanPrice"))
            out["target_1y"] = target_mean

            px = last_price(sym) or last_price(ticker)
            if px and target_mean and px > 0 and target_mean > 0:
                implied_g = target_mean / px - 1.0
                out["target_3y"] = px * ((1.0 + implied_g) ** 3)
                out["target_5y"] = px * ((1.0 + implied_g) ** 5)
                out["fair_value"] = target_mean
                out["price_by_fair_value"] = px / target_mean

            # ---------------------------
            # Cashflow growth
            # ---------------------------
            cf = getattr(tk, "cashflow", None)
            ocf_vals = _extract_annual_series(
                cf,
                ["Total Cash From Operating Activities", "Operating Cash Flow", "OperatingCashFlow"]
            )
            out["ocf_g_1y"] = _yoy(ocf_vals)
            out["ocf_g_3y"] = _cagr(ocf_vals, 3)
            out["ocf_g_5y"] = _cagr(ocf_vals, 5)

            fcf_vals = _extract_annual_series(cf, ["Free Cash Flow", "FreeCashFlow"])
            if not fcf_vals:
                capex_vals = _extract_annual_series(cf, ["Capital Expenditures", "CapitalExpenditures"])
                if ocf_vals and capex_vals and len(ocf_vals) == len(capex_vals):
                    fcf_vals = [ocf_vals[i] + capex_vals[i] for i in range(len(ocf_vals))]

            out["fcf_g_1y"] = _yoy(fcf_vals)
            out["fcf_g_3y"] = _cagr(fcf_vals, 3)
            out["fcf_g_5y"] = _cagr(fcf_vals, 5)

            return out

        except Exception:
            continue

    return out

