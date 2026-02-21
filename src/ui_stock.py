# src/ui_stock.py
from __future__ import annotations

import math
from typing import Optional, Tuple, Dict

import pandas as pd
import streamlit as st
import yfinance as yf
import plotly.express as px
from src.metrics import compute_peg
from src.llm_local import llm_generate

# ✅ NEW imports for Google News RSS
import requests
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus

# ✅ Reverse DCF helpers (simple, constant FCF growth for N years)
def _safe_float(x, default=None):
    try:
        if x is None:
            return default
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return default
        return v
    except Exception:
        return default


def _pv_from_growth(
    fcf0: float,
    g: float,
    years: int,
    wacc: float,
    terminal_g: float,
) -> float:
    """
    Simple DCF:
      FCF_t = FCF0 * (1+g)^t for t=1..N
      Terminal Value at year N:
        TV = FCF_N * (1+terminal_g) / (wacc - terminal_g)
      PV = sum(FCF_t/(1+wacc)^t) + TV/(1+wacc)^N
    """
    if years <= 0:
        return 0.0
    if wacc <= terminal_g:
        # invalid terminal (explodes)
        return float("nan")

    pv = 0.0
    for t in range(1, years + 1):
        fcf_t = fcf0 * ((1.0 + g) ** t)
        pv += fcf_t / ((1.0 + wacc) ** t)

    fcf_n = fcf0 * ((1.0 + g) ** years)
    tv = fcf_n * (1.0 + terminal_g) / (wacc - terminal_g)
    pv += tv / ((1.0 + wacc) ** years)
    return pv


def _solve_implied_growth(
    target_equity_value: float,
    fcf0: float,
    years: int,
    wacc: float,
    terminal_g: float,
    lo: float = -0.50,
    hi: float = 1.50,
    iters: int = 80,
) -> float | None:
    """
    Binary search for constant annual growth g such that PV ~= target equity value.
    Returns g (e.g. 0.12 = 12%) or None if not solvable with bounds.
    """
    if target_equity_value <= 0 or fcf0 <= 0 or years <= 0 or wacc <= 0:
        return None
    if wacc <= terminal_g:
        return None

    pv_lo = _pv_from_growth(fcf0, lo, years, wacc, terminal_g)
    pv_hi = _pv_from_growth(fcf0, hi, years, wacc, terminal_g)

    if not (pv_lo == pv_lo and pv_hi == pv_hi):  # NaN check
        return None

    # We need target in [pv_lo, pv_hi] (monotonic in g)
    if target_equity_value < pv_lo or target_equity_value > pv_hi:
        return None

    a, b = lo, hi
    for _ in range(iters):
        m = (a + b) / 2.0
        pv_m = _pv_from_growth(fcf0, m, years, wacc, terminal_g)
        if pv_m >= target_equity_value:
            b = m
        else:
            a = m
    return (a + b) / 2.0


