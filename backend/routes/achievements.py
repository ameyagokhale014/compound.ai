"""
Achievements route — streaks + badges for compound.ai.

Streaks
  🔥 Daily Check-in   consecutive days logged in
  📰 News Streak      consecutive days news tab viewed
  📋 Recs Streak      consecutive days Recommendations viewed

Badges (35 total across 6 categories)
  🏛️  Foundation       account setup milestones
  💰  Wealth           net-worth thresholds
  🌐  Diversification  asset-class and sector spread
  🎯  Discipline       buy-quality milestones
  📊  Optimization     wealth-score thresholds (60/70/80/95)
  🔥  Streak           streak-length milestones (7/30/90 days)
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import (
    BuyPriceTarget, Portfolio, RealEstate,
    UserActivity, WatchlistItem, User,
)
from routes.auth import get_current_user

router = APIRouter(prefix="/achievements", tags=["achievements"])


# ── Streak helpers ────────────────────────────────────────────────────────────

def _consecutive_streak(dates: list[date]) -> int:
    """Count consecutive calendar days ending today (or yesterday = grace period)."""
    if not dates:
        return 0
    date_set = set(dates)
    today = date.today()
    # Allow yesterday as "current" (in case they haven't visited yet today)
    anchor = today if today in date_set else today - timedelta(days=1)
    if anchor not in date_set:
        return 0
    streak = 0
    d = anchor
    while d in date_set:
        streak += 1
        d -= timedelta(days=1)
    return streak


def _streaks(db: Session, user_id: int) -> dict:
    rows = db.query(UserActivity).filter(UserActivity.user_id == user_id).all()
    login_dates = [r.date for r in rows if r.visited]
    news_dates  = [r.date for r in rows if r.news_viewed]
    recs_dates  = [r.date for r in rows if r.recs_viewed]
    return {
        "login": _consecutive_streak(login_dates),
        "news":  _consecutive_streak(news_dates),
        "recs":  _consecutive_streak(recs_dates),
    }


# ── Badge definitions ─────────────────────────────────────────────────────────

def _badge(key: str, emoji: str, name: str, desc: str,
           category: str, rarity: str = "common",
           earned: bool = False, progress: float = 0.0,
           progress_label: str = "") -> dict:
    return dict(
        key=key, emoji=emoji, name=name, desc=desc,
        category=category, rarity=rarity,
        earned=earned, progress=min(progress, 1.0),
        progress_label=progress_label,
    )


def _compute_badges(db: Session, streaks: dict, user_id: int) -> list[dict]:
    badges: list[dict] = []

    # ── pull data scoped to current user ──────────────────────────────────────
    portfolios   = db.query(Portfolio).filter(Portfolio.user_id == user_id).all()
    has_re       = db.query(RealEstate).filter(RealEstate.user_id == user_id).count() > 0
    has_watchlist= db.query(WatchlistItem).filter(WatchlistItem.user_id == user_id).count() > 0
    buy_targets  = {bt.symbol: bt for bt in db.query(BuyPriceTarget).all()}

    account_types = {p.account_type for p in portfolios}
    all_holdings  = [h for p in portfolios for h in p.holdings]
    stock_holdings= [h for h in all_holdings if h.asset_type not in ("cash",)]
    has_crypto    = any(h.asset_type == "crypto" for h in all_holdings)
    has_brokerage = "brokerage" in account_types
    has_roth      = "roth_ira" in account_types
    has_trad_ira  = "traditional_ira" in account_types
    has_401k      = "401k" in account_types
    has_retirement= has_roth or has_trad_ira or has_401k

    # Net worth & returns from latest UserActivity snapshot
    latest_activity = (
        db.query(UserActivity)
        .filter(UserActivity.user_id == user_id, UserActivity.net_worth.isnot(None))
        .order_by(UserActivity.date.desc())
        .first()
    )
    net_worth    = latest_activity.net_worth    if latest_activity else 0.0
    wealth_score = latest_activity.wealth_score if latest_activity else 0.0

    # ── compute per-holding values from raw transactions + live prices ──────────
    import price_poller as _pp

    def _holding_qty(h) -> float:
        return sum(tx.quantity for tx in h.transactions)

    def _holding_cost(h) -> float:
        return sum(tx.quantity * tx.buy_price for tx in h.transactions)

    def _holding_price(h) -> float:
        """Live price → BuyPriceTarget.current_price → 0."""
        p = _pp.latest_prices.get(h.symbol)
        if p:
            return p
        bt = buy_targets.get(h.symbol)
        if bt and bt.current_price:
            return bt.current_price
        return 0.0

    def _holding_current_value(h) -> float:
        return _holding_price(h) * _holding_qty(h)

    def _holding_avg_cost(h) -> float:
        qty = _holding_qty(h)
        return _holding_cost(h) / qty if qty > 0 else 0.0

    # Total portfolio gain/loss (computed from raw transactions)
    total_cost = sum(_holding_cost(h) for h in all_holdings if h.asset_type != "cash")
    total_current = sum(_holding_current_value(h) for h in all_holdings if h.asset_type != "cash")
    total_gain_loss = total_current - total_cost
    gain_pct = (total_gain_loss / total_cost * 100) if total_cost > 0 else 0.0

    # Unique sectors (read from stock_data_cache if available, else skip)
    try:
        from models import StockDataCache
        import json
        sector_set: set[str] = set()
        for h in stock_holdings:
            cache = db.query(StockDataCache).filter(StockDataCache.symbol == h.symbol).first()
            if cache:
                data = json.loads(cache.data)
                sec = data.get("sector") or data.get("info", {}).get("sector")
                if sec and sec not in ("Unknown", "N/A", ""):
                    sector_set.add(sec)
        n_sectors = len(sector_set)
    except Exception:
        n_sectors = 0

    # Concentration: top single holding % of stock portfolio
    stock_value_map: dict[str, float] = {}
    for h in stock_holdings:
        stock_value_map[h.symbol] = stock_value_map.get(h.symbol, 0) + _holding_current_value(h)
    total_stock_value = sum(stock_value_map.values())
    top_holding_pct   = (
        max(stock_value_map.values()) / total_stock_value * 100
        if total_stock_value > 0 and stock_value_map else 0
    )

    # Discipline: has any holding where avg_cost ≤ buy target
    disciplined_entries = 0
    strong_buy_entries  = 0
    for h in stock_holdings:
        bt = buy_targets.get(h.symbol)
        avg_cost = _holding_avg_cost(h)
        if bt and bt.base_buy_price and avg_cost > 0:
            if avg_cost <= bt.base_buy_price:
                disciplined_entries += 1
            if avg_cost <= bt.base_buy_price * 0.82:   # strong_buy zone
                strong_buy_entries += 1

    login_streak = streaks["login"]
    news_streak  = streaks["news"]
    recs_streak  = streaks["recs"]

    # ── 🏛️ FOUNDATION BADGES ────────────────────────────────────────────────
    badges += [
        _badge("first_brick",  "🧱", "First Brick",
               "Added your first portfolio",
               "Foundation", earned=len(portfolios) > 0,
               progress=1.0 if portfolios else 0.0),
        _badge("in_the_market", "📊", "In The Market",
               "Set up a brokerage account",
               "Foundation", earned=has_brokerage),
        _badge("tax_free_pioneer", "🌱", "Tax-Free Pioneer",
               "Opened a Roth IRA",
               "Foundation", earned=has_roth),
        _badge("retirement_planted", "🌳", "Retirement Planted",
               "Opened a Traditional IRA",
               "Foundation", earned=has_trad_ira),
        _badge("employer_advantage", "💼", "Employer Advantage",
               "Set up a 401(k) account",
               "Foundation", earned=has_401k),
        _badge("property_owner", "🏠", "Property Owner",
               "Added real estate to your portfolio",
               "Foundation", earned=has_re),
        _badge("eyes_on_prize", "👁️", "Eyes on the Prize",
               "Added your first stock to the watchlist",
               "Foundation", earned=has_watchlist),
        _badge("digital_asset", "₿", "Digital Asset",
               "Added crypto to your portfolio",
               "Foundation", earned=has_crypto),
        _badge("dual_track", "🛤️", "Dual Track",
               "Have both retirement and brokerage accounts",
               "Foundation", earned=has_retirement and has_brokerage),
        _badge("fully_structured", "🏗️", "Fully Structured",
               "Have 3+ different account types",
               "Foundation",
               earned=len({t for t in account_types if t != "cash"}) >= 3,
               progress=min(len({t for t in account_types if t != "cash"}) / 3, 1.0),
               progress_label=f"{len({t for t in account_types if t != 'cash'})}/3 account types"),
    ]

    # ── 💰 WEALTH MILESTONE BADGES ───────────────────────────────────────────
    nw_tiers = [
        ("first_10k",   "💰", "First $10K",     "Net worth crossed $10,000",       10_000,   "common"),
        ("getting_serious","📈","Getting Serious","Net worth crossed $50,000",       50_000,   "common"),
        ("six_figures", "💵", "Six Figures",     "Net worth crossed $100,000",      100_000,  "uncommon"),
        ("quarter_mil", "🚀", "Quarter Million", "Net worth crossed $250,000",      250_000,  "uncommon"),
        ("half_mil",    "⭐", "Half a Million",  "Net worth crossed $500,000",      500_000,  "rare"),
        ("millionaire", "🏆", "Millionaire",     "Net worth crossed $1,000,000",    1_000_000,"legendary"),
    ]
    for key, emoji, name, desc, threshold, rarity in nw_tiers:
        badges.append(_badge(key, emoji, name, desc, "Wealth", rarity=rarity,
                             earned=net_worth >= threshold,
                             progress=min(net_worth / threshold, 1.0) if threshold > 0 else 0,
                             progress_label=f"${net_worth:,.0f} / ${threshold:,.0f}"))

    # ── 🌐 DIVERSIFICATION BADGES ────────────────────────────────────────────
    n_asset_classes = sum([
        total_stock_value > 0,
        has_re,
        has_retirement,
        has_crypto,
    ])
    badges += [
        _badge("sector_explorer", "🌍", "Sector Explorer",
               "Holdings spread across 3+ sectors",
               "Diversification", earned=n_sectors >= 3,
               progress=min(n_sectors / 3, 1.0),
               progress_label=f"{n_sectors}/3 sectors"),
        _badge("well_rounded", "🔵", "Well Rounded",
               "Holdings spread across 5+ sectors",
               "Diversification", earned=n_sectors >= 5,
               progress=min(n_sectors / 5, 1.0),
               progress_label=f"{n_sectors}/5 sectors"),
        _badge("fully_diversified", "🌐", "Fully Diversified",
               "Holdings spread across 7+ sectors",
               "Diversification", rarity="rare", earned=n_sectors >= 7,
               progress=min(n_sectors / 7, 1.0),
               progress_label=f"{n_sectors}/7 sectors"),
        _badge("balanced", "⚖️", "Balanced",
               "No single stock exceeds 25% of your portfolio",
               "Diversification", earned=top_holding_pct <= 25 and total_stock_value > 0,
               progress=max(0.0, 1.0 - (top_holding_pct - 25) / 75) if top_holding_pct > 25 else 1.0,
               progress_label=f"Top holding: {top_holding_pct:.0f}% (target ≤25%)"),
        _badge("triple_play", "🎯", "Triple Play",
               "Invest in stocks, real estate, and retirement accounts",
               "Diversification", earned=n_asset_classes >= 3,
               progress=min(n_asset_classes / 3, 1.0),
               progress_label=f"{n_asset_classes}/3 asset classes"),
        _badge("all_asset_class", "💎", "All Asset Class",
               "Stocks, real estate, retirement, AND crypto",
               "Diversification", rarity="rare", earned=n_asset_classes >= 4,
               progress=min(n_asset_classes / 4, 1.0),
               progress_label=f"{n_asset_classes}/4 asset classes"),
    ]

    # ── 🎯 DISCIPLINE BADGES ─────────────────────────────────────────────────
    badges += [
        _badge("disciplined_entry", "🎯", "Disciplined Entry",
               "Bought a stock at or below its calculated buy target",
               "Discipline", earned=disciplined_entries > 0,
               progress=1.0 if disciplined_entries > 0 else 0.0),
        _badge("signal_reader", "💡", "Signal Reader",
               "Bought a stock in the Strong Buy zone (>18% below target)",
               "Discipline", rarity="uncommon", earned=strong_buy_entries > 0),
        _badge("in_the_green", "✅", "In the Green",
               "Your overall portfolio is at a positive unrealized gain",
               "Discipline", earned=gain_pct > 0,
               progress=min(max(gain_pct / 10, 0), 1.0),
               progress_label=f"{gain_pct:+.1f}% overall gain"),
        _badge("compounding", "🔄", "Compounding",
               "Overall portfolio up 25% or more",
               "Discipline", rarity="uncommon", earned=gain_pct >= 25,
               progress=min(gain_pct / 25, 1.0),
               progress_label=f"{gain_pct:.1f}% / 25%"),
        _badge("alpha_generator", "🔥", "Alpha Generator",
               "Overall portfolio up 50% or more",
               "Discipline", rarity="rare", earned=gain_pct >= 50,
               progress=min(gain_pct / 50, 1.0),
               progress_label=f"{gain_pct:.1f}% / 50%"),
    ]

    # ── 📊 OPTIMIZATION SCORE BADGES ────────────────────────────────────────
    score_tiers = [
        ("optimizer_rising", "📊", "Optimizer Rising",
         "Wealth score reached 60+", 60, "common"),
        ("wealth_optimizer", "💡", "Wealth Optimizer",
         "Wealth score reached 70+", 70, "uncommon"),
        ("high_performer",  "🌟", "High Performer",
         "Wealth score reached 80+", 80, "rare"),
        ("legendary_optimizer", "🏆", "Legendary Optimizer",
         "Wealth score reached 95+ — top tier", 95, "legendary"),
    ]
    for key, emoji, name, desc, threshold, rarity in score_tiers:
        ws = wealth_score or 0
        badges.append(_badge(key, emoji, name, desc, "Optimization", rarity=rarity,
                             earned=ws >= threshold,
                             progress=min(ws / threshold, 1.0) if threshold > 0 else 0,
                             progress_label=f"Score {ws:.0f}/{threshold}"))

    # ── 🔥 STREAK MILESTONE BADGES ───────────────────────────────────────────
    streak_milestones = [
        ("week_strong",      "🔥", "Week Strong",      "7-day daily check-in streak",   7,   login_streak, "common"),
        ("monthly_investor", "📅", "Monthly Investor", "30-day daily check-in streak",  30,  login_streak, "uncommon"),
        ("quarterly_habit",  "💪", "Quarterly Habit",  "90-day daily check-in streak",  90,  login_streak, "rare"),
        ("news_junkie",      "📰", "News Junkie",      "14-day news reading streak",     14,  news_streak,  "uncommon"),
        ("always_informed",  "🗞️", "Always Informed",  "30-day news reading streak",     30,  news_streak,  "rare"),
        ("plugged_in",       "🔌", "Plugged In",       "Visited Recommendations Hub",    1,   recs_streak,  "common"),
        ("recs_master",      "✦",  "Recs Master",      "7-day Recommendations streak",   7,   recs_streak,  "uncommon"),
    ]
    for key, emoji, name, desc, target, current, rarity in streak_milestones:
        badges.append(_badge(key, emoji, name, desc, "Streaks", rarity=rarity,
                             earned=current >= target,
                             progress=min(current / target, 1.0),
                             progress_label=f"{current}/{target} days"))

    return badges


# ── API ───────────────────────────────────────────────────────────────────────

class ActivityIn(BaseModel):
    page: str = "dashboard"     # dashboard | news | recommendations | watchlist
    wealth_score: Optional[float] = None
    net_worth: Optional[float] = None


@router.post("/activity")
def record_activity(
    body: ActivityIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Called from the frontend on each page visit to maintain streak data."""
    today = date.today()
    row = db.query(UserActivity).filter(
        UserActivity.user_id == current_user.id,
        UserActivity.date == today,
    ).first()
    if not row:
        row = UserActivity(user_id=current_user.id, date=today)
        db.add(row)

    row.visited = True
    if body.page == "news":            row.news_viewed = True
    if body.page == "recommendations": row.recs_viewed = True

    if body.wealth_score is not None: row.wealth_score = body.wealth_score
    if body.net_worth    is not None: row.net_worth    = body.net_worth

    db.commit()
    return {"ok": True, "date": today.isoformat()}


@router.get("/")
def get_achievements(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all streaks and badges with earned status + progress."""
    streaks = _streaks(db, current_user.id)
    badges  = _compute_badges(db, streaks, current_user.id)

    earned_count = sum(1 for b in badges if b["earned"])

    # Next to unlock — top 4 unearned badges closest to completion
    next_up = sorted(
        [b for b in badges if not b["earned"] and b["progress"] > 0],
        key=lambda b: -b["progress"],
    )[:4]

    return {
        "streaks":       streaks,
        "badges":        badges,
        "earned_count":  earned_count,
        "total_count":   len(badges),
        "next_up":       next_up,
    }
