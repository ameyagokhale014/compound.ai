"""
Earnings Intelligence route — compound.ai

GET  /earnings/                      — upcoming earnings for all portfolio + watchlist symbols
GET  /earnings/recent-summaries      — cached earnings call summaries (for dashboard)
POST /earnings/refresh               — force-refresh yfinance data for all symbols
POST /earnings/{symbol}/analyze      — run Claude AI forward-looking analysis
POST /earnings/{symbol}/call-summary — summarize the most recent earnings call results
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timedelta
from typing import Optional

import anthropic
import yfinance as yf
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import EarningsCache, Portfolio, WatchlistItem

router = APIRouter(prefix="/earnings", tags=["earnings"])

STALE_HOURS   = 6    # re-fetch yfinance after 6 h
AI_STALE_HOURS = 48  # re-run AI analysis after 48 h


# ── Symbol helpers ─────────────────────────────────────────────────────────────

def _get_all_symbols(db: Session) -> dict[str, dict]:
    """Returns {symbol: {name, source}} for portfolio holdings + watchlist."""
    out: dict[str, dict] = {}
    for p in db.query(Portfolio).all():
        for h in p.holdings:
            if h.asset_type != "cash":
                out[h.symbol] = {"name": h.name, "source": "portfolio"}
    for w in db.query(WatchlistItem).all():
        if w.symbol not in out:
            out[w.symbol] = {"name": w.name or w.symbol, "source": "watchlist"}
    return out


# ── yfinance fetcher ───────────────────────────────────────────────────────────

def _fetch_yf_earnings(symbol: str) -> dict:
    result: dict = {
        "next_earnings_date": None,
        "earnings_time": "unknown",
        "eps_estimate": None,
        "revenue_estimate": None,
        "surprise_history": [],
        "current_price": None,
        "analyst_target": None,
        "recommendation": None,
        "forward_pe": None,
        "revenue_growth": None,
        "earnings_growth": None,
        "sector": None,
        "long_name": symbol,
    }
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        result.update({
            "current_price":   info.get("currentPrice") or info.get("regularMarketPrice"),
            "analyst_target":  info.get("targetMeanPrice"),
            "recommendation":  info.get("recommendationKey"),
            "forward_pe":      info.get("forwardPE"),
            "revenue_growth":  info.get("revenueGrowth"),
            "earnings_growth": info.get("earningsGrowth"),
            "sector":          info.get("sector"),
            "long_name":       info.get("longName") or symbol,
        })

        # --- Calendar: next date + EPS/Revenue estimates ---
        try:
            cal = ticker.calendar
            if cal is not None and isinstance(cal, dict):
                dates = cal.get("Earnings Date") or cal.get("earningsDate")
                if isinstance(dates, (list, tuple)) and len(dates):
                    d = dates[0]
                    result["next_earnings_date"] = (
                        d.isoformat() if hasattr(d, "isoformat") else str(d)
                    )
                elif dates and hasattr(dates, "isoformat"):
                    result["next_earnings_date"] = dates.isoformat()
                result["eps_estimate"] = (
                    cal.get("Earnings Average")
                    or cal.get("EPS Estimate")
                    or cal.get("epsAverage")
                )
                result["revenue_estimate"] = (
                    cal.get("Revenue Average")
                    or cal.get("Revenue Estimate")
                    or cal.get("revenueAverage")
                )
        except Exception:
            pass

        # Fallback: earningsTimestamp in info dict
        if not result["next_earnings_date"]:
            ts = info.get("earningsTimestamp")
            if ts:
                dt = datetime.utcfromtimestamp(float(ts))
                if dt > datetime.utcnow():
                    result["next_earnings_date"] = dt.strftime("%Y-%m-%dT%H:%M:%S")

        # --- earnings_dates DataFrame: surprise history + future date fallback ---
        try:
            import pandas as pd
            df = ticker.earnings_dates
            if df is not None and not df.empty:
                now_utc = pd.Timestamp.now(tz="UTC")

                # Past earnings → surprise history
                past = df[df.index < now_utc].head(4)
                history = []
                for dt_idx, row in past.iterrows():
                    try:
                        est_v = row.get("EPS Estimate")
                        act_v = row.get("Reported EPS")
                        if est_v is None or act_v is None:
                            continue
                        est_f, act_f = float(est_v), float(act_v)
                        surp = ((act_f - est_f) / abs(est_f) * 100) if est_f != 0 else 0.0
                        history.append({
                            "date": dt_idx.strftime("%Y-%m-%d"),
                            "eps_estimate": round(est_f, 2),
                            "eps_actual": round(act_f, 2),
                            "surprise_pct": round(surp, 1),
                        })
                    except Exception:
                        pass
                result["surprise_history"] = history

                # Future date fallback
                if not result["next_earnings_date"]:
                    future = df[df.index > now_utc]
                    if not future.empty:
                        # DataFrame is sorted descending; last row of future = nearest date
                        nd = future.index[-1]
                        result["next_earnings_date"] = nd.strftime("%Y-%m-%d")
        except Exception:
            pass

    except Exception as e:
        result["error"] = str(e)

    return result


# ── AI prompt builder ──────────────────────────────────────────────────────────

def _build_prompt(symbol: str, data: dict, pos: dict | None, call_summary: dict | None = None) -> str:
    history = data.get("surprise_history", [])
    if history:
        beats = sum(1 for h in history if h["surprise_pct"] > 0)
        avg_s = sum(h["surprise_pct"] for h in history) / len(history)
        surp_lines = [f"Last {len(history)}Q: {beats}/{len(history)} beats, avg surprise {avg_s:+.1f}%"]
        for h in history:
            surp_lines.append(
                f"  • {h['date']}: Est ${h['eps_estimate']} → Actual ${h['eps_actual']} "
                f"({h['surprise_pct']:+.1f}%)"
            )
        surprise_text = "\n".join(surp_lines)
    else:
        surprise_text = "No historical data available"

    cp    = data.get("current_price") or 0
    at    = data.get("analyst_target")
    upside_txt = (
        f"${at:.2f} ({(at - cp) / cp * 100:+.1f}% upside)" if at and cp > 0 else "N/A"
    )
    fpe   = data.get("forward_pe")
    rg    = data.get("revenue_growth")
    eg    = data.get("earnings_growth")
    eps_e = data.get("eps_estimate")
    rev_e = data.get("revenue_estimate")

    pos_block = ""
    if pos:
        gl  = pos.get("gain_loss", 0) or 0
        glp = pos.get("gain_loss_pct", 0) or 0
        pos_block = (
            f"\nUser's current position in {symbol}:\n"
            f"  • {pos.get('quantity', 0):.0f} shares @ avg cost ${pos.get('avg_cost', 0):.2f}\n"
            f"  • Unrealized P&L: {glp:+.1f}% (${gl:+,.2f})\n"
        )

    # ── Last earnings call context block ──────────────────────────────────────
    last_call_block = ""
    if call_summary and not call_summary.get("error"):
        rxn = call_summary.get("price_reaction_pct")
        rxn_str = f"{rxn:+.1f}% stock move after results" if rxn is not None else "N/A"
        eps_surp = call_summary.get("eps_surprise_pct")
        surp_str = f"{eps_surp:+.1f}% EPS surprise" if eps_surp is not None else "N/A"
        last_call_block = (
            f"\n══ LAST EARNINGS CALL CONTEXT ══\n"
            f"Quarter: {call_summary.get('quarter', 'Previous Q')} | Date: {call_summary.get('call_date', 'N/A')}\n"
            f"Headline: {call_summary.get('headline', 'N/A')}\n"
            f"Results: {surp_str} | Price reaction: {rxn_str}\n"
            f"What happened: {call_summary.get('what_happened', 'N/A')}\n"
            f"vs Estimates: {call_summary.get('vs_estimates', 'N/A')}\n"
            f"Management tone last call: {call_summary.get('management_tone', 'N/A')}\n"
            f"Key highlights from last call:\n"
            + "\n".join(f"  • {h}" for h in (call_summary.get("key_highlights") or []))
            + f"\nGuidance given last call: {call_summary.get('guidance', 'N/A')}\n"
            f"Near-term outlook from last call: {call_summary.get('near_term_outlook', 'N/A')}\n"
            f"Long-term thesis from last call: {call_summary.get('long_term_outlook', 'N/A')}\n"
            f"Key risk flagged last call: {call_summary.get('risk', 'N/A')}\n"
            f"══ END LAST CALL CONTEXT ══\n"
        )

    # ── Upcoming call expectations ────────────────────────────────────────────
    eps_est_str = f"${eps_e:.2f}" if eps_e else "N/A"
    rev_est_str = f"${rev_e / 1e9:.2f}B" if rev_e else "N/A"

    return (
        f"You are a senior equity analyst. Analyze the UPCOMING earnings for {symbol} "
        f"({data.get('long_name', symbol)}) and bridge what happened LAST quarter with what "
        f"we expect THIS quarter. Give a direct, data-backed assessment.\n\n"
        f"══ COMPANY OVERVIEW ══\n"
        f"Sector: {data.get('sector', 'Unknown')}\n"
        f"Current Price: ${cp:.2f}\n"
        f"Forward P/E: {f'{fpe:.1f}x' if fpe else 'N/A'}\n"
        f"Revenue Growth (TTM): {f'{rg * 100:.1f}%' if rg else 'N/A'}\n"
        f"Earnings Growth (TTM): {f'{eg * 100:.1f}%' if eg else 'N/A'}\n"
        f"Analyst Mean Target: {upside_txt}\n"
        f"Consensus Rating: {data.get('recommendation', 'N/A')}\n\n"
        f"══ THIS UPCOMING EARNINGS CALL EXPECTATIONS ══\n"
        f"EPS Estimate: {eps_est_str}\n"
        f"Revenue Estimate: {rev_est_str}\n"
        f"Earnings Surprise History (most recent first):\n{surprise_text}\n"
        f"{last_call_block}"
        f"{pos_block}\n"
        "Your analysis MUST bridge the gap between the last earnings call and this upcoming one:\n"
        "1. Did the company deliver on guidance from last call? Is it on track?\n"
        "2. What specific metrics to watch based on last call's guidance vs estimates?\n"
        "3. Where is the company most likely to beat or miss vs estimates?\n"
        "4. How does the stock setup compare to where it was heading into last earnings?\n\n"
        "Return ONLY valid JSON (no markdown, no text outside the JSON):\n"
        "{\n"
        '  "what_to_watch": [\n'
        '    "<Specific metric 1 with a number — e.g. EPS must beat $X.XX to sustain rally>",\n'
        '    "<Metric 2 — revenue line: consensus is $XB, watch for X% upside vs last guidance>",\n'
        '    "<Metric 3 — management credibility: last guidance was X, are they delivering?>"\n'
        '  ],\n'
        '  "price_move_prediction": "likely_up" | "likely_down" | "neutral" | "volatile",\n'
        '  "predicted_move_range": "<e.g. +5% to +12% or -8% to -2%>",\n'
        '  "action": "buy_before" | "hold" | "trim" | "avoid",\n'
        '  "setup_quality": "strong" | "mixed" | "weak",\n'
        '  "confidence": <integer 1-10>,\n'
        '  "reasoning": "<2-3 direct sentences that cite actual numbers and bridge last call → this call>",\n'
        '  "key_risk": "<single biggest downside risk — tie to last call guidance if possible>",\n'
        '  "key_catalyst": "<single biggest upside catalyst — what could make this a blowout quarter?>",\n'
        '  "guidance_delivered": "on_track" | "ahead_of_guidance" | "behind_guidance" | "unknown",\n'
        '  "guidance_check_reasoning": "<1 sentence: is the company on track vs what they guided last call? Cite the guidance and current trajectory.>",\n'
        '  "beat_probability": {\n'
        '    "eps": "<low | medium | high — brief reason>",\n'
        '    "revenue": "<low | medium | high — brief reason>"\n'
        '  }\n'
        "}"
    )


# ── Cache helpers ──────────────────────────────────────────────────────────────

def _get_or_refresh(symbol: str, db: Session, force: bool = False) -> EarningsCache:
    now = datetime.utcnow()
    row = db.query(EarningsCache).filter(EarningsCache.symbol == symbol).first()
    if not row:
        row = EarningsCache(symbol=symbol)
        db.add(row)

    stale = (
        force
        or row.last_fetched is None
        or (now - row.last_fetched) > timedelta(hours=STALE_HOURS)
    )
    if stale:
        data = _fetch_yf_earnings(symbol)
        row.yf_data = json.dumps(data)
        row.last_fetched = now
        db.commit()

    return row


def _format(row: EarningsCache, meta: dict) -> dict:
    data = json.loads(row.yf_data) if row.yf_data else {}
    ai   = json.loads(row.ai_analysis) if row.ai_analysis else None
    return {
        "symbol":             row.symbol,
        "name":               meta.get("name", row.symbol),
        "source":             meta.get("source", "portfolio"),
        "next_earnings_date": data.get("next_earnings_date"),
        "earnings_time":      data.get("earnings_time", "unknown"),
        "eps_estimate":       data.get("eps_estimate"),
        "revenue_estimate":   data.get("revenue_estimate"),
        "surprise_history":   data.get("surprise_history", []),
        "current_price":      data.get("current_price"),
        "analyst_target":     data.get("analyst_target"),
        "forward_pe":         data.get("forward_pe"),
        "sector":             data.get("sector"),
        "long_name":          data.get("long_name", row.symbol),
        "ai_analysis":        ai,
        "last_fetched":       row.last_fetched.isoformat() if row.last_fetched else None,
        "last_analyzed":      row.last_analyzed.isoformat() if row.last_analyzed else None,
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/")
def get_earnings(db: Session = Depends(get_db)):
    """Return upcoming earnings for all tracked symbols (cached, stale after 6 h)."""
    symbols = _get_all_symbols(db)
    result  = [_format(_get_or_refresh(sym, db), meta) for sym, meta in symbols.items()]
    # Sort by date, nulls last
    result.sort(key=lambda x: x["next_earnings_date"] or "9999-12-31")
    return result


@router.post("/refresh")
def refresh_all(db: Session = Depends(get_db)):
    """Force-refresh yfinance data for every tracked symbol."""
    symbols = _get_all_symbols(db)
    for sym, meta in symbols.items():
        _get_or_refresh(sym, db, force=True)
    return {"ok": True, "count": len(symbols)}


class AnalyzeBody(BaseModel):
    quantity:      Optional[float] = None
    avg_cost:      Optional[float] = None
    gain_loss:     Optional[float] = None
    gain_loss_pct: Optional[float] = None


@router.get("/recent-summaries")
def recent_summaries(db: Session = Depends(get_db)):
    """
    Return cached earnings call summaries for the dashboard.
    Only returns symbols that already have a call_summary cached.
    Sorted by call date (most recent first).
    """
    symbols_meta = _get_all_symbols(db)
    results = []
    for sym, meta in symbols_meta.items():
        row = db.query(EarningsCache).filter(EarningsCache.symbol == sym).first()
        if not row or not row.call_summary:
            continue
        try:
            summary = json.loads(row.call_summary)
            results.append({
                "symbol":          sym,
                "name":            meta.get("name", sym),
                "source":          meta.get("source", "portfolio"),
                "call_date":       summary.get("call_date"),
                "quarter":         summary.get("quarter"),
                "headline":        summary.get("headline"),
                "action":          summary.get("action"),
                "management_tone": summary.get("management_tone"),
                "eps_surprise_pct": summary.get("eps_surprise_pct"),
                "price_reaction_pct": summary.get("price_reaction_pct"),
                "near_term_outlook": summary.get("near_term_outlook"),
                "last_summarized": row.last_summarized.isoformat() if row.last_summarized else None,
            })
        except Exception:
            pass
    # Sort by call_date descending (most recent first), nulls last
    results.sort(key=lambda x: x.get("call_date") or "0000-00-00", reverse=True)
    return results


@router.post("/{symbol}/analyze")
def analyze(
    symbol: str,
    body: AnalyzeBody = AnalyzeBody(),
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    """Run Claude AI earnings analysis for one symbol. Caches result for 48 h."""
    api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"error": "No Anthropic API key — add it in profile settings."}

    now = datetime.utcnow()
    row = _get_or_refresh(symbol, db)

    # Return cached analysis if still fresh
    if (
        row.ai_analysis
        and row.last_analyzed
        and (now - row.last_analyzed) < timedelta(hours=AI_STALE_HOURS)
    ):
        return json.loads(row.ai_analysis)

    data = json.loads(row.yf_data) if row.yf_data else {}
    pos  = None
    if body.quantity and body.avg_cost:
        pos = {
            "quantity":      body.quantity,
            "avg_cost":      body.avg_cost,
            "gain_loss":     body.gain_loss,
            "gain_loss_pct": body.gain_loss_pct,
        }

    # Pull in the cached last-call summary to give Claude full context
    call_summary = None
    if row.call_summary:
        try:
            call_summary = json.loads(row.call_summary)
        except Exception:
            pass

    prompt = _build_prompt(symbol, data, pos, call_summary)
    try:
        client  = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=900,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        analysis = json.loads(raw)
        row.ai_analysis   = json.dumps(analysis)
        row.last_analyzed = now
        db.commit()
        return analysis
    except anthropic.AuthenticationError:
        return {"error": "Invalid Anthropic API key."}
    except Exception as e:
        return {"error": str(e)}


# ── Call Summary helpers ───────────────────────────────────────────────────────

def _safe_float(v) -> Optional[float]:
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


def _fetch_call_data(symbol: str, earnings_date: str) -> dict:
    """
    Gather actual quarterly financial results + price reaction around an earnings date.
    Returns a dict with all the context needed to summarize the call.
    """
    result: dict = {
        "earnings_date":      earnings_date,
        "revenue_actual":     None,
        "revenue_yoy_pct":    None,
        "net_income_actual":  None,
        "net_income_yoy_pct": None,
        "eps_actual":         None,
        "gross_margin_pct":   None,
        "operating_income":   None,
        "price_before":       None,   # 2 trading days before earnings
        "price_after":        None,   # 1 trading day after earnings
        "price_reaction_pct": None,
        "news_headlines":     [],
        "analyst_target":     None,
        "recommendation":     None,
    }
    try:
        import pandas as pd
        ticker = yf.Ticker(symbol)

        # ── Quarterly income statement ────────────────────────────────────────
        try:
            q_inc = ticker.quarterly_income_stmt
            if q_inc is not None and not q_inc.empty:
                col = q_inc.columns[0]   # most recent quarter
                prev_col = q_inc.columns[1] if len(q_inc.columns) > 1 else None

                def get_metric(keys: list[str], df, column) -> Optional[float]:
                    for k in keys:
                        if k in df.index:
                            return _safe_float(df.at[k, column])
                    return None

                rev  = get_metric(["Total Revenue", "Revenue", "TotalRevenue"], q_inc, col)
                ni   = get_metric(["Net Income", "NetIncome"], q_inc, col)
                gp   = get_metric(["Gross Profit", "GrossProfit"], q_inc, col)
                oi   = get_metric(["Operating Income", "OperatingIncome"], q_inc, col)

                result["revenue_actual"]    = rev
                result["net_income_actual"] = ni
                result["operating_income"]  = oi
                if rev and gp:
                    result["gross_margin_pct"] = round(gp / rev * 100, 1)

                # YoY growth vs same quarter last year (4 columns back)
                if len(q_inc.columns) >= 5:
                    yoy_col = q_inc.columns[4]
                    rev_yoy = get_metric(["Total Revenue", "Revenue"], q_inc, yoy_col)
                    ni_yoy  = get_metric(["Net Income", "NetIncome"],  q_inc, yoy_col)
                    if rev and rev_yoy and rev_yoy != 0:
                        result["revenue_yoy_pct"] = round((rev - rev_yoy) / abs(rev_yoy) * 100, 1)
                    if ni and ni_yoy and ni_yoy != 0:
                        result["net_income_yoy_pct"] = round((ni - ni_yoy) / abs(ni_yoy) * 100, 1)
        except Exception:
            pass

        # ── EPS actual (from earnings_dates) ─────────────────────────────────
        try:
            df_dates = ticker.earnings_dates
            if df_dates is not None and not df_dates.empty:
                now_utc = pd.Timestamp.now(tz="UTC")
                past = df_dates[df_dates.index < now_utc].head(1)
                if not past.empty:
                    row0 = past.iloc[0]
                    result["eps_actual"] = _safe_float(row0.get("Reported EPS"))
        except Exception:
            pass

        # ── Price reaction around earnings date ───────────────────────────────
        try:
            from datetime import date as date_cls
            ed = date_cls.fromisoformat(earnings_date.split("T")[0])
            start = (ed - timedelta(days=10)).isoformat()
            end   = (ed + timedelta(days=10)).isoformat()
            price_hist = yf.download(symbol, start=start, end=end,
                                     auto_adjust=True, progress=False)
            if isinstance(price_hist.columns, pd.MultiIndex):
                price_hist.columns = [c[0] for c in price_hist.columns]
            price_hist.columns = [c.capitalize() for c in price_hist.columns]
            if not price_hist.empty and "Close" in price_hist.columns:
                # Normalise the index to date strings
                idx = [d.date().isoformat() if hasattr(d, "date") else str(d)[:10]
                       for d in price_hist.index]
                ed_str = ed.isoformat()
                # Find the trading day immediately before earnings date
                before_days = [d for d in idx if d < ed_str]
                after_days  = [d for d in idx if d > ed_str]
                if before_days and after_days:
                    pb = _safe_float(price_hist["Close"].iloc[idx.index(before_days[-1])])
                    pa = _safe_float(price_hist["Close"].iloc[idx.index(after_days[0])])
                    result["price_before"] = pb
                    result["price_after"]  = pa
                    if pb and pa:
                        result["price_reaction_pct"] = round((pa - pb) / pb * 100, 2)
        except Exception:
            pass

        # ── Analyst info ─────────────────────────────────────────────────────
        try:
            info = ticker.info or {}
            result["analyst_target"]  = _safe_float(info.get("targetMeanPrice"))
            result["recommendation"]  = info.get("recommendationKey")
            result["current_price"]   = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
            result["forward_pe"]      = _safe_float(info.get("forwardPE"))
            result["revenue_growth"]  = _safe_float(info.get("revenueGrowth"))
            result["earnings_growth"] = _safe_float(info.get("earningsGrowth"))
        except Exception:
            pass

        # ── Recent news ───────────────────────────────────────────────────────
        try:
            news = ticker.news or []
            result["news_headlines"] = [
                n.get("title", "")
                for n in news[:6]
                if n.get("title")
            ]
        except Exception:
            pass

    except Exception as e:
        result["error"] = str(e)

    return result


def _build_call_summary_prompt(symbol: str, yf_data: dict, call_data: dict) -> str:
    """Build the Claude prompt for earnings call results summary."""
    name       = yf_data.get("long_name", symbol)
    sector     = yf_data.get("sector", "Unknown")
    surprise_h = yf_data.get("surprise_history", [])

    # Most recent quarter beat/miss
    most_recent = surprise_h[0] if surprise_h else None
    eps_est   = most_recent["eps_estimate"] if most_recent else None
    eps_act   = most_recent["eps_actual"]   if most_recent else None
    surp_pct  = most_recent["surprise_pct"] if most_recent else None
    call_date = most_recent["date"] if most_recent else yf_data.get("next_earnings_date", "unknown")

    # Try to figure out the quarter label
    try:
        from datetime import date as date_cls
        d = date_cls.fromisoformat(call_date.split("T")[0])
        q = (d.month - 1) // 3 + 1
        # Fiscal quarter (earnings typically reported ~1 quarter later)
        q_reported = ((q - 2) % 4) + 1
        year = d.year if q > 1 else d.year - 1
        quarter_label = f"Q{q_reported} FY{year}"
    except Exception:
        quarter_label = "Most Recent Quarter"

    rev_act   = call_data.get("revenue_actual")
    rev_yoy   = call_data.get("revenue_yoy_pct")
    ni_act    = call_data.get("net_income_actual")
    ni_yoy    = call_data.get("net_income_yoy_pct")
    gm_pct    = call_data.get("gross_margin_pct")
    oi        = call_data.get("operating_income")
    price_bef = call_data.get("price_before")
    price_aft = call_data.get("price_after")
    rxn_pct   = call_data.get("price_reaction_pct")
    headlines = call_data.get("news_headlines", [])

    def fmt_m(v):
        if v is None: return "N/A"
        v = float(v)
        if abs(v) >= 1e9: return f"${v/1e9:.2f}B"
        if abs(v) >= 1e6: return f"${v/1e6:.0f}M"
        return f"${v:,.0f}"

    rev_str = (f"{fmt_m(rev_act)}" + (f" ({rev_yoy:+.1f}% YoY)" if rev_yoy is not None else "")) if rev_act else "N/A"
    ni_str  = (f"{fmt_m(ni_act)}"  + (f" ({ni_yoy:+.1f}% YoY)"  if ni_yoy  is not None else "")) if ni_act  else "N/A"
    rxn_str = (f"{rxn_pct:+.1f}% ({price_bef:.2f} → {price_aft:.2f})" if rxn_pct is not None and price_bef and price_aft else "N/A")

    # Historical beat pattern
    if surprise_h:
        beats = sum(1 for h in surprise_h if h["surprise_pct"] > 0)
        hist_lines = [f"  • {h['date']}: EPS est ${h['eps_estimate']:.2f} → actual ${h['eps_actual']:.2f} ({h['surprise_pct']:+.1f}%)" for h in surprise_h]
        hist_txt = f"{beats}/{len(surprise_h)} quarters beat estimates\n" + "\n".join(hist_lines)
    else:
        hist_txt = "No historical data"

    news_txt = "\n".join(f"  • {h}" for h in headlines) if headlines else "  (none available)"

    # Current valuation context
    cp    = call_data.get("current_price") or yf_data.get("current_price") or 0
    at    = call_data.get("analyst_target") or yf_data.get("analyst_target")
    fpe   = call_data.get("forward_pe") or yf_data.get("forward_pe")
    rec   = call_data.get("recommendation") or yf_data.get("recommendation", "N/A")
    upside = f"{((at - cp) / cp * 100):+.1f}% to ${at:.2f}" if at and cp > 0 else "N/A"
    rev_e = yf_data.get("revenue_estimate")

    return f"""You are a senior equity research analyst at a top-tier firm. Summarize the most recent quarterly earnings results for {name} ({symbol}).

