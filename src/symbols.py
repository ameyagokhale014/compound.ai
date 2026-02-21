from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, List, Tuple

import streamlit as st


# Canonical location: <repo_root>/data/symbols.csv
# src/symbols.py -> src/ -> repo root -> data/symbols.csv
SYMBOLS_CSV = Path(__file__).resolve().parent.parent / "data" / "symbols.csv"


def _normalize(s: str) -> str:
    return (s or "").strip().lower()


def _normalize_symbol(s: str) -> str:
    return (s or "").strip().upper()


@st.cache_data(show_spinner=False)
def load_all_symbols() -> List[Dict[str, str]]:
    """
    Loads local ticker/company dataset from data/symbols.csv.

    Expected columns (flexible):
      - symbol OR ticker
      - name OR company
      - exchange (optional) OR mic OR market

    Returns list of dicts with keys: symbol, name, exchange
    """
    if not SYMBOLS_CSV.exists():
        raise FileNotFoundError(
            f"Ticker file not found at: {SYMBOLS_CSV}\n"
            f"Create it at data/symbols.csv or update SYMBOLS_CSV in src/symbols.py"
        )

    rows: List[Dict[str, str]] = []
    with SYMBOLS_CSV.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            symbol = _normalize_symbol(r.get("symbol") or r.get("ticker") or "")
            name = (r.get("name") or r.get("company") or "").strip()
            exchange = (r.get("exchange") or r.get("mic") or r.get("market") or "").strip()

            if not symbol:
                continue

            rows.append({"symbol": symbol, "name": name, "exchange": exchange})

    # de-dup by symbol (keep first)
    seen = set()
    deduped: List[Dict[str, str]] = []
    for r in rows:
        sym = r["symbol"]
        if sym in seen:
            continue
        seen.add(sym)
        deduped.append(r)

    return deduped


@st.cache_data(show_spinner=False)
def load_symbols_csv() -> Tuple[List[str], Dict[str, str], Dict[str, str]]:
    """
    Unified UI loader used across the app.

    Returns:
      - labels: list[str] (for Streamlit selectbox)
      - label_to_symbol: dict[label -> symbol]
      - symbol_to_name: dict[symbol -> name]

    IMPORTANT: Uses the same canonical dataset as load_all_symbols()
    (data/symbols.csv) so you don't get mismatched sources.
    """
    rows = load_all_symbols()

    labels: List[str] = []
    label_to_symbol: Dict[str, str] = {}
    symbol_to_name: Dict[str, str] = {}

    for r in rows:
        sym = r["symbol"]
        nm = (r.get("name") or "").strip()
        ex = (r.get("exchange") or "").strip()

        # match your UI label style
        if nm and ex:
            label = f"{sym} — {nm} ({ex})"
        elif nm:
            label = f"{sym} — {nm}"
        elif ex:
            label = f"{sym} ({ex})"
        else:
            label = sym

        labels.append(label)
        label_to_symbol[label] = sym
        symbol_to_name[sym] = nm

    labels = sorted(labels)
    return labels, label_to_symbol, symbol_to_name


@st.cache_data(show_spinner=False)
def build_symbol_options() -> Dict[str, str]:
    """
    Builds label->symbol mapping for UI dropdowns.
    Kept for backward compatibility.
    """
    labels, label_to_symbol, _ = load_symbols_csv()
    # return dict[label->symbol]
    return {label: label_to_symbol[label] for label in labels}


def search_local_symbols(term: str, limit: int = 12) -> List[Dict[str, str]]:
    """
    Fast local search over loaded symbols dataset.
    Returns list of dicts with symbol/name/exchange.
    """
    t = _normalize(term)
    if not t:
        return []

    rows = load_all_symbols()

    scored = []
    for r in rows:
        sym_l = r["symbol"].lower()
        name_l = _normalize(r.get("name", ""))

        score = None
        if sym_l.startswith(t):
            score = 0
        elif t in sym_l:
            score = 1
        elif t in name_l:
            score = 2

        if score is not None:
            scored.append((score, r))

    scored.sort(key=lambda x: (x[0], x[1]["symbol"]))
    return [r for _, r in scored[:limit]]
