"""
News route — serves cached news for portfolio + watchlist symbols.

News is scraped via yfinance (Yahoo Finance aggregator: Reuters, AP, Bloomberg, Barron's…)
every 5 minutes by the background poller in main.py.

Scoring uses a keyword-based impact model (-10 to +10) that recognises:
  • Earnings beats / misses           • Regulatory / legal events
  • Analyst upgrades / downgrades     • M&A and partnerships
  • Guidance changes                  • Macro events (rates, recession…)
  • CEO / leadership changes          • Buybacks / dividends
  • Real-estate specific signals      • Sector-specific multipliers
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import List, Optional

import yfinance as yf
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from models import NewsItem, Portfolio, WatchlistItem, RealEstate

router = APIRouter(prefix="/news", tags=["news"])

# ── Symbols used to proxy real-estate market news ──────────────────────────
RE_PROXY_SYMBOLS = ["RDFN", "Z", "VNQ", "IYR", "REXR"]
RE_PROXY_LABEL = "RE_MARKET"

# ── Impact scoring keyword tables ────────────────────────────────────────────

# (pattern, score, human-readable reason)
STOCK_SIGNALS: list[tuple[str, float, str]] = [
    # Strong positive
    (r"\bearnings beat\b|\bbeats estimate|\bbeats expectation|\bsurpasses estimate", 5.0, "earnings beat"),
    (r"\brecord revenue\b|\brecord earnings\b|\ball.time high\b", 4.5, "record results"),
    (r"\bfda approv|\bregulatory approv|\bapproval grant", 5.5, "regulatory approval"),
    (r"\bguidance raised\b|\braised guidance\b|\braise(?:s|d)? outlook\b", 4.0, "guidance raised"),
    (r"\bupgrade[sd]?\b.{0,30}\b(buy|outperform|strong buy)\b", 3.5, "analyst upgrade"),
    (r"\bbuyback\b|\bshare repurchase\b|\brepurchas", 2.5, "share buyback"),
    (r"\bdividend increase\b|\braised? dividend\b|\bspecial dividend\b", 2.5, "dividend increase"),
    (r"\bpartnership\b|\bcollaboration\b|\bstrategic alliance\b", 2.0, "partnership announced"),
    (r"\bacquisition\b|\bmerger\b|\bbuy(?:s|ing)? .{1,30}for \$", 2.0, "M&A activity"),
    (r"\bmarket share gain\b|\bgain(?:ing|s)? market share\b", 2.0, "market share growth"),
    (r"\bai partnership\b|\bai deal\b|\bai collaboration\b", 3.0, "AI deal"),
    (r"\binterest rate cut\b|\brate cut\b|\bfed cut\b|\bdovish\b", 2.0, "rate cuts (bullish equities)"),
    (r"\bstrong revenue\b|\brevenue growth\b|\brevenue surges?\b", 3.0, "revenue growth"),
    (r"\bprofit rises?\b|\bprofit surges?\b|\bnet income rises?\b", 3.0, "profit growth"),
    (r"\bcontract win\b|\bwins? contract\b|\bawarded contract\b", 2.5, "contract win"),

    # Moderate positive
    (r"\bexceeds?\b.{0,20}\bexpectat|\btopped? estimate\b", 2.5, "beat estimates"),
    (r"\bpositive outlook\b|\boptimistic\b|\bconfident\b", 1.0, "positive outlook"),
    (r"\bexpansion\b|\blaunch(?:es|ing)?\b", 1.0, "business expansion"),

    # Moderate negative
    (r"\bearnings miss\b|\bmisses? estimate|\bdisappoint|\bbelow expectation", -5.0, "earnings miss"),
    (r"\bguidance lower|\blower(?:ed|s)? guidance\b|\bcut(?:s|ting)? outlook\b|\bprofit warning\b", -4.5, "guidance cut"),
    (r"\bdowngrade[sd]?\b.{0,30}\b(sell|underperform|neutral)\b", -3.5, "analyst downgrade"),
    (r"\blayoff|\bjob cut|\bredundanc|\bworkforce reduction\b", -2.5, "layoffs"),
    (r"\bceo resign|\bceo step|\bceo exit|\bchief executive.{0,20}resign|\bleadership vacuum\b", -3.0, "CEO departure"),
    (r"\binterest rate hike\b|\brate hike\b|\bfed hike\b|\bhawkish\b|\brate rise\b", -2.0, "rate hike (bearish equities)"),
    (r"\brecession\b|\beconomic slowdown\b|\bgdp contracts?\b", -3.0, "recession risk"),
    (r"\bdebt downgrade\b|\bcredit rating cut\b", -2.5, "credit downgrade"),
    (r"\bmarket share loss\b|\blos(?:ing|es) market share\b", -2.0, "market share loss"),
    (r"\brevenue declin|\brevenue fall|\brevenue drop", -3.0, "revenue decline"),

    # Strong negative
    (r"\blawsuit\b|\bsued\b|\bclass action\b|\blitigation\b", -4.0, "legal action"),
    (r"\bantitrust\b|\bmonopoly investigat|\bdoj investig|\bftc investig", -5.0, "antitrust/regulatory scrutiny"),
    (r"\bsec investig|\bsec charged?\b|\baccounting fraud\b|\bfinancial fraud\b", -6.5, "SEC investigation"),
    (r"\bdata breach\b|\bcyberattack\b|\bransom(?:ware)?\b|\bhack(?:ed|ing)?\b", -4.5, "cybersecurity incident"),
    (r"\bfda reject|\bfda denied\b|\bclinical trial fail\b", -5.5, "regulatory rejection"),
    (r"\bbankruptcy\b|\bchapter 11\b|\binsolvenc\b|\bdefault\b", -8.0, "bankruptcy risk"),
    (r"\bshort seller\b|\bshort report\b|\bfraud allegat\b", -4.0, "short seller attack"),
    (r"\bproduct recall\b|\bsafety recall\b|\bvoluntary recall\b", -3.5, "product recall"),
    (r"\bfine\b|\bpenalt|\bsanction\b|\bregulatory action\b", -3.0, "regulatory penalty"),
    (r"\bsupply chain\b.{0,20}\bdisrupt\b|\bshortage\b", -2.0, "supply chain issues"),
]

RE_SIGNALS: list[tuple[str, float, str]] = [
    (r"\binterest rate cut\b|\brate cut\b|\bfed cut\b|\bdovish\b|\bmortgage rate.{0,20}fall\b", 4.5, "lower rates boost housing"),
    (r"\binterest rate hike\b|\brate hike\b|\bmortgage rate.{0,20}rise\b|\bhawkish\b", -4.0, "higher rates pressure housing"),
    (r"\bhousing price.{0,20}ris|\bhome price.{0,20}ris|\bproperty value.{0,20}ris", 3.0, "home prices rising"),
    (r"\bhousing price.{0,20}fall|\bhome price.{0,20}fall|\bproperty value.{0,20}fall", -3.0, "home prices falling"),
    (r"\blow(?:er)? inventor|\bhousing shortage\b|\bhousing supply\b.{0,10}\bfall\b", 2.5, "low inventory (bullish RE)"),
    (r"\bhousing bubble\b|\bovervalu|\bhousing crash\b", -4.0, "housing bubble concerns"),
    (r"\bforeclosur|\bmortgage default\b|\bdelinquenc", -3.5, "foreclosure risk"),
    (r"\bhome sale.{0,10}\brise|\bexisting home sales.{0,10}\bup\b|\bnew home sales.{0,10}\brise", 2.5, "home sales rising"),
    (r"\bhome sale.{0,10}\bfall|\bexisting home sales.{0,10}\bdown\b|\bnew home sales.{0,10}\bfall", -2.0, "home sales falling"),
    (r"\brent.{0,20}\brise\b|\brental income.{0,20}\bup\b|\brent.{0,15}\bincrease\b", 2.0, "rents rising (RE income)"),
    (r"\binflation.{0,20}\bhigh|\binflation.{0,10}\bpersist", 1.5, "inflation supports RE values"),
    (r"\breal estate crash\b|\bproperty bubble\b|\bhousing market crash\b", -5.0, "RE crash risk"),
    (r"\bcommercial real estate\b.{0,30}\bcrisis\b|\boffice.{0,20}\bvacancy\b.{0,20}\brise\b", -2.5, "commercial RE weakness"),
]


def _score(title: str, signals: list[tuple[str, float, str]]) -> tuple[float, list[str]]:
    """Return (raw_score, list_of_matched_reasons)."""
    score = 0.0
    reasons: list[str] = []
    t = title.lower()
    for pattern, pts, reason in signals:
        if re.search(pattern, t):
            score += pts
            reasons.append(reason)
    return score, reasons


def _label(score: float) -> str:
    if   score >= 4:  return "Very Bullish"
    elif score >= 1.5: return "Bullish"
    elif score > -1.5: return "Neutral"
    elif score > -4:  return "Bearish"
    else:              return "Very Bearish"


def _action(score: float, label: str) -> Optional[str]:
    if   score >= 5:  return "consider_buying"
    elif score >= 2:  return "monitor"
    elif score <= -5: return "consider_selling"
    elif score <= -2: return "monitor"
    return None


def _summary(title: str, reasons: list[str], symbol: str, asset_type: str) -> str:
    """Generate a one-sentence human-readable impact summary."""
    if not reasons:
        return f"General news about {symbol}. Monitor for any portfolio impact."

    joined = " and ".join(reasons[:2])
    if asset_type == "real_estate":
        return f"This {joined} signal may affect your real estate portfolio — {title[:80]}…"
    else:
        return f"{joined.capitalize()} detected for {symbol}. This could impact the stock price in the short term."


def score_news_item(title: str, symbol: str, asset_type: str = "stock") -> dict:
    signals = RE_SIGNALS if asset_type == "real_estate" else STOCK_SIGNALS
    raw, reasons = _score(title, signals)
    clamped = max(-10.0, min(10.0, raw))
    label = _label(clamped)
    return {
        "impact_score":   round(clamped, 1),
        "impact_label":   label,
        "impact_summary": _summary(title, reasons, symbol, asset_type),
        "action_required": _action(clamped, label),
    }


# ── DB helpers ────────────────────────────────────────────────────────────────

def upsert_news(items: list[dict], db: Session):
    """Insert news rows that don't already exist (dedup on symbol+url)."""
    count = 0
    for item in items:
        existing = db.query(NewsItem).filter(
            NewsItem.symbol == item["symbol"],
            NewsItem.url == item["url"],
        ).first()
        if existing:
            continue
        db.add(NewsItem(**item))
        count += 1
    db.commit()
    return count


