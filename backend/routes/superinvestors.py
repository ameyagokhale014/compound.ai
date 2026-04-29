"""
Superinvestors / Smart Money Tracker
────────────────────────────────────
Scrapes Dataroma (public 13F data) for legendary investors' portfolios.

GET  /superinvestors/managers           — full list of tracked managers
GET  /superinvestors/portfolio/{code}   — one manager's holdings
GET  /superinvestors/activity           — recent buys/sells across all managers
GET  /superinvestors/consensus          — aggregated "most bought / most held / most sold"
POST /superinvestors/refresh            — invalidate all cached data
POST /superinvestors/analyze-themes     — Claude AI: themes from consensus data
"""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

import requests
from bs4 import BeautifulSoup
from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from database import get_db
from models import SuperInvestorCache

router = APIRouter(prefix="/superinvestors", tags=["superinvestors"])

DATAROMA   = "https://www.dataroma.com/m"
CACHE_HOURS = 20   # 13F is quarterly; 20 h is plenty
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.dataroma.com/",
    "Connection": "keep-alive",
}

# ── Curated metadata for featured investors (codes from Dataroma) ─────────────
MANAGER_META: dict[str, dict] = {
    "BRK": {
        "display_name": "Warren Buffett",
        "firm": "Berkshire Hathaway",
        "known_for": "Value investing & long-term compounding",
        "style": "Value",
        "emoji": "🦉",
    },
    "psc": {
        "display_name": "Bill Ackman",
        "firm": "Pershing Square Capital",
        "known_for": "Activist investing & concentrated bets",
        "style": "Activist",
        "emoji": "⚡",
    },
    "GLRE": {
        "display_name": "David Einhorn",
        "firm": "Greenlight Capital",
        "known_for": "Value + contrarian short selling",
        "style": "Value / Short",
        "emoji": "🎯",
    },
    "AM": {
        "display_name": "David Tepper",
        "firm": "Appaloosa Management",
        "known_for": "Distressed debt & macro opportunism",
        "style": "Distressed / Macro",
        "emoji": "🔥",
    },
    "SAM": {
        "display_name": "Michael Burry",
        "firm": "Scion Asset Management",
        "known_for": "Deep value & contrarian macro bets",
        "style": "Deep Value",
        "emoji": "🐻",
    },
    "AC": {
        "display_name": "Chuck Akre",
        "firm": "Akre Capital Management",
        "known_for": "High-quality compounders held forever",
        "style": "Quality / Growth",
        "emoji": "🏆",
    },
    "PI": {
        "display_name": "Mohnish Pabrai",
        "firm": "Pabrai Investments",
        "known_for": "Buffett-style cloning & patience",
        "style": "Value",
        "emoji": "🧘",
    },
    "MKL": {
        "display_name": "Tom Gayner",
        "firm": "Markel Group",
        "known_for": "Quality businesses at fair prices",
        "style": "Quality",
        "emoji": "⚖️",
    },
    "DAV": {
        "display_name": "Chris Davis",
        "firm": "Davis Advisors",
        "known_for": "Value in financials & quality franchises",
        "style": "Value",
        "emoji": "💼",
    },
    "oc": {
        "display_name": "Howard Marks",
        "firm": "Oaktree Capital Management",
        "known_for": "Risk management & distressed credit",
        "style": "Distressed / Credit",
        "emoji": "🌳",
    },
    "HC": {
        "display_name": "Li Lu",
        "firm": "Himalaya Capital Management",
        "known_for": "Global value investing, China focus",
        "style": "Global Value",
        "emoji": "🏔️",
    },
    "WP": {
        "display_name": "David Rolfe",
        "firm": "Wedgewood Partners",
        "known_for": "Concentrated quality growth",
        "style": "Quality / GARP",
        "emoji": "💎",
    },
    "BAUPOST": {
        "display_name": "Seth Klarman",
        "firm": "Baupost Group",
        "known_for": "Margin of safety & deep value",
        "style": "Deep Value",
        "emoji": "🏛️",
    },
    "ic": {
        "display_name": "Carl Icahn",
        "firm": "Icahn Capital Management",
        "known_for": "Hostile activism & corporate restructuring",
        "style": "Activist",
        "emoji": "🦅",
    },
    "LMM": {
        "display_name": "Bill Miller",
        "firm": "Miller Value Partners",
        "known_for": "Growth at reasonable price, beaten-down techs",
        "style": "GARP",
        "emoji": "🎲",
    },
    "FS": {
        "display_name": "Terry Smith",
        "firm": "Fundsmith",
        "known_for": "Quality compounders, buy & hold forever",
        "style": "Quality",
        "emoji": "🏰",
    },
    "aq": {
        "display_name": "Guy Spier",
        "firm": "Aquamarine Capital",
        "known_for": "Buffett disciple, concentrated value",
        "style": "Value",
        "emoji": "🌊",
    },
    "TGM": {
        "display_name": "Chase Coleman",
        "firm": "Tiger Global Management",
        "known_for": "Global tech growth investing",
        "style": "Growth",
        "emoji": "🐯",
    },
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _clean_num(text: str) -> Optional[float]:
    if not text:
        return None
    cleaned = re.sub(r"[,$%\s]", "", text.strip())
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return None


def _fetch_html(url: str, timeout: int = 25) -> Optional[BeautifulSoup]:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"[superinvestors] fetch error {url}: {e}")
        return None


