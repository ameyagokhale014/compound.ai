from __future__ import annotations
from datetime import datetime
import math
import yfinance as yf
from sqlalchemy import text
from .db import ENGINE

def _safe_num(x):
    try:
        if x is None:
            return None
        if isinstance(x, (int, float)):
            if math.isnan(x):
                return None
            return float(x)
        return float(x)
    except Exception:
        return None

def refresh_kpis_for_ticker(ticker: str):
    t = yf.Ticker(ticker)
    info = {}
    try:
        info = t.info or {}
    except Exception:
        info = {}

    # Best-effort fields from yfinance (prototype). For production use a paid fundamentals API.
    snapshot_date = datetime.utcnow().isoformat(timespec="seconds")

    market_cap = _safe_num(info.get("marketCap"))
    revenue_ttm = _safe_num(info.get("totalRevenue"))
    revenue_growth_yoy = _safe_num(info.get("revenueGrowth"))
    net_income_ttm = _safe_num(info.get("netIncomeToCommon"))
    # yfinance doesn't always give net income growth; keep None if missing
    net_income_growth_yoy = None

    eps_ttm = _safe_num(info.get("trailingEps"))
    forward_eps = _safe_num(info.get("forwardEps"))

    pe = _safe_num(info.get("trailingPE"))
    forward_pe = _safe_num(info.get("forwardPE"))
    peg = _safe_num(info.get("pegRatio"))

    fcf_ttm = _safe_num(info.get("freeCashflow"))
    gross_margin = _safe_num(info.get("grossMargins"))
    operating_margin = _safe_num(info.get("operatingMargins"))

    # ----- Simple target engine (v1) -----
    # We typically only get reliable "12m" analyst targets from providers; for 24/36 we model.
    # This model uses:
    #   - forward EPS
    #   - a chosen PE multiple (use forward PE if available else trailing PE else default)
    #   - an EPS growth assumption inferred from PEG if available else a conservative default
    assumed_pe = forward_pe or pe or 18.0

    # If PEG ~ PE / growth%, then growth% ~ PE / PEG. This is crude and only for v1.
    # If missing, assume 10% annual EPS growth.
    annual_eps_growth = None
    if pe and peg and peg > 0:
        annual_eps_growth = min(max((pe / peg) / 100.0, 0.02), 0.35)  # clamp 2%..35%
    else:
        annual_eps_growth = 0.10

    # Base EPS for projection
    base_eps = forward_eps or eps_ttm
    target_12m = target_24m = target_36m = None
    assumptions = {
        "assumed_pe": assumed_pe,
        "annual_eps_growth": annual_eps_growth,
        "base_eps": base_eps,
        "notes": "v1 model: EPS projection x assumed PE; replace with analyst estimates/DCF later"
    }

    if base_eps:
        eps_1y = base_eps * ((1 + annual_eps_growth) ** 1)
        eps_2y = base_eps * ((1 + annual_eps_growth) ** 2)
        eps_3y = base_eps * ((1 + annual_eps_growth) ** 3)
        target_12m = eps_1y * assumed_pe
        target_24m = eps_2y * assumed_pe
        target_36m = eps_3y * assumed_pe

    # Write snapshots
    with ENGINE.begin() as conn:
        conn.execute(text("""
            INSERT INTO fundamentals_snapshot (
                ticker, snapshot_date, market_cap, revenue_ttm, revenue_growth_yoy,
                net_income_ttm, net_income_growth_yoy, eps_ttm, forward_eps,
                pe, forward_pe, peg, fcf_ttm, gross_margin, operating_margin
            ) VALUES (
                :ticker, :snapshot_date, :market_cap, :revenue_ttm, :revenue_growth_yoy,
                :net_income_ttm, :net_income_growth_yoy, :eps_ttm, :forward_eps,
                :pe, :forward_pe, :peg, :fcf_ttm, :gross_margin, :operating_margin
            )
        """), {
            "ticker": ticker,
            "snapshot_date": snapshot_date,
            "market_cap": market_cap,
            "revenue_ttm": revenue_ttm,
            "revenue_growth_yoy": revenue_growth_yoy,
            "net_income_ttm": net_income_ttm,
            "net_income_growth_yoy": net_income_growth_yoy,
            "eps_ttm": eps_ttm,
            "forward_eps": forward_eps,
            "pe": pe,
            "forward_pe": forward_pe,
            "peg": peg,
            "fcf_ttm": fcf_ttm,
            "gross_margin": gross_margin,
            "operating_margin": operating_margin
        })

        conn.execute(text("""
            INSERT INTO targets_model (ticker, snapshot_date, target_12m, target_24m, target_36m, assumptions)
            VALUES (:ticker, :snapshot_date, :t12, :t24, :t36, :assumptions)
        """), {
            "ticker": ticker,
            "snapshot_date": snapshot_date,
            "t12": target_12m,
            "t24": target_24m,
            "t36": target_36m,
            "assumptions": str(assumptions)
        })

def refresh_kpis_for_portfolio():
    from .portfolio import get_portfolio_tickers
    for t in get_portfolio_tickers():
        refresh_kpis_for_ticker(t)