def prune_old_news(db: Session, days: int = 7):
    cutoff = datetime.utcnow() - timedelta(days=days)
    db.query(NewsItem).filter(NewsItem.published_at < cutoff).delete()
    db.commit()


def _parse_news_item(n: dict) -> dict | None:
    """
    Parse a yfinance news item. Handles both:
      - Old flat format: {title, link, publisher, providerPublishTime}
      - New nested format: {id, content: {title, pubDate, canonicalUrl, provider}}
    Returns a normalized dict or None if essential fields are missing.
    """
    # ── New nested format (yfinance ≥ 0.2.48) ─────────────────────────────
    if "content" in n and isinstance(n["content"], dict):
        c = n["content"]
        title = c.get("title", "")
        url   = (c.get("canonicalUrl") or {}).get("url", "") or \
                (c.get("clickThroughUrl") or {}).get("url", "")
        publisher = (c.get("provider") or {}).get("displayName", "Yahoo Finance")
        pub_str   = c.get("pubDate") or c.get("displayTime")
        try:
            pub_dt = datetime.strptime(pub_str, "%Y-%m-%dT%H:%M:%SZ") if pub_str else datetime.utcnow()
        except Exception:
            pub_dt = datetime.utcnow()
    # ── Old flat format ────────────────────────────────────────────────────
    else:
        title     = n.get("title", "")
        url       = n.get("link", "") or n.get("url", "")
        publisher = n.get("publisher", "Yahoo Finance")
        pub_ts    = n.get("providerPublishTime")
        pub_dt    = datetime.utcfromtimestamp(pub_ts) if pub_ts else datetime.utcnow()

    if not title or not url:
        return None
    return {"title": title, "url": url, "publisher": publisher, "published_at": pub_dt}


def fetch_and_store_news(symbols: list[str], db: Session,
                         asset_type: str = "stock") -> int:
    """Fetch yfinance news for each symbol, score it, and upsert into DB."""
    total = 0
    for sym in symbols:
        try:
            ticker = yf.Ticker(sym)
            news_list = ticker.news or []
            rows = []
            for n in news_list:
                parsed = _parse_news_item(n)
                if not parsed:
                    continue
                scored = score_news_item(parsed["title"], sym, asset_type)
                rows.append({
                    "symbol":       sym,
                    "asset_type":   asset_type,
                    "fetched_at":   datetime.utcnow(),
                    **parsed,
                    **scored,
                })
            total += upsert_news(rows, db)
        except Exception as e:
            print(f"[news] {sym}: {e}")
    return total


def get_all_tracked_symbols(db: Session) -> tuple[list[str], bool]:
    """Return (stock_symbols, has_real_estate)."""
    sym_set: set[str] = set()
    for p in db.query(Portfolio).all():
        for h in p.holdings:
            if h.asset_type != "cash":
                sym_set.add(h.symbol)
    for w in db.query(WatchlistItem).all():
        sym_set.add(w.symbol)
    has_re = db.query(RealEstate).count() > 0
    return list(sym_set), has_re


def refresh_all_news(db: Session) -> int:
    """Called by the background poller every 5 minutes."""
    symbols, has_re = get_all_tracked_symbols(db)
    total = 0
    if symbols:
        total += fetch_and_store_news(symbols, db, "stock")
    if has_re:
        total += fetch_and_store_news(RE_PROXY_SYMBOLS, db, "real_estate")
    prune_old_news(db)
    return total


# ── API endpoints ─────────────────────────────────────────────────────────────

@router.get("/")
def get_news(
    symbols: str = "",
    include_re: bool = False,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """Return cached news for given comma-separated stock symbols plus optionally RE news."""
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    q = db.query(NewsItem)

    filters = []
    if sym_list:
        filters.append(NewsItem.symbol.in_(sym_list))
    if include_re:
        filters.append(NewsItem.asset_type == "real_estate")

    if filters:
        from sqlalchemy import or_
        q = q.filter(or_(*filters))

    rows = (
        q.order_by(NewsItem.published_at.desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "id":             r.id,
            "symbol":         r.symbol,
            "asset_type":     r.asset_type,
            "title":          r.title,
            "publisher":      r.publisher,
            "url":            r.url,
            "published_at":   r.published_at.isoformat() if r.published_at else None,
            "impact_score":   r.impact_score,
            "impact_label":   r.impact_label,
            "impact_summary": r.impact_summary,
            "action_required": r.action_required,
            "fetched_at":     r.fetched_at.isoformat() if r.fetched_at else None,
        }
        for r in rows
    ]


@router.post("/refresh")
def trigger_refresh(db: Session = Depends(get_db)):
    """Manually trigger a news refresh (also used by the 5-min background task)."""
    count = refresh_all_news(db)
    return {"ok": True, "new_articles": count}


@router.get("/last-refresh")
def last_refresh(db: Session = Depends(get_db)):
    latest = db.query(NewsItem.fetched_at).order_by(NewsItem.fetched_at.desc()).first()
    return {"last_refresh": latest[0].isoformat() if latest else None}