def _find_grid(soup: BeautifulSoup) -> Optional[object]:
    """Try common Dataroma table IDs, fall back to largest table."""
    for tid in ("grid", "main_table", "holdings", "managers"):
        t = soup.find("table", {"id": tid})
        if t:
            return t
    tables = soup.find_all("table")
    return max(tables, key=lambda t: len(t.find_all("tr"))) if tables else None


def _parse_activity_type(text: str) -> str:
    t = text.lower()
    if "new" in t:
        return "new"
    if "add" in t:
        return "add"
    if "sold out" in t or "liquidat" in t:
        return "sold_out"
    if "reduce" in t or "sold" in t or "trim" in t:
        return "reduce"
    return "hold"


# ── Scrapers ───────────────────────────────────────────────────────────────────

def _scrape_managers() -> list[dict]:
    soup = _fetch_html(f"{DATAROMA}/managers.php")
    if not soup:
        return []

    table = _find_grid(soup)
    if not table:
        return []

    managers = []
    for row in table.find_all("tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 2:
            continue
        link = cols[0].find("a")
        if not link:
            continue
        href = link.get("href", "")
        m = re.search(r"[?&]m=([^&\s]+)", href)
        if not m:
            continue
        code = m.group(1).strip()

        pv_raw     = cols[1].text.strip() if len(cols) > 1 else ""
        stocks_raw = cols[2].text.strip() if len(cols) > 2 else ""
        turn_raw   = cols[3].text.strip() if len(cols) > 3 else ""
        rep_raw    = cols[4].text.strip() if len(cols) > 4 else ""

        # Portfolio value in millions (Dataroma shows raw dollar or "$X mil")
        pv_m = None
        pv_digits = re.sub(r"[^0-9.]", "", pv_raw)
        if pv_digits:
            try:
                pv_m = float(pv_digits)
            except Exception:
                pass

        num_stocks = None
        try:
            num_stocks = int(re.search(r"\d+", stocks_raw).group())
        except Exception:
            pass

        meta = MANAGER_META.get(code, {})
        managers.append({
            "code":                   code,
            "name":                   link.text.strip(),
            "display_name":           meta.get("display_name", link.text.strip()),
            "firm":                   meta.get("firm", link.text.strip()),
            "known_for":              meta.get("known_for", ""),
            "style":                  meta.get("style", ""),
            "emoji":                  meta.get("emoji", "💰"),
            "portfolio_value_millions": pv_m,
            "num_stocks":             num_stocks,
            "turnover":               turn_raw,
            "reported":               rep_raw,
            "featured":               code in MANAGER_META,
        })

    return managers


def _scrape_holdings(code: str) -> dict:
    soup = _fetch_html(f"{DATAROMA}/holdings.php?m={code}")
    if not soup:
        return {"code": code, "error": "Failed to fetch", "holdings": []}

    table = _find_grid(soup)
    holdings = []

    if table:
        # Detect column positions from header row
        header_row = table.find("tr")
        col_map = {"stock": 1, "pct": 2, "activity": 3, "shares": 4, "price": 5, "value": 6}
        if header_row:
            ths = [th.get_text(separator=" ", strip=True).lower()
                   for th in header_row.find_all(["th", "td"])]
            for i, h in enumerate(ths):
                if "stock" in h or "company" in h:
                    col_map["stock"] = i
                elif "% of" in h or "portfolio" in h:
                    col_map["pct"] = i
                elif "recent" in h or "activity" in h:
                    col_map["activity"] = i
                elif "share" in h:
                    col_map["shares"] = i
                elif "reported" in h and "price" in h:
                    col_map["price"] = i
                elif "value" in h:
                    col_map["value"] = i

        for row in table.find_all("tr")[1:]:
            cols = row.find_all("td")
            if len(cols) < 3:
                continue

            # Stock symbol + name
            sc   = col_map["stock"]
            stock_cell = cols[sc] if sc < len(cols) else cols[1]
            stock_text = stock_cell.get_text(separator=" ").strip()

            symbol, name = "", stock_text
            dash = stock_text.split(" - ", 1)
            if len(dash) == 2 and len(dash[0].strip()) <= 8:
                symbol = dash[0].strip()
                name   = dash[1].strip()
            else:
                lnk = stock_cell.find("a")
                if lnk:
                    sm = re.search(r"symbol=([^&]+)", lnk.get("href", ""))
                    if sm:
                        symbol = sm.group(1).strip()

            if not symbol or len(symbol) > 8:
                continue

            def gcol(key: str) -> str:
                idx = col_map.get(key, 99)
                return cols[idx].text.strip() if idx < len(cols) else ""

            pct    = _clean_num(gcol("pct"))
            shrs   = _clean_num(gcol("shares"))
            price  = _clean_num(gcol("price"))
            val    = _clean_num(gcol("value"))
            act_t  = gcol("activity")

            act_type = _parse_activity_type(act_t)
            pct_chg  = None
            pm = re.search(r"([+-]?\d+\.?\d*)\s*%", act_t)
            if pm:
                pct_chg = float(pm.group(1))

            holdings.append({
                "symbol":          symbol,
                "name":            name,
                "pct_portfolio":   pct,
                "num_shares":      shrs,
                "reported_price":  price,
                "value_millions":  round(val / 1e6, 2) if val and val > 1e5 else val,
                "activity":        act_type,
                "activity_pct":    pct_chg,
                "activity_text":   act_t,
            })

    # Try to extract AUM + as-of date from page text
    aum_str, reported_date = None, None
    try:
        full_text = soup.get_text(" ", strip=True)
        am = re.search(r"\$([\d,]+(?:\.\d+)?)\s*(B|M)illion", full_text, re.I)
        if am:
            aum_str = am.group()
        dm = re.search(r"(Q[1-4]\s+\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{4})", full_text)
        if dm:
            reported_date = dm.group()
    except Exception:
        pass

    meta = MANAGER_META.get(code, {})
    return {
        "code":          code,
        "display_name":  meta.get("display_name", code),
        "firm":          meta.get("firm", code),
        "emoji":         meta.get("emoji", "💰"),
        "known_for":     meta.get("known_for", ""),
        "style":         meta.get("style", ""),
        "holdings":      holdings,
        "aum":           aum_str,
        "reported_date": reported_date,
    }


def _scrape_activity() -> list[dict]:
    soup = _fetch_html(f"{DATAROMA}/activity.php")
    if not soup:
        return []

    table = _find_grid(soup)
    if not table:
        return []

    activities = []
    for row in table.find_all("tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 4:
            continue

        # Typical: Date | Investor | Activity | Stock | % Portfolio | Price
        date_t   = cols[0].text.strip()
        inv_cell = cols[1]
        act_t    = cols[2].text.strip() if len(cols) > 2 else ""
        stk_cell = cols[3] if len(cols) > 3 else None

        # Manager code from link
        inv_link = inv_cell.find("a")
        mcode    = ""
        if inv_link:
            hh = inv_link.get("href", "")
            cm = re.search(r"[?&]m=([^&\s]+)", hh)
            if cm:
                mcode = cm.group(1).strip()

        # Stock symbol + name
        symbol, sname = "", ""
        if stk_cell:
            st = stk_cell.get_text(" ").strip()
            ds = st.split(" - ", 1)
            if len(ds) == 2 and len(ds[0]) <= 8:
                symbol = ds[0].strip()
                sname  = ds[1].strip()
            else:
                symbol = st

        if not symbol and not mcode:
            continue

        act_type = _parse_activity_type(act_t)
        pct_chg  = None
        pm = re.search(r"([+-]?\d+\.?\d*)\s*%", act_t)
        if pm:
            pct_chg = float(pm.group(1))

        meta = MANAGER_META.get(mcode, {})
        activities.append({
            "date":          date_t,
            "manager_code":  mcode,
            "manager_name":  meta.get("display_name", inv_cell.text.strip()),
            "firm":          meta.get("firm", inv_cell.text.strip()),
            "emoji":         meta.get("emoji", "💰"),
            "activity_type": act_type,
            "activity_text": act_t,
            "change_pct":    pct_chg,
            "symbol":        symbol,
            "stock_name":    sname,
            "pct_portfolio": _clean_num(cols[4].text if len(cols) > 4 else ""),
            "price":         _clean_num(cols[5].text if len(cols) > 5 else ""),
        })

    return activities


# ── Consensus aggregation ──────────────────────────────────────────────────────

def _build_consensus(all_portfolios: list[dict]) -> dict:
    stock_data: dict[str, dict] = {}

    for portfolio in all_portfolios:
        code = portfolio.get("code", "")
        meta = MANAGER_META.get(code, {})
        mgr  = {
            "manager_code": code,
            "manager_name": meta.get("display_name", portfolio.get("display_name", code)),
            "firm":         meta.get("firm", portfolio.get("firm", code)),
            "emoji":        meta.get("emoji", portfolio.get("emoji", "💰")),
        }

        for h in portfolio.get("holdings", []):
            sym = h.get("symbol", "").upper()
            if not sym or len(sym) > 8 or sym in ("N/A", "—"):
                continue

            if sym not in stock_data:
                stock_data[sym] = {
                    "symbol":   sym,
                    "name":     h.get("name", sym),
                    "holders":  [],
                    "buyers":   [],
                    "sellers":  [],
                }

            holder = {
                **mgr,
                "pct_portfolio": h.get("pct_portfolio"),
                "activity":      h.get("activity", "hold"),
                "activity_pct":  h.get("activity_pct"),
                "activity_text": h.get("activity_text", ""),
                "num_shares":    h.get("num_shares"),
                "value_millions":h.get("value_millions"),
            }

            stock_data[sym]["holders"].append(holder)
            act = h.get("activity", "hold")
            if act in ("new", "add"):
                stock_data[sym]["buyers"].append(holder)
            elif act in ("reduce", "sold_out"):
                stock_data[sym]["sellers"].append(holder)

    def fmt(s: dict) -> dict:
        pcts = [h["pct_portfolio"] for h in s["holders"] if h["pct_portfolio"] is not None]
        return {
            "symbol":           s["symbol"],
            "name":             s["name"],
            "num_holders":      len(s["holders"]),
            "num_buyers":       len(s["buyers"]),
            "num_sellers":      len(s["sellers"]),
            "avg_pct_portfolio": round(sum(pcts) / len(pcts), 2) if pcts else None,
            "holders":          s["holders"],
            "buyers":           s["buyers"],
            "sellers":          s["sellers"],
        }

    stocks = list(stock_data.values())

    most_held   = sorted([s for s in stocks], key=lambda x: len(x["holders"]),  reverse=True)[:25]
    most_bought = sorted([s for s in stocks if s["buyers"]],  key=lambda x: len(x["buyers"]),  reverse=True)[:20]
    most_sold   = sorted([s for s in stocks if s["sellers"]], key=lambda x: len(x["sellers"]), reverse=True)[:20]

    # Conviction buys: new positions (highest signal)
    conviction = sorted(
        [s for s in stocks if any(h["activity"] == "new" for h in s["buyers"])],
        key=lambda x: sum(1 for h in x["buyers"] if h["activity"] == "new"),
        reverse=True,
    )[:10]

    return {
        "most_held":        [fmt(s) for s in most_held],
        "most_bought":      [fmt(s) for s in most_bought],
        "most_sold":        [fmt(s) for s in most_sold],
        "conviction_buys":  [fmt(s) for s in conviction],
        "total_managers":   len(all_portfolios),
        "total_unique_stocks": len(stock_data),
    }


# ── Cache helpers ──────────────────────────────────────────────────────────────

def _get_cache(key: str, db: Session, ttl_hours: int = CACHE_HOURS) -> Optional[dict | list]:
    row = db.query(SuperInvestorCache).filter(SuperInvestorCache.key == key).first()
    if not row or not row.data or not row.fetched_at:
        return None
    if (datetime.utcnow() - row.fetched_at) > timedelta(hours=ttl_hours):
        return None
    try:
        return json.loads(row.data)
    except Exception:
        return None


def _set_cache(key: str, data, db: Session):
    row = db.query(SuperInvestorCache).filter(SuperInvestorCache.key == key).first()
    if not row:
        row = SuperInvestorCache(key=key)
        db.add(row)
    row.data       = json.dumps(data, default=str)
    row.fetched_at = datetime.utcnow()
    db.commit()


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/managers")
def get_managers(db: Session = Depends(get_db)):
    cached = _get_cache("managers", db)
    if cached:
        return cached

    managers = _scrape_managers()

    # Always include featured managers even if scrape missed them
    scraped_codes = {m["code"] for m in managers}
    for code, meta in MANAGER_META.items():
        if code not in scraped_codes:
            managers.append({
                "code":            code,
                "name":            meta["firm"],
                "display_name":    meta["display_name"],
                "firm":            meta["firm"],
                "known_for":       meta["known_for"],
                "style":           meta["style"],
                "emoji":           meta["emoji"],
                "portfolio_value_millions": None,
                "num_stocks":      None,
                "turnover":        "",
                "reported":        "",
                "featured":        True,
            })

    # Enrich scraped entries with our curated meta
    for m in managers:
        code = m.get("code", "")
        if code in MANAGER_META:
            meta = MANAGER_META[code]
            for k, v in meta.items():
                if not m.get(k):
                    m[k] = v
            m["featured"] = True

    # Sort: featured first, then by AUM desc
    managers.sort(key=lambda m: (
        0 if m.get("featured") else 1,
        -(m.get("portfolio_value_millions") or 0),
    ))

    _set_cache("managers", managers, db)
    return managers


@router.get("/portfolio/{code}")
def get_portfolio(code: str, db: Session = Depends(get_db)):
    code = code.upper()
    cached = _get_cache(f"portfolio_{code}", db)
    if cached:
        return cached

    data = _scrape_holdings(code)
    if data.get("holdings"):
        _set_cache(f"portfolio_{code}", data, db)
    return data


@router.get("/activity")
def get_activity(db: Session = Depends(get_db)):
    cached = _get_cache("activity", db, ttl_hours=12)
    if cached:
        return cached

    activities = _scrape_activity()
    if activities:
        _set_cache("activity", activities, db)
    return activities or []


@router.get("/consensus")
def get_consensus(db: Session = Depends(get_db)):
    cached = _get_cache("consensus", db, ttl_hours=12)
    if cached:
        return cached

    # Gather all cached portfolios (don't trigger fresh fetches here)
    all_portfolios = []
    for code in MANAGER_META.keys():
        p = _get_cache(f"portfolio_{code}", db)
        if p:
            p["code"] = code
            all_portfolios.append(p)

    if not all_portfolios:
        return {
            "most_held": [], "most_bought": [], "most_sold": [],
            "conviction_buys": [], "total_managers": 0, "total_unique_stocks": 0,
            "needs_fetch": True,
        }

    result = _build_consensus(all_portfolios)
    _set_cache("consensus", result, db)
    return result


@router.post("/fetch-all")
def fetch_all_featured(db: Session = Depends(get_db)):
    """Pre-fetch all featured manager portfolios (call once to warm the cache)."""
    fetched = 0
    for code in MANAGER_META.keys():
        data = _scrape_holdings(code)
        if data.get("holdings"):
            _set_cache(f"portfolio_{code}", data, db)
            fetched += 1

    # Rebuild consensus
    all_portfolios = []
    for code in MANAGER_META.keys():
        p = _get_cache(f"portfolio_{code}", db)
        if p:
            p["code"] = code
            all_portfolios.append(p)

    if all_portfolios:
        consensus = _build_consensus(all_portfolios)
        _set_cache("consensus", consensus, db)

    # Also refresh managers list
    managers = _scrape_managers()
    if managers:
        _set_cache("managers", managers, db)

    return {"ok": True, "fetched": fetched, "total": len(MANAGER_META)}


@router.post("/refresh")
def invalidate_cache(db: Session = Depends(get_db)):
    """Invalidate all cached superinvestor data."""
    rows = db.query(SuperInvestorCache).all()
    for row in rows:
        row.fetched_at = None
    db.commit()
    return {"ok": True, "invalidated": len(rows)}


class ThemesBody:
    pass


@router.post("/analyze-themes")
def analyze_themes(
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    """Use Claude to extract investment themes from current consensus holdings."""
    import anthropic

    api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"error": "No Anthropic API key — add it in Profile Settings."}

    # Check cache (themes valid for 48 h)
    cached = _get_cache("themes", db, ttl_hours=48)
    if cached:
        return cached

    consensus = _get_cache("consensus", db)
    if not consensus or not consensus.get("most_held"):
        return {"error": "No consensus data available. Fetch portfolios first."}

    # Build a compact summary for Claude
    most_bought = consensus.get("most_bought", [])[:12]
    most_sold   = consensus.get("most_sold",   [])[:8]
    most_held   = consensus.get("most_held",   [])[:15]
    conviction  = consensus.get("conviction_buys", [])[:8]

    def stock_line(s: dict) -> str:
        buyers = ", ".join(
            f"{h['emoji']} {h['manager_name']}" for h in s.get("buyers", [])[:3]
        )
        sellers = ", ".join(
            f"{h['emoji']} {h['manager_name']}" for h in s.get("sellers", [])[:3]
        )
        holders = ", ".join(
            f"{h['emoji']} {h['manager_name']}" for h in s.get("holders", [])[:3]
        )
        pct = s.get("avg_pct_portfolio")
        pct_str = f" (avg {pct:.1f}% of portfolio)" if pct else ""
        if buyers:
            return f"  {s['symbol']} ({s['name']}) — {s['num_buyers']} buying: {buyers}{pct_str}"
        if holders:
            return f"  {s['symbol']} ({s['name']}) — {s['num_holders']} holding: {holders}{pct_str}"
        return f"  {s['symbol']} ({s['name']})"

    bought_block   = "\n".join(stock_line(s) for s in most_bought)
    sold_block     = "\n".join(stock_line(s) for s in most_sold)
    held_block     = "\n".join(stock_line(s) for s in most_held)
    conviction_blk = "\n".join(stock_line(s) for s in conviction)
    n_mgr = consensus.get("total_managers", 0)

    prompt = f"""You are a top-tier buy-side analyst studying the latest 13F filings of {n_mgr} legendary investors.

STOCKS BEING ACTIVELY BOUGHT THIS QUARTER:
{bought_block}

NEW CONVICTION POSITIONS (fresh buys, highest signal):
{conviction_blk}

STOCKS BEING SOLD / REDUCED:
{sold_block}

MOST WIDELY HELD POSITIONS:
{held_block}

Analyse this data and identify:
1. The 4-6 dominant investment THEMES these legends are positioning for (e.g. "AI Infrastructure", "Energy Transition", "Consumer Resilience", "Financial Sector Re-rating")
2. For each theme: which stocks exemplify it, which investors are playing it, and what the macro thesis is
3. What the SMART MONEY is collectively rotating OUT of and why
4. 3 high-conviction actionable ideas for a retail investor to consider

Return ONLY valid JSON (no markdown, no text outside the JSON):
{{
  "themes": [
    {{
      "name": "<Theme name, 2-4 words>",
      "emoji": "<1 emoji>",
      "headline": "<One sentence investment thesis>",
      "stocks": ["TICK1", "TICK2", "TICK3"],
      "investors": ["<Investor name>", "..."],
      "macro_driver": "<1-2 sentences on the macro catalyst>",
      "conviction": "high" | "medium" | "low"
    }}
  ],
  "rotating_out_of": {{
    "sectors": ["<sector 1>", "<sector 2>"],
    "reasoning": "<2-3 sentences on what smart money is exiting and why>"
  }},
  "retail_ideas": [
    {{
      "symbol": "TICK",
      "name": "<Company name>",
      "thesis": "<2 sentences why this is worth considering>",
      "backed_by": ["<Investor 1>", "<Investor 2>"]
    }}
  ],
  "overall_sentiment": "bullish" | "cautious" | "defensive" | "opportunistic",
  "sentiment_reasoning": "<1-2 sentences summarising the overall portfolio positioning signal>"
}}"""

    try:
        client  = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1800,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            parts = raw.split("```")
            for part in parts[1:]:
                raw = part.lstrip("json").strip()
                if raw:
                    break

        # Balanced-brace extract
        start = raw.find("{")
        if start == -1:
            return {"error": "Claude returned no JSON"}
        depth = 0; in_str = False; esc = False; result = None
        for i, ch in enumerate(raw[start:], start):
            if esc: esc = False; continue
            if ch == "\\" and in_str: esc = True; continue
            if ch == '"': in_str = not in_str; continue
            if in_str: continue
            if ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    result = json.loads(raw[start: i + 1])
                    break
        if result is None:
            return {"error": "Incomplete JSON"}

        _set_cache("themes", result, db)
        return result

    except Exception as e:
        return {"error": str(e)[:200]}