def _render_reverse_dcf_case(case_name: str, defaults: dict, info: dict):
    """
    Renders one case (bear/base/bull) with minimal required inputs.
    """
    st.markdown(f"#### {case_name}")

    # Best-effort prefills from yfinance info
    price_prefill = _safe_float(info.get("currentPrice")) or _safe_float(info.get("regularMarketPrice"))
    shares_prefill = _safe_float(info.get("sharesOutstanding"))
    mcap_prefill = _safe_float(info.get("marketCap"))
    fcf_prefill = _safe_float(info.get("freeCashflow"))  # may be None in many cases

    c1, c2, c3 = st.columns(3)
    with c1:
        price = st.number_input(
            "Current Price ($)",
            min_value=0.0,
            value=float(price_prefill) if price_prefill else float(defaults.get("price", 0.0)),
            step=1.0,
            key=f"dcf_price_{case_name}",
        )
        years = st.number_input(
            "Forecast Years",
            min_value=3,
            max_value=20,
            value=int(defaults.get("years", 10)),
            step=1,
            key=f"dcf_years_{case_name}",
        )

    with c2:
        # If market cap is available, let user use it directly (no shares needed)
        use_mcap = st.checkbox(
            "Use Market Cap as target",
            value=True if mcap_prefill else False,
            key=f"dcf_use_mcap_{case_name}",
        )
        if use_mcap:
            target_equity = st.number_input(
                "Target Equity Value / Market Cap ($)",
                min_value=0.0,
                value=float(mcap_prefill) if mcap_prefill else float(defaults.get("target_equity", 0.0)),
                step=1_000_000.0,
                key=f"dcf_target_equity_{case_name}",
                help="Reverse DCF solves for the growth rate implied by this equity value.",
            )
            shares = None
        else:
            shares = st.number_input(
                "Shares Outstanding",
                min_value=0.0,
                value=float(shares_prefill) if shares_prefill else float(defaults.get("shares", 0.0)),
                step=1_000_000.0,
                key=f"dcf_shares_{case_name}",
            )
            target_equity = price * shares if shares and price else 0.0

    with c3:
        # FCF input (kept simple)
        fcf0 = st.number_input(
            "Trailing/Current FCF ($)",
            min_value=0.0,
            value=float(fcf_prefill) if fcf_prefill else float(defaults.get("fcf0", 0.0)),
            step=1_000_000.0,
            key=f"dcf_fcf0_{case_name}",
            help="Use trailing twelve month free cash flow (best effort). If missing, paste from a finance site.",
        )

    c4, c5, c6 = st.columns(3)
    with c4:
        wacc = st.number_input(
            "Discount rate / WACC (%)",
            min_value=0.1,
            max_value=50.0,
            value=float(defaults.get("wacc_pct", 10.0)),
            step=0.1,
            key=f"dcf_wacc_{case_name}",
        ) / 100.0
    with c5:
        terminal_g = st.number_input(
            "Terminal growth (%)",
            min_value=-5.0,
            max_value=10.0,
            value=float(defaults.get("terminal_g_pct", 3.0)),
            step=0.1,
            key=f"dcf_terminal_g_{case_name}",
        ) / 100.0
    with c6:
        g_lo = st.number_input(
            "Search min growth (%)",
            min_value=-90.0,
            max_value=200.0,
            value=float(defaults.get("g_lo_pct", -20.0)),
            step=1.0,
            key=f"dcf_glo_{case_name}",
        ) / 100.0
        g_hi = st.number_input(
            "Search max growth (%)",
            min_value=-90.0,
            max_value=200.0,
            value=float(defaults.get("g_hi_pct", 50.0)),
            step=1.0,
            key=f"dcf_ghi_{case_name}",
        ) / 100.0

    # Solve
    if target_equity <= 0 or fcf0 <= 0:
        st.info("Enter a positive Target Equity Value (or Shares+Price) and a positive FCF to compute implied growth.")
        return

    implied_g = _solve_implied_growth(
        target_equity_value=float(target_equity),
        fcf0=float(fcf0),
        years=int(years),
        wacc=float(wacc),
        terminal_g=float(terminal_g),
        lo=float(g_lo),
        hi=float(g_hi),
    )

    if implied_g is None:
        st.warning(
            "Could not solve within bounds. Try widening the growth search range, "
            "or verify FCF / discount rate / terminal growth."
        )
        return

    # Display implied growth (rounded to 2 decimals per your rule)
    st.success(f"Implied annual FCF growth (Years 1–{int(years)}): **{implied_g*100.0:.2f}%**")

    # Quick sanity check: compute PV at implied_g and show gap
    pv = _pv_from_growth(float(fcf0), float(implied_g), int(years), float(wacc), float(terminal_g))
    gap = pv - float(target_equity)
    st.caption(
        f"Check: PV = {_fmt2(pv)} vs Target = {_fmt2(target_equity)} (gap {_fmt2(gap)}). "
        "This is a simplified constant-growth reverse DCF."
    )