SECTOR: {sector}
EARNINGS DATE: {call_date} ({quarter_label})

RESULTS vs ESTIMATES:
  EPS: estimate ${eps_est:.2f} → actual ${eps_act:.2f} ({surp_pct:+.1f}% surprise) {('✓ BEAT' if surp_pct and surp_pct > 0 else '✗ MISS') if surp_pct is not None else ''}
  Revenue (actual): {rev_str}
  Revenue estimate: {fmt_m(rev_e) if rev_e else "N/A"}
  Net Income: {ni_str}
  Gross Margin: {f"{gm_pct:.1f}%" if gm_pct else "N/A"}
  Operating Income: {fmt_m(oi)}

STOCK PRICE REACTION (day after earnings):
  {rxn_str}

HISTORICAL BEAT/MISS PATTERN:
{hist_txt}

CURRENT VALUATION CONTEXT:
  Stock price: ${cp:.2f}
  Analyst mean target: {upside}
  Forward P/E: {f"{fpe:.1f}x" if fpe else "N/A"}
  Analyst consensus: {rec}

RECENT NEWS HEADLINES (context):
{news_txt}

Based on this data, write a COMPREHENSIVE earnings call summary that a retail investor can understand. Be specific — cite actual numbers.

Return ONLY valid JSON (no markdown, no text outside the JSON):
{{
  "quarter": "{quarter_label}",
  "call_date": "{call_date}",
  "headline": "<One punchy sentence summarising the key takeaway (max 15 words)>",
  "what_happened": "<2-3 sentences: revenue beat/miss, EPS beat/miss, key growth metrics. Cite actual numbers.>",
  "vs_estimates": "<1-2 sentences: precisely how results compared to consensus estimates. Bullish or disappointing?>",
  "management_tone": "optimistic" | "cautious" | "neutral" | "mixed",
  "key_highlights": [
    "<Highlight 1 — specific metric or announcement with number>",
    "<Highlight 2>",
    "<Highlight 3>",
    "<Highlight 4>"
  ],
  "guidance": "<What management said about the next quarter or full year. If no data, say 'Guidance not available in data'.>",
  "near_term_outlook": "<1-3 month price impact: what does this result mean for the stock near term? Reference the actual price reaction if it happened. Be specific.>",
  "long_term_outlook": "<6-12 month thesis: does this quarter change or reinforce the long-term investment case? Cite specific metrics.>",
  "price_reaction_pct": {rxn_pct if rxn_pct is not None else 'null'},
  "eps_surprise_pct": {surp_pct if surp_pct is not None else 'null'},
  "action": "buy" | "hold" | "trim" | "sell",
  "action_reasoning": "<1-2 sentences explaining the action with specific reference to valuation and results.>",
  "risk": "<The single most important risk to watch after this earnings report.>"
}}"""


@router.post("/{symbol}/call-summary")
def call_summary_endpoint(
    symbol: str,
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    """Generate and cache a comprehensive summary of the most recent earnings call results."""
    api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"error": "No Anthropic API key — add it in profile settings."}

    symbol = symbol.upper()
    now    = datetime.utcnow()
    SUMMARY_STALE_HOURS = 72  # re-generate after 3 days

    row = _get_or_refresh(symbol, db)
    yf_data = json.loads(row.yf_data) if row.yf_data else {}

    # Return cached summary if fresh
    if (
        row.call_summary
        and row.last_summarized
        and (now - row.last_summarized) < timedelta(hours=SUMMARY_STALE_HOURS)
    ):
        return json.loads(row.call_summary)

    # Need a past earnings date to summarize
    surprise_h = yf_data.get("surprise_history", [])
    if not surprise_h:
        return {"error": f"No historical earnings data available for {symbol}. Try refreshing the data first."}

    earnings_date = surprise_h[0]["date"]  # most recent past quarter
    call_data     = _fetch_call_data(symbol, earnings_date)

    if call_data.get("error"):
        return {"error": f"Could not fetch quarterly data: {call_data['error']}"}

    prompt = _build_call_summary_prompt(symbol, yf_data, call_data)

    try:
        client  = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        # Strip markdown fences
        if raw.startswith("```"):
            parts = raw.split("```")
            for part in parts[1:]:
                part = part.lstrip("json").strip()
                if part:
                    raw = part
                    break
        raw = raw.strip()
        # Balanced brace extraction
        start = raw.find("{")
        if start == -1:
            return {"error": "Claude returned no JSON object."}
        depth = 0; in_str = False; esc = False
        result_json = None
        for i, ch in enumerate(raw[start:], start):
            if esc: esc = False; continue
            if ch == "\\" and in_str: esc = True; continue
            if ch == '"': in_str = not in_str; continue
            if in_str: continue
            if ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    result_json = json.loads(raw[start: i + 1])
                    break
        if result_json is None:
            return {"error": "Incomplete JSON in Claude response."}

        # Inject any price reaction data that Claude might not have from the prompt
        if call_data.get("price_reaction_pct") is not None and result_json.get("price_reaction_pct") is None:
            result_json["price_reaction_pct"] = call_data["price_reaction_pct"]
        if surprise_h[0].get("surprise_pct") is not None and result_json.get("eps_surprise_pct") is None:
            result_json["eps_surprise_pct"] = surprise_h[0]["surprise_pct"]

        row.call_summary    = json.dumps(result_json)
        row.last_summarized = now
        db.commit()
        return result_json

    except anthropic.AuthenticationError:
        return {"error": "Invalid Anthropic API key."}
    except json.JSONDecodeError as e:
        return {"error": f"JSON parse error: {str(e)[:120]}"}
    except Exception as e:
        return {"error": str(e)[:200]}
