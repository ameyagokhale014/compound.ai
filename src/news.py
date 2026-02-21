# src/ui_news.py
from __future__ import annotations

import datetime as dt
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import streamlit as st
import yfinance as yf

from .portfolio import get_positions
from .market import last_price


# ----------------------------
# Ollama (local) helper
# ----------------------------
def _ollama_available() -> bool:
    try:
        import requests
        r = requests.get("http://localhost:11434/api/tags", timeout=1.5)
        return r.status_code == 200
    except Exception:
        return False


def _ollama_generate(prompt: str, model: str = "llama3.1", temperature: float = 0.2) -> str:
    """
    Local Ollama call. Requires: `ollama serve` running.
    """
    import requests

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temperature},
    }
    r = requests.post("http://localhost:11434/api/generate", json=payload, timeout=60)
    r.raise_for_status()
    data = r.json()
    return (data.get("response") or "").strip()


# ----------------------------
# Earnings + news helpers
# ----------------------------
def _safe_first(x):
    if x is None:
        return None
    if isinstance(x, (list, tuple)) and len(x) > 0:
        return x[0]
    return x


def _next_earnings_date(t: yf.Ticker) -> Optional[str]:
    """
    Best-effort next earnings date using yfinance ticker.calendar.
    """
    try:
        cal = t.calendar
        # yfinance calendar shape varies; handle common cases
        if isinstance(cal, pd.DataFrame) and not cal.empty:
            # Often index contains 'Earnings Date'
            if "Earnings Date" in cal.index:
                v = cal.loc["Earnings Date"].values
                d = _safe_first(v)
                if d is not None:
                    d = pd.to_datetime(d).date()
                    return d.isoformat()
        elif isinstance(cal, dict):
            v = cal.get("Earnings Date") or cal.get("EarningsDate") or cal.get("earningsDate")
            if v is not None:
                if isinstance(v, (list, tuple)) and len(v) > 0:
                    v = v[0]
                d = pd.to_datetime(v).date()
                return d.isoformat()
    except Exception:
        pass
    return None


def _last_earnings_highlights(t: yf.Ticker) -> List[str]:
    """
    "Highlights" without transcripts (free source limitation).
    Uses yfinance quarterly_earnings / quarterly_financials when available.
    """
    bullets: List[str] = []

    # Quarterly earnings (EPS + Revenue)
    try:
        qe = t.quarterly_earnings  # columns: Earnings, Revenue; index: quarter end
        if isinstance(qe, pd.DataFrame) and not qe.empty:
            qe = qe.sort_index()
            last_q = qe.iloc[-1]
            q_end = qe.index[-1]
            q_label = pd.to_datetime(q_end).date().isoformat()
            earnings = last_q.get("Earnings", None)
            revenue = last_q.get("Revenue", None)
            if earnings is not None:
                bullets.append(f"Last reported quarter end: {q_label}")
                bullets.append(f"Quarterly earnings (net): {earnings:,.2f}")
            if revenue is not None:
                bullets.append(f"Quarterly revenue: {revenue:,.2f}")
    except Exception:
        pass

    # Fallback: basic info fields
    try:
        info = t.info or {}
        if not bullets:
            bullets.append("Earnings transcript not available via free source.")
        # Add a few useful context points if present
        eps = info.get("trailingEps")
        fwd_eps = info.get("forwardEps")
        if eps is not None:
            bullets.append(f"Trailing EPS: {float(eps):.2f}")
        if fwd_eps is not None:
            bullets.append(f"Forward EPS: {float(fwd_eps):.2f}")
    except Exception:
        pass

    if not bullets:
        bullets = ["No earnings data available from the free provider for this ticker."]
    return bullets[:6]


def _recent_news_items(t: yf.Ticker, max_items: int = 5) -> List[Dict[str, Any]]:
    try:
        items = t.news or []
        # normalize: title/link/publisher/time
        out = []
        for it in items[:max_items]:
            out.append(
                {
                    "title": it.get("title") or "Untitled",
                    "publisher": it.get("publisher") or "",
                    "link": it.get("link") or "",
                    "time": it.get("providerPublishTime"),
                }
            )
        return out
    except Exception:
        return []


