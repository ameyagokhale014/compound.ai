# app.py
from __future__ import annotations

import streamlit as st

from src.ui_portfolio import render_portfolio_tab
from src.ui_stock import render_stock_page
from src.ui_news import render_news_tab  # ✅ ADDED: portfolio news renderer
from src.symbols import load_symbols_csv


# ------------------------------------------------------------
# Page config
# ------------------------------------------------------------
st.set_page_config(page_title="COMPOUND.AI", layout="wide")


# ------------------------------------------------------------
# Load symbols once
# ------------------------------------------------------------
labels, label_to_symbol, symbol_to_name = load_symbols_csv()


# ------------------------------------------------------------
# Navigation helper
# ------------------------------------------------------------
def _nav_to(page: str, ticker: str | None = None):
    st.query_params["page"] = page
    if ticker:
        st.query_params["ticker"] = ticker
    else:
        st.query_params.pop("ticker", None)
    st.rerun()


# ------------------------------------------------------------
# Read route FIRST
# ------------------------------------------------------------
page = st.query_params.get("page", "portfolio")
ticker = st.query_params.get("ticker", None)

# ✅ ADDED: allow "news" route
if page not in {"portfolio", "stock", "news"}:
    page = "portfolio"


# ------------------------------------------------------------
# Header Styling
# ------------------------------------------------------------
st.markdown(
    """
    <style>
        .brand-container {
            display: flex;
            flex-direction: column;
            cursor: pointer;
        }

        .brand-title {
            font-size: 48px;
            font-weight: 900;
            letter-spacing: 1px;
            color: #1f4ed8;
            line-height: 1.0;
        }

        .brand-title:hover {
            color: #1d3fc4;
        }

        .brand-subtitle {
            font-size: 14px;
            color: #6b7280;
            margin-top: 6px;
        }

        .brand-link {
            text-decoration: none !important;
            color: inherit !important;
        }
    </style>
    """,
    unsafe_allow_html=True,
)


# ------------------------------------------------------------
# Header Layout
# ------------------------------------------------------------
left, right = st.columns([2, 5], vertical_alignment="center")

with left:
    st.markdown(
        """
    <style>
      .compound-home-link,
      .compound-home-link:visited,
      .compound-home-link:hover,
      .compound-home-link:active {
        text-decoration: none !important;
        color: inherit !important;
        display: inline-block;
      }
    </style>

    <a class="compound-home-link" href="/?page=portfolio" target="_top">
        <div style="display:flex; flex-direction:column; cursor:pointer; user-select:none;">
            <div style="
                font-size:48px;
                font-weight:900;
                letter-spacing:1px;
                color:#1f4ed8;
                line-height:1.0;">
                COMPOUND.AI
            </div>
            <div style="
                font-size:14px;
                color:#6b7280;
                margin-top:6px;">
                a wealth management agent
            </div>
        </div>
    </a>
    """,
        unsafe_allow_html=True,
    )

with right:
    picked = st.selectbox(
        "",
        options=labels,
        index=None,
        placeholder="Search a stock: aapl, google, nvda…",
        key="global_stock_search",
        label_visibility="collapsed",
    )

    if picked:
        selected_symbol = label_to_symbol.get(picked)
        current_ticker = st.query_params.get("ticker")

        if selected_symbol and current_ticker != selected_symbol:
            _nav_to("stock", selected_symbol)

st.divider()


# ------------------------------------------------------------
# ✅ Tabs: US Stocks + Portfolio News
#    - Only show tabs on non-stock pages
# ------------------------------------------------------------
if page != "stock":
    tab_us, tab_news = st.tabs(["US Stocks", "Portfolio News"])

    with tab_us:
        # If user routed to news via query params, still show US Stocks tab content here
        if page != "news":
            render_portfolio_tab()

    with tab_news:
        # ✅ Always load when tab is opened
        render_news_tab()

    # If routed directly to news, render it as well (ensures deep-link works)
    if page == "news":
        # already rendered inside tab_news, so nothing extra needed
        pass

else:
    # ------------------------------------------------------------
    # Router (Stock page)
    # ------------------------------------------------------------
    if not ticker:
        _nav_to("portfolio")
    else:
        render_stock_page(str(ticker).upper().strip())