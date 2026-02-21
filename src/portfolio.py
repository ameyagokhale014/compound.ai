# src/portfolio.py
from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import List, Tuple, Optional


# =========================================================
# DB LOCATION
# =========================================================
# IMPORTANT: make this match your existing DB file.
# If you're already using a different path elsewhere, set this to that exact path.
DB_PATH = os.getenv("PORTFOLIO_DB_PATH", "data/portfolio.db")


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def _init_db() -> None:
    """
    Creates the new schema (lots + aggregated positions) if not present.
    Safe to call on every run.
    """
    with _conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS position_lots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                quantity REAL NOT NULL,
                price REAL NOT NULL,
                bought_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS positions (
                ticker TEXT PRIMARY KEY,
                quantity REAL NOT NULL,
                avg_price REAL NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


# =========================================================
# CORE LOGIC
# =========================================================
def _normalize_ticker(t: str) -> str:
    return (t or "").strip().upper()


def _recompute_position(conn: sqlite3.Connection, ticker: str) -> None:
    """
    Recompute the aggregated position row from lots using weighted average cost.
    """
    t = _normalize_ticker(ticker)
    lots = conn.execute(
        """
        SELECT quantity, price
        FROM position_lots
        WHERE ticker = ?
        """,
        (t,),
    ).fetchall()

    if not lots:
        conn.execute("DELETE FROM positions WHERE ticker = ?", (t,))
        return

    total_qty = sum(float(r["quantity"]) for r in lots)
    total_cost = sum(float(r["quantity"]) * float(r["price"]) for r in lots)

    # Guard
    if total_qty <= 0:
        conn.execute("DELETE FROM positions WHERE ticker = ?", (t,))
        return

    avg_price = total_cost / total_qty
    now = datetime.utcnow().isoformat()

    conn.execute(
        """
        INSERT INTO positions (ticker, quantity, avg_price, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(ticker) DO UPDATE SET
            quantity = excluded.quantity,
            avg_price = excluded.avg_price,
            updated_at = excluded.updated_at
        """,
        (t, float(total_qty), float(avg_price), now),
    )


# =========================================================
# PUBLIC API (keeps your current function names)
# =========================================================
def upsert_position(ticker: str, quantity: float, avg_price: float) -> None:
    """
    CHANGED BEHAVIOR:
    - This no longer overwrites a single row.
    - It inserts a NEW LOT (buy) each time you press Save
    - Then recomputes the aggregated position (one row per ticker).
    """
    _init_db()
    t = _normalize_ticker(ticker)
    q = float(quantity)
    p = float(avg_price)

    if not t:
        raise ValueError("Ticker is required.")
    if q <= 0:
        raise ValueError("Quantity must be > 0.")
    if p < 0:
        raise ValueError("Avg price must be >= 0.")

    with _conn() as conn:
        conn.execute(
            """
            INSERT INTO position_lots (ticker, quantity, price, bought_at)
            VALUES (?, ?, ?, ?)
            """,
            (t, q, p, datetime.utcnow().isoformat()),
        )
        _recompute_position(conn, t)
        conn.commit()


def get_positions() -> List[Tuple[str, float, float]]:
    """
    Returns aggregated positions:
    [(Ticker, Quantity, Avg Price), ...]
    """
    _init_db()
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT ticker, quantity, avg_price
            FROM positions
            ORDER BY ticker ASC
            """
        ).fetchall()
        return [(r["ticker"], float(r["quantity"]), float(r["avg_price"])) for r in rows]


def delete_position(ticker: str) -> None:
    """
    Deletes the entire position: all lots + aggregated row.
    """
    _init_db()
    t = _normalize_ticker(ticker)
    with _conn() as conn:
        conn.execute("DELETE FROM position_lots WHERE ticker = ?", (t,))
        conn.execute("DELETE FROM positions WHERE ticker = ?", (t,))
        conn.commit()


def get_lots(ticker: str) -> List[Tuple[int, str, float, float, str]]:
    """
    Returns lots for a ticker:
    [(id, ticker, quantity, price, bought_at), ...]
    """
    _init_db()
    t = _normalize_ticker(ticker)
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT id, ticker, quantity, price, bought_at
            FROM position_lots
            WHERE ticker = ?
            ORDER BY id DESC
            """,
            (t,),
        ).fetchall()
        return [
            (int(r["id"]), r["ticker"], float(r["quantity"]), float(r["price"]), r["bought_at"])
            for r in rows
        ]


def delete_lot(lot_id: int) -> None:
    """
    Delete a single lot and recompute the aggregated position for that ticker.
    """
    _init_db()
    with _conn() as conn:
        row = conn.execute(
            "SELECT ticker FROM position_lots WHERE id = ?",
            (int(lot_id),),
        ).fetchone()

        if not row:
            return

        ticker = row["ticker"]
        conn.execute("DELETE FROM position_lots WHERE id = ?", (int(lot_id),))
        _recompute_position(conn, ticker)
        conn.commit()

def get_portfolio_tickers() -> list[str]:
    """
    Returns distinct tickers currently in the portfolio.
    Used by news ingestion.
    """
    rows = get_positions()  # expected shape: [(ticker, qty, avg), ...]
    tickers = []
    for r in rows:
        if not r:
            continue
        t = str(r[0]).upper().strip()
        if t and t not in tickers:
            tickers.append(t)
    return tickers

def add_cash(amount: float):
    # simple example storing as special ticker "CASH"
    upsert_position("CASH", amount, 1.0)