def _format_news_md(items: List[Dict[str, Any]]) -> str:
    lines = []
    for it in items:
        title = it.get("title") or "Untitled"
        publisher = it.get("publisher") or ""
        when = ""
        ts = it.get("time")
        if ts:
            try:
                when = pd.to_datetime(int(ts), unit="s").strftime("%Y-%m-%d")
            except Exception:
                when = ""
        tail = " · ".join([x for x in [publisher, when] if x])
        if tail:
            lines.append(f"- **{title}** — {tail}")
        else:
            lines.append(f"- **{title}**")
        if it.get("link"):
            lines.append(f"  \n  {it['link']}")
    return "\n".join(lines).strip()


# ----------------------------
# Main renderer
# ----------------------------
def render_portfolio_news_tab():
    st.subheader("Portfolio News (LLM)")

    # Manual refresh button (forces fresh fetches)
    c1, c2 = st.columns([1, 6], vertical_alignment="center")
    with c1:
        if st.button("Refresh", use_container_width=True):
            st.rerun()

    # Always read positions fresh (no caching)
    rows = get_positions()

    if not rows:
        st.info("No positions yet. Add positions to see portfolio news.")
        return

    df = pd.DataFrame(rows, columns=["Ticker", "Quantity", "Avg Price"])
    df["Ticker"] = df["Ticker"].astype(str).str.upper().str.strip()

    # Cash handling
    CASH_DB_TICKER = "CASH"
    CASH_DISPLAY_TICKER = "CASH ($)"
    df.loc[df["Ticker"] == CASH_DB_TICKER, "Ticker"] = CASH_DISPLAY_TICKER

    # Compute market values for weights
    def _lp(tkr: str) -> float:
        if tkr == CASH_DISPLAY_TICKER:
            return 1.0
        v = last_price(tkr)
        return float(v) if v is not None else 0.0

    df["Last Price"] = df["Ticker"].apply(_lp)
    df["Market Value"] = df["Quantity"].astype(float) * df["Last Price"].astype(float)

    total_mv = float(df["Market Value"].sum())
    if total_mv <= 0:
        st.info("Portfolio market value is 0. Add positions to see portfolio news.")
        return

    df["% of Portfolio"] = (df["Market Value"] / total_mv) * 100.0
    df["% of Portfolio"] = df["% of Portfolio"].round(2)

    # Ollama status
    use_llm = _ollama_available()
    if not use_llm:
        st.warning("Ollama is not reachable on localhost:11434. News summaries will be skipped.")

    # Render one section per ticker (largest to smallest)
    df = df.sort_values("% of Portfolio", ascending=False).reset_index(drop=True)

    for _, r in df.iterrows():
        tkr = r["Ticker"]
        weight = float(r["% of Portfolio"])

        with st.expander(f"{tkr} — {weight:.2f}% of portfolio", expanded=True):
            if tkr == CASH_DISPLAY_TICKER:
                st.write("Cash position (USD). No earnings/news.")
                st.write(f"**% of Portfolio:** {weight:.2f}%")
                continue

            t = yf.Ticker(tkr)

            # Next earnings date
            next_ed = _next_earnings_date(t)
            if next_ed:
                st.caption(f"**Next earnings (provider):** {next_ed}")
            else:
                st.caption("**Next earnings (provider):** N/A")

            # Last earnings highlights
            st.markdown("#### Last earnings call highlights (best-effort, free source)")
            for b in _last_earnings_highlights(t):
                st.markdown(f"- {b}")

            # Recent news
            st.markdown("#### Recent news that might affect price")
            items = _recent_news_items(t, max_items=5)
            if not items:
                st.info("No recent news available from provider.")
            else:
                st.markdown(_format_news_md(items))

                # LLM summary (optional)
                if use_llm:
                    # Build prompt from headlines only (fast + safe)
                    headlines = "\n".join([f"- {it['title']}" for it in items if it.get("title")])
                    prompt = f"""
You are a cautious financial news analyst. Summarize the likely stock-impacting themes from these headlines for {tkr}.
Return:
1) 3 bullet "What happened"
2) 3 bullet "Why it could move the stock"
3) 1 bullet "What to watch next"
Avoid making up facts. Use only the headlines.

Headlines:
{headlines}
""".strip()

                    with st.spinner("Summarizing with local LLM..."):
                        try:
                            summary = _ollama_generate(prompt, model="llama3.1", temperature=0.2)
                            if summary:
                                st.markdown("**LLM Summary**")
                                st.write(summary)
                        except Exception as e:
                            st.warning(f"LLM summary failed: {e}")

            st.divider()
            st.caption("Note: Earnings transcript highlights require paid/transcript sources; this uses free provider fields only.")