# src/ui_news.py
from __future__ import annotations

import math
import pandas as pd
import streamlit as st
import requests
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus

from src.portfolio import get_positions
from src.market import last_price, get_fundamentals
from src.llm import llm_summarize, LLMError


# -----------------------------
# Formatting helpers
# -----------------------------
def _fmt2(x) -> str:
    try:
        if x is None:
            return "N/A"
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return "N/A"
        return f"{v:,.2f}"
    except Exception:
        return "N/A"


def _pct2(x) -> str:
    try:
        if x is None:
            return "N/A"
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return "N/A"
        return f"{v:.2f}%"
    except Exception:
        return "N/A"


def _nonempty_str(x) -> str:
    s = (x or "")
    s = str(s).strip()
    return s


# -----------------------------
# Google News RSS (no API key)
# -----------------------------
def _google_news_rss_url(query: str) -> str:
    # Google News RSS Search endpoint (free, no key)
    # Example format documented widely:
    # https://news.google.com/rss/search?q=NVDA%20stock&hl=en-US&gl=US&ceid=US:en
    q = quote_plus(query)
    return f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


def _fetch_google_news(ticker: str, max_items: int = 8) -> list[dict]:
    """
    Returns items like:
      {"title": "...", "link": "...", "publisher": "...", "date": "..."}
    """
    t = ticker.upper().strip()

    # Make the query more ticker-specific to reduce cross-contamination
    # (Still free-form search, but much better than yfinance.news)
    query = f'{t} stock'

    url = _google_news_rss_url(query)

    try:
        resp = requests.get(
            url,
            timeout=10,
            headers={
                "User-Agent": "compoundai/1.0 (news; contact: local)",
                "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
            },
        )
        resp.raise_for_status()
    except Exception:
        return []

    try:
        root = ET.fromstring(resp.text)
    except Exception:
        return []

    # RSS structure: <rss><channel><item>...
    channel = root.find("channel")
    if channel is None:
        return []

    out: list[dict] = []
    for item in channel.findall("item"):
        title = _nonempty_str(item.findtext("title"))
        link = _nonempty_str(item.findtext("link"))
        pub_date = _nonempty_str(item.findtext("pubDate"))

        # Google News includes source in <source>
        source_el = item.find("source")
        publisher = _nonempty_str(source_el.text if source_el is not None else "")

        if not title:
            continue

        out.append(
            {
                "title": title,
                "link": link,
                "publisher": publisher,
                "date": pub_date,
            }
        )
        if len(out) >= max_items:
            break

    return out


def _fallback_links(ticker: str) -> list[str]:
    t = ticker.upper().strip()
    return [
        f"- Google News search: https://news.google.com/search?q={t}%20stock",
        f"- Yahoo Finance: https://finance.yahoo.com/quote/{t}",
        f"- SEC filings: https://www.sec.gov/edgar/search/#/q={t}",
    ]


# -----------------------------
# UI
# -----------------------------
def render_news_tab():
    st.markdown("## Portfolio News (LLM)")

    rows = get_positions()  # always fresh
    if not rows:
        st.info("No positions yet. Add positions to see portfolio news.")
        return

    dfp = pd.DataFrame(rows, columns=["Ticker", "Quantity", "Avg Price"])
    dfp["Ticker"] = dfp["Ticker"].astype(str).str.upper().str.strip()
    dfp["Quantity"] = pd.to_numeric(dfp["Quantity"], errors="coerce").fillna(0.0)
    dfp["Avg Price"] = pd.to_numeric(dfp["Avg Price"], errors="coerce").fillna(0.0)

    # Compute Market Value with robust fallbacks:
    # 1) src.market.last_price()
    # 2) fallback to Avg Price so weights don't become 0 if price provider fails
    mv_rows = []
    for _, r in dfp.iterrows():
        t = str(r["Ticker"]).upper().strip()
        qty = float(r["Quantity"])
        avg = float(r["Avg Price"])

        if t == "CASH":
            px = 1.0
            mv = qty
            display = "CASH ($)"
        else:
            px = last_price(t)
            if px is None or (isinstance(px, (int, float)) and px <= 0):
                px = avg if avg > 0 else None
            mv = (qty * px) if px is not None else 0.0
            display = t

        mv_rows.append({"Ticker": t, "Display": display, "Last Price": px, "Market Value": mv})

    mvdf = pd.DataFrame(mv_rows)
    total_mv = float(mvdf["Market Value"].sum()) if not mvdf.empty else 0.0
    mvdf["% of Portfolio"] = (mvdf["Market Value"] / total_mv * 100.0) if total_mv > 0 else 0.0

    # Render per STOCK (skip cash)
    # Render per STOCK (skip cash) — sorted by weight descending
    stock_rows = mvdf[mvdf["Ticker"].astype(str).str.upper().str.strip() != "CASH"].copy()
    stock_rows["% of Portfolio"] = pd.to_numeric(stock_rows["% of Portfolio"], errors="coerce").fillna(0.0)

    stock_rows = stock_rows.sort_values("% of Portfolio", ascending=False)
    tickers = stock_rows["Ticker"].astype(str).tolist()

    for t in tickers:
        row = mvdf[mvdf["Ticker"] == t]
        weight = float(row["% of Portfolio"].iloc[0]) if not row.empty else 0.0
        px = row["Last Price"].iloc[0] if not row.empty else None
        mv = row["Market Value"].iloc[0] if not row.empty else 0.0

        st.markdown(f"### {t}  ·  {_pct2(weight)} of portfolio")

        # Top info
        f = get_fundamentals(t)
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Last Price", _fmt2(px))
        c2.metric("Market Value ($)", _fmt2(mv))
        c3.metric("Forward PE", _fmt2(f.get("forward_pe")))
        c4.metric("Forward PEG", _fmt2(f.get("forward_peg")))

        # Earnings (free providers vary; keep as best-effort message for now)
        st.caption("Next earnings: not available from free provider for this ticker.")

        st.markdown("**Last earnings call highlights (best-effort, free source)**")
        st.markdown("- Earnings transcripts are usually paywalled; next upgrade: SEC filings + IR press release summarization.")

        # Recent news (GOOGLE NEWS RSS)
        st.markdown("**Recent news that might affect price**")
        news_items = _fetch_google_news(t, max_items=8)

        if news_items:
            lines = []
            for n in news_items:
                title = _nonempty_str(n.get("title"))
                link = _nonempty_str(n.get("link"))
                pub = _nonempty_str(n.get("publisher"))
                dt = _nonempty_str(n.get("date"))
                meta = " · ".join([x for x in [pub, dt] if x])

                if link:
                    lines.append(f"- **{title}**{(' — ' + meta) if meta else ''}\n  {link}")
                else:
                    lines.append(f"- **{title}**{(' — ' + meta) if meta else ''}")

            st.markdown("\n".join(lines))
        else:
            st.info("No headlines returned from free RSS right now. Here are reliable links:")
            st.markdown("\n".join(_fallback_links(t)))

        # LLM summary
        with st.expander("LLM summary of recent news", expanded=True):
            if news_items:
                blob = f"{t} news headlines:\n" + "\n".join([_nonempty_str(n.get("title")) for n in news_items])
            else:
                blob = f"{t} — summarize what matters to watch for this stock from general context and typical drivers."

            try:
                summary = llm_summarize(
                    blob,
                    system=(
                        "Summarize in 3 bullets: "
                        "1) what happened, 2) why it matters, 3) what to watch next. "
                        "No hype. No investment advice."
                    ),
                )
                st.write(summary)
            except LLMError as e:
                st.warning(str(e))
            except Exception as e:
                st.warning(f"LLM summary failed: {e}")

        st.divider()