# ----------------------------
# Formatting helpers (2 decimals max)
# ----------------------------
def _fmt2(x) -> str:
    if x is None:
        return "N/A"
    try:
        if isinstance(x, str):
            return x
        if isinstance(x, (int, float)) and (math.isnan(x) if isinstance(x, float) else False):
            return "N/A"
        return f"{float(x):,.2f}"
    except Exception:
        return "N/A"


def _pct2(x) -> str:
    if x is None:
        return "N/A"
    try:
        if isinstance(x, (int, float)) and (math.isnan(x) if isinstance(x, float) else False):
            return "N/A"
        return f"{float(x):,.2f}%"
    except Exception:
        return "N/A"


def _to_year_index(cols) -> pd.Index:
    # yfinance annual statements usually have Datetime-like columns
    years = []
    for c in cols:
        try:
            years.append(pd.to_datetime(c).year)
        except Exception:
            # sometimes already "2024-12-31" strings
            try:
                years.append(int(str(c)[:4]))
            except Exception:
                years.append(str(c))
    return pd.Index(years)


def _extract_annual_series(
    df: Optional[pd.DataFrame],
    keys: list[str],
    label: str,
    years: int = 10,
) -> Optional[pd.Series]:
    """
    df: yfinance statement dataframe (rows are metrics, columns are periods)
    keys: possible row names to try in order
    """
    if df is None or df.empty:
        return None

    # standardize
    df2 = df.copy()
    df2.columns = _to_year_index(df2.columns)

    s = None
    for k in keys:
        if k in df2.index:
            s = df2.loc[k]
            break

    if s is None:
        return None

    # Make it numeric, sort by year asc, keep last N years
    s = pd.to_numeric(s, errors="coerce")
    s = s[~s.index.duplicated(keep="last")]
    s = s.sort_index()
    s = s.tail(years)
    s.name = label
    return s


def _yoy_growth_pct(s: Optional[pd.Series], label: str) -> Optional[pd.Series]:
    if s is None or s.empty:
        return None
    g = s.pct_change() * 100.0
    g = g.replace([float("inf"), float("-inf")], pd.NA)
    g.name = label
    return g


def _bar_chart_years(
    s: pd.Series,
    title: str,
    yaxis_title: str = "",
    is_percent: bool = False,
):
    """
    Bar chart with X axis = years only (no months),
    bars close together (low bargap).
    """
    dfp = pd.DataFrame({"Year": s.index.astype(int), "Value": s.values})
    # Plotly gives the user an easy fullscreen button in the modebar.
    fig = px.bar(dfp, x="Year", y="Value", title=title)
    fig.update_layout(
        xaxis_title="Year",
        yaxis_title=yaxis_title,
        bargap=0.08,  # close bars (less gap)
        margin=dict(l=10, r=10, t=40, b=10),
        height=320,
    )
    fig.update_xaxes(type="category")  # ensures year ticks only, no date scaling
    if is_percent:
        fig.update_yaxes(tickformat=".2f")
    st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": True})


# ✅ NEW: Google News RSS helpers (ticker-specific, no API key)
def _google_news_rss_url(query: str) -> str:
    q = quote_plus(query)
    return f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


def _fetch_google_news(ticker: str, max_items: int = 3) -> list[dict]:
    """
    Returns items like:
      {"title": "...", "link": "...", "publisher": "...", "date": "..."}
    """
    t = (ticker or "").upper().strip()
    query = f"{t} stock"
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

    channel = root.find("channel")
    if channel is None:
        return []

    out: list[dict] = []
    for item in channel.findall("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()

        source_el = item.find("source")
        publisher = (source_el.text or "").strip() if source_el is not None else ""

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


@st.cache_data(show_spinner=False, ttl=60 * 60)
def _load_ticker_bundle(ticker: str) -> Tuple[dict, list, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    t = yf.Ticker(ticker)
    info = t.info or {}
    news = t.news or []

    # Prefer newer yfinance names, fallback to older ones
    income = getattr(t, "income_stmt", None)
    if income is None or (isinstance(income, pd.DataFrame) and income.empty):
        income = getattr(t, "financials", pd.DataFrame())

    cashflow = getattr(t, "cashflow", pd.DataFrame())
    balance = getattr(t, "balance_sheet", pd.DataFrame())

    # Ensure dataframes
    income = income if isinstance(income, pd.DataFrame) else pd.DataFrame()
    cashflow = cashflow if isinstance(cashflow, pd.DataFrame) else pd.DataFrame()
    balance = balance if isinstance(balance, pd.DataFrame) else pd.DataFrame()

    return info, news, income, cashflow, balance


def render_stock_page(ticker: str):
    ticker = (ticker or "").upper().strip()
    if not ticker:
        st.info("Pick a ticker to view details.")
        return

    # ----------------------------
    # Header
    # ----------------------------
    info, news, income, cashflow, balance = _load_ticker_bundle(ticker)
        # ------------------------------------------------------------
    # ALWAYS initialize these so they exist on every rerun
    # (prevents UnboundLocalError when buttons/forms trigger reruns)
    # ------------------------------------------------------------
    trailing_eps = None
    forward_eps = None
    forward_pe = None
    peg = None

    # Assign from provider safely
    try:
        trailing_eps = info.get("trailingEps")
        forward_eps = info.get("forwardEps")
        forward_pe = info.get("forwardPE")

        # Prefer provider PEG, else compute a fallback only if you have growth
        peg = info.get("pegRatio")
        if peg is None:
            eg = info.get("earningsGrowth")  # e.g., 0.25 for 25%
            if eg is not None and forward_pe is not None:
                eg_pct = float(eg) * 100.0
                if eg_pct > 0 and float(forward_pe) > 0:
                    # PEG = PE / growth% (standard)
                    peg = float(forward_pe) / eg_pct
    except Exception:
        # Keep them as None if anything goes wrong
        trailing_eps, forward_eps, forward_pe, peg = None, None, None, None

    # ----------------------------
    # Snapshot metrics (2 decimals)
    # ----------------------------
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Trailing EPS", _fmt2(trailing_eps))
    c2.metric("Forward EPS", _fmt2(forward_eps))
    c3.metric("Forward PE", _fmt2(forward_pe))
    c4.metric("PEG", _fmt2(peg))

    company_name = info.get("longName") or info.get("shortName") or ticker
    exch = info.get("exchange") or info.get("fullExchangeName") or ""
    sector = info.get("sector") or "N/A"
    industry = info.get("industry") or "N/A"
    website = info.get("website") or ""

    st.markdown(f"## {company_name}")
    st.caption(f"**{ticker}**{(' · ' + exch) if exch else ''} · {sector} · {industry}")
    if website:
        st.caption(website)

    # ----------------------------
    # Company overview (no LLM)
    # ----------------------------
    summary = info.get("longBusinessSummary") or ""
    if summary:
        with st.expander("Company Overview", expanded=True):
            st.write(summary)
    else:
        st.info("No company overview available from the data provider.")

    st.divider()

    # ----------------------------
    # Top news (2–3)  ✅ UPDATED: Google News RSS
    # ----------------------------
    st.markdown("### Latest News")

    google_news = _fetch_google_news(ticker, max_items=3)
    if not google_news:
        st.info("No recent news available from Google News RSS right now.")
    else:
        for item in google_news:
            title = item.get("title") or "Untitled"
            publisher = item.get("publisher") or ""
            when = item.get("date") or ""
            link = item.get("link") or ""

            line = f"- **{title}**"
            if publisher or when:
                line += f" — {publisher}{(' · ' + when) if when else ''}"
            if link:
                line += f"  \n  {link}"
            st.markdown(line)

    st.divider()

        # ----------------------------
    # LLM: Ask about this stock (local Ollama)
    # ----------------------------
    st.markdown("### Ask about this stock (LLM)")

    qa_key = f"stock_llm_answer_{ticker}"
    if qa_key not in st.session_state:
        st.session_state[qa_key] = ""

    with st.form(f"stock_llm_form_{ticker}", clear_on_submit=False):
        user_q = st.text_input(
            "Ask a question",
            placeholder="e.g., Summarize the latest news, risks, and what to watch next quarter.",
            key=f"stock_llm_q_{ticker}",
        )
        submitted = st.form_submit_button("Ask")

    if submitted and user_q.strip():
        # Build lightweight context (no heavy calculations)
        top_items = news[:3] if news else []
        news_lines = []
        for it in top_items:
            title = it.get("title") or ""
            pub = it.get("publisher") or ""
            link = it.get("link") or ""
            news_lines.append(f"- {title} ({pub}): {link}")

        context = f"""
                    Ticker: {ticker}
                    Company: {company_name}
                    Sector: {sector}
                    Industry: {industry}

                    Company Summary:
                    {(summary or "")[:1500]}

                    Latest News (top 3):
                    {chr(10).join(news_lines) if news_lines else "No news returned by provider."}

                    Key Snapshot Metrics:
                    Trailing EPS: {trailing_eps}
                    Forward EPS: {forward_eps}
                    Forward PE: {forward_pe}
                    PEG (provider/computed): {peg}
                    """.strip()

        system = (
                    "You are a cautious financial research assistant. "
                    "Do NOT give personalized financial advice. "
                    "Be explicit about uncertainty. Keep responses structured and concise."
                )

        prompt = f"""
                Use the context below to answer the user question.

                Context:
                    {context}

                    User question:
                    {user_q}

                    Answer format:
                    - Direct answer (bullets if appropriate)
                    - Risks / caveats
                    - What to check next
                    """.strip()

        with st.spinner("Thinking (local Ollama)..."):
            st.session_state[qa_key] = llm_generate(prompt, system=system, temperature=0.2)

    if st.session_state[qa_key]:
        st.markdown("#### Response")
        st.write(st.session_state[qa_key])

    st.divider()


    # ----------------------------
    # Snapshot metrics (2 decimals)
    # ----------------------------
    trailing_eps = info.get("trailingEps")
    forward_eps = info.get("forwardEps")
    forward_pe = info.get("forwardPE")



    # ----------------------------
    # Financials (Charts) — grid of bar charts
    # ----------------------------
    st.markdown("### Financials (Charts)")

    # Annual series (last 10y)
    rev = _extract_annual_series(income, ["Total Revenue", "TotalRevenue", "Revenue"], "Revenue")
    gross = _extract_annual_series(income, ["Gross Profit", "GrossProfit"], "Gross Profit")
    ocf = _extract_annual_series(
        cashflow,
        ["Total Cash From Operating Activities", "Operating Cash Flow", "OperatingCashFlow"],
        "Operating Cash Flow",
    )
    fcf = _extract_annual_series(cashflow, ["Free Cash Flow", "FreeCashFlow"], "Free Cash Flow")

    # EPS (annual): yfinance often exposes earnings history differently; use info if needed.
    # We'll try to infer EPS from net income / shares when available is messy, so instead show earnings-based EPS if present.
    # Some tickers have "Diluted EPS" on income statement.
    eps = _extract_annual_series(income, ["Diluted EPS", "DilutedEPS", "Basic EPS", "BasicEPS"], "EPS")

    # Growth %
    rev_g = _yoy_growth_pct(rev, "Revenue Growth %")
    gross_g = _yoy_growth_pct(gross, "Gross Profit Growth %")
    ocf_g = _yoy_growth_pct(ocf, "Operating Cash Flow Growth %")
    fcf_g = _yoy_growth_pct(fcf, "Free Cash Flow Growth %")
    eps_g = _yoy_growth_pct(eps, "EPS Growth %")

    # Layout: 2 columns grid
    colA, colB = st.columns(2)

    with colA:
        if rev is not None and not rev.empty:
            _bar_chart_years(rev, "Revenue", yaxis_title="USD")
        else:
            st.info("No Revenue history available.")

    with colB:
        if gross is not None and not gross.empty:
            _bar_chart_years(gross, "Gross Profit", yaxis_title="USD")
        else:
            st.info("No Gross Profit history available.")

    colC, colD = st.columns(2)
    with colC:
        if ocf is not None and not ocf.empty:
            _bar_chart_years(ocf, "Operating Cash Flow", yaxis_title="USD")
        else:
            st.info("No Operating Cash Flow history available.")

    with colD:
        if fcf is not None and not fcf.empty:
            _bar_chart_years(fcf, "Free Cash Flow", yaxis_title="USD")
        else:
            st.info("No Free Cash Flow history available.")

    colE, colF = st.columns(2)
    with colE:
        if eps is not None and not eps.empty:
            _bar_chart_years(eps, "EPS", yaxis_title="USD")
        else:
            st.info("No EPS history available.")

    with colF:
        # show one growth chart by default (Revenue growth) to keep it clean;
        # you asked for growth % of KPIs — we show them all below as a grid.
        if rev_g is not None and not rev_g.dropna().empty:
            _bar_chart_years(rev_g.dropna(), "Revenue Growth % (YoY)", yaxis_title="%", is_percent=True)
        else:
            st.info("No Revenue growth history available.")

    # Growth grid (all requested growth %)
    # st.markdown("#### Growth % (YoY)")
    g1, g2 = st.columns(2)
    with g1:
        if gross_g is not None and not gross_g.dropna().empty:
            _bar_chart_years(gross_g.dropna(), "Gross Profit Growth % (YoY)", yaxis_title="%", is_percent=True)
        else:
            st.info("No Gross Profit growth history available.")
    with g2:
        if ocf_g is not None and not ocf_g.dropna().empty:
            _bar_chart_years(ocf_g.dropna(), "Operating Cash Flow Growth % (YoY)", yaxis_title="%", is_percent=True)
        else:
            st.info("No Operating Cash Flow growth history available.")

    g3, g4 = st.columns(2)
    with g3:
        if fcf_g is not None and not fcf_g.dropna().empty:
            _bar_chart_years(fcf_g.dropna(), "Free Cash Flow Growth % (YoY)", yaxis_title="%", is_percent=True)
        else:
            st.info("No Free Cash Flow growth history available.")
    with g4:
        if eps_g is not None and not eps_g.dropna().empty:
            _bar_chart_years(eps_g.dropna(), "EPS Growth % (YoY)", yaxis_title="%", is_percent=True)
        else:
            st.info("No EPS growth history available.")

    st.divider()

        # ----------------------------
    # Reverse DCF (Bear / Base / Bull)
    # ----------------------------
    st.markdown("### Reverse DCF (implied growth)")

    st.caption(
        "This is a simple reverse DCF: assumes Free Cash Flow grows at a constant rate for N years, "
        "then a terminal growth rate. It solves for the growth implied by today’s valuation. "
        "Not financial advice."
    )

    bear_defaults = {
        "years": 10,
        "wacc_pct": 12.0,
        "terminal_g_pct": 2.5,
        "g_lo_pct": -30.0,
        "g_hi_pct": 60.0,
    }
    base_defaults = {
        "years": 10,
        "wacc_pct": 10.0,
        "terminal_g_pct": 3.0,
        "g_lo_pct": -20.0,
        "g_hi_pct": 60.0,
    }
    bull_defaults = {
        "years": 10,
        "wacc_pct": 8.5,
        "terminal_g_pct": 3.5,
        "g_lo_pct": -10.0,
        "g_hi_pct": 80.0,
    }

    tab_bear, tab_base, tab_bull = st.tabs(["Bear", "Base", "Bull"])
    with tab_bear:
        _render_reverse_dcf_case("Bear", bear_defaults, info)
    with tab_base:
        _render_reverse_dcf_case("Base", base_defaults, info)
    with tab_bull:
        _render_reverse_dcf_case("Bull", bull_defaults, info)

    st.divider()

    # ----------------------------
    # Why some charts can be empty (quick, factual)
    # ----------------------------
    st.caption(
        "If a chart shows 'No history available', the data provider didn’t return that field for this ticker "
        "(common for some cash flow/EPS fields depending on listing/history)."
    )