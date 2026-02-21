import time
import requests
import streamlit as st

YF_SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search"

# simple in-memory cooldown across reruns
if "yf_last_call_ts" not in st.session_state:
    st.session_state.yf_last_call_ts = 0.0


@st.cache_data(ttl=60)  # cache each query result for 60 seconds
def _yf_search_cached(query: str, limit: int):
    params = {
        "q": query,
        "quotesCount": limit,
        "newsCount": 0,
        "enableFuzzyQuery": "true",
    }
    r = requests.get(YF_SEARCH_URL, params=params, timeout=6)
    r.raise_for_status()
    return r.json()


def search_symbols(query: str, limit: int = 12):
    """
    Robust search with:
      - min chars
      - caching (ttl=60s)
      - cooldown (avoid calling too frequently)
      - graceful handling of HTTP 429
    """
    q = (query or "").strip()
    if len(q) < 2:
        return []

    # cooldown: don't call more than once every 0.8s
    now = time.time()
    if now - st.session_state.yf_last_call_ts < 0.8:
        # return cached result if available (same query) otherwise empty
        try:
            data = _yf_search_cached(q, limit)
        except Exception:
            return []
    else:
        try:
            data = _yf_search_cached(q, limit)
            st.session_state.yf_last_call_ts = now
        except requests.exceptions.HTTPError as e:
            # If rate-limited, do NOT crash the app
            if getattr(e.response, "status_code", None) == 429:
                return []
            return []
        except Exception:
            return []

    out = []
    for item in data.get("quotes", []):
        sym = item.get("symbol")
        if not sym:
            continue

        qtype = (item.get("quoteType") or "").upper()
        if qtype not in ("EQUITY", "ETF"):
            continue

        name = item.get("longname") or item.get("shortname") or ""
        exch = item.get("exchDisp") or item.get("exchange") or ""
        out.append(
            {"symbol": sym.upper(), "name": name, "exchange": exch, "type": qtype}
        )

    return out
