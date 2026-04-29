from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Enum, Boolean, Date, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base
import enum


class User(Base):
    """Authenticated user — stores identity, investment profile, and personalization context."""
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    email         = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    first_name    = Column(String, nullable=False)
    last_name     = Column(String, nullable=False)
    date_of_birth = Column(Date,   nullable=True)   # critical for time-horizon AI calibration

    # ── Work context ──────────────────────────────────────────────────────────
    company_name       = Column(String,  nullable=True)
    employer_sector    = Column(String,  nullable=True)   # avoid concentration risk in same sector
    annual_income      = Column(Float,   nullable=True)   # total comp (base+bonus+equity approx)
    monthly_investable = Column(Float,   nullable=True)   # new capital deployed per month

    # ── Investment profile ────────────────────────────────────────────────────
    # "beginner" | "2-5y" | "5-10y" | "10+y"
    experience_level  = Column(String,  nullable=True)
    # "<1y" | "1-3y" | "3-7y" | "7-15y" | "15+y"
    time_horizon      = Column(String,  nullable=True)
    # 1 (very conservative) – 5 (very aggressive)
    risk_tolerance    = Column(Integer, nullable=True)
    country           = Column(String,  nullable=True)

    # ── Goals ─────────────────────────────────────────────────────────────────
    # JSON: [{"id":"growth","label":"Growth","weight":40}, ...]  — weights sum to 100
    investing_goals   = Column(Text,    nullable=True)

    # ── Financial context ─────────────────────────────────────────────────────
    net_worth_outside      = Column(Float,   nullable=True)  # wealth outside this portfolio
    retirement_target_age  = Column(Integer, nullable=True)

    # ── Preferences ───────────────────────────────────────────────────────────
    sectors_to_avoid  = Column(Text,    nullable=True)   # JSON array of strings
    has_dependents    = Column(Boolean, nullable=True)

    # ── API key (personal app — stored as-is, never logged) ──────────────────
    anthropic_api_key = Column(String,  nullable=True)

    # ── Meta ──────────────────────────────────────────────────────────────────
    setup_complete    = Column(Boolean,  default=False)
    created_at        = Column(DateTime, default=datetime.utcnow)
    last_login        = Column(DateTime, nullable=True)


class AssetType(str, enum.Enum):
    STOCK = "stock"
    ETF = "etf"
    MUTUAL_FUND = "mutual_fund"
    CRYPTO = "crypto"
    CASH = "cash"


class Portfolio(Base):
    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    account_type = Column(String, default="brokerage")  # cash, brokerage, traditional_ira, roth_ira, 401k
    company_name = Column(String, nullable=True)         # 401k: employer name
    employer_status = Column(String, nullable=True)      # 401k: "current" or "past"
    created_at = Column(DateTime, default=datetime.utcnow)
    holdings = relationship("Holding", back_populates="portfolio", cascade="all, delete-orphan")
    cash_balance = Column(Float, default=0.0)


class Holding(Base):
    __tablename__ = "holdings"

    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    symbol = Column(String, nullable=False)
    name = Column(String, nullable=False)
    asset_type = Column(String, default=AssetType.STOCK)
    portfolio = relationship("Portfolio", back_populates="holdings")
    transactions = relationship("Transaction", back_populates="holding", cascade="all, delete-orphan")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    holding_id = Column(Integer, ForeignKey("holdings.id"), nullable=False)
    quantity = Column(Float, nullable=False)
    buy_price = Column(Float, nullable=False)
    purchased_at = Column(DateTime, default=datetime.utcnow)
    holding = relationship("Holding", back_populates="transactions")


class PriceSnapshot(Base):
    __tablename__ = "price_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True, nullable=False)
    price = Column(Float, nullable=False)
    recorded_at = Column(DateTime, default=datetime.utcnow, index=True)


class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    total_value = Column(Float, nullable=False)
    recorded_at = Column(DateTime, default=datetime.utcnow, index=True)


class RealEstate(Base):
    __tablename__ = "real_estate"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    address = Column(String, nullable=False)
    estimated_value = Column(Float, nullable=False)
    ownership_pct = Column(Float, nullable=False, default=100.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class StockDataCache(Base):
    __tablename__ = "stock_data_cache"

    symbol = Column(String, primary_key=True, index=True)
    data = Column(String, nullable=False)  # JSON blob
    cached_at = Column(DateTime, default=datetime.utcnow)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    symbol = Column(String, nullable=False)
    name = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    added_at = Column(DateTime, default=datetime.utcnow)


class BuyPriceTarget(Base):
    __tablename__ = "buy_price_targets"

    symbol = Column(String, primary_key=True, index=True)
    base_buy_price = Column(Float, nullable=True)
    forward_eps = Column(Float, nullable=True)
    eps_cagr_pct = Column(Float, nullable=True)
    exit_pe = Column(Float, nullable=True)
    current_price = Column(Float, nullable=True)
    signal = Column(String, nullable=True)  # strong_buy | buy | near_target | above_target
    last_updated = Column(DateTime, default=datetime.utcnow)


class UserActivity(Base):
    """One row per (user, calendar day) — tracks engagement for streak computation."""
    __tablename__ = "user_activity"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    date         = Column(Date, nullable=False, index=True)
    visited      = Column(Boolean, default=True)
    news_viewed  = Column(Boolean, default=False)
    recs_viewed  = Column(Boolean, default=False)
    wealth_score = Column(Float, nullable=True)   # snapshot sent from frontend
    net_worth    = Column(Float, nullable=True)   # snapshot sent from frontend


class SimPortfolio(Base):
    """Popi-managed simulation portfolio — completely isolated from real net wealth."""
    __tablename__ = "sim_portfolio"

    id                    = Column(Integer, primary_key=True, index=True)
    user_id               = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    principal             = Column(Float, nullable=False)
    total_contributed     = Column(Float, default=0.0)   # extra deposits after init
    cash_balance          = Column(Float, nullable=False)
    monthly_salary        = Column(Float, nullable=True)
    risk_appetite         = Column(String, default="moderate")
    popi_plan             = Column(String, nullable=True)  # JSON: full Claude plan
    benchmark_symbol      = Column(String, default="SPY")
    benchmark_start_price = Column(Float, nullable=True)
    last_traded           = Column(DateTime, nullable=True)
    created_at            = Column(DateTime, default=datetime.utcnow)
    goals    = relationship("SimGoal",    back_populates="sim", cascade="all, delete-orphan")
    holdings = relationship("SimHolding", back_populates="sim", cascade="all, delete-orphan")
    trades   = relationship("SimTrade",   back_populates="sim", cascade="all, delete-orphan")


class SimGoal(Base):
    __tablename__ = "sim_goals"

    id       = Column(Integer, primary_key=True, index=True)
    sim_id   = Column(Integer, ForeignKey("sim_portfolio.id"), nullable=False)
    name     = Column(String, nullable=False)
    amount   = Column(Float, nullable=False)
    years    = Column(Float, nullable=False)
    priority = Column(Integer, default=1)
    sim      = relationship("SimPortfolio", back_populates="goals")


class SimHolding(Base):
    __tablename__ = "sim_holdings"

    id          = Column(Integer, primary_key=True, index=True)
    sim_id      = Column(Integer, ForeignKey("sim_portfolio.id"), nullable=False)
    symbol      = Column(String, nullable=False)
    name        = Column(String, nullable=False)
    quantity    = Column(Float, nullable=False)
    avg_cost    = Column(Float, nullable=False)
    target_pct  = Column(Float, nullable=True)   # Popi's target allocation %
    rationale   = Column(String, nullable=True)
    asset_class = Column(String, nullable=True)
    sim         = relationship("SimPortfolio", back_populates="holdings")


class SimTrade(Base):
    __tablename__ = "sim_trades"

    id          = Column(Integer, primary_key=True, index=True)
    sim_id      = Column(Integer, ForeignKey("sim_portfolio.id"), nullable=False)
    symbol      = Column(String, nullable=False)
    action      = Column(String, nullable=False)   # "buy" | "sell"
    quantity    = Column(Float, nullable=False)
    price       = Column(Float, nullable=False)
    amount      = Column(Float, nullable=False)    # quantity × price
    reason      = Column(String, nullable=True)
    executed_at = Column(DateTime, default=datetime.utcnow)
    sim         = relationship("SimPortfolio", back_populates="trades")


class EarningsCache(Base):
    """Cached earnings calendar data + AI analysis per symbol."""
    __tablename__ = "earnings_cache"

    symbol           = Column(String, primary_key=True, index=True)
    yf_data          = Column(String, nullable=True)   # JSON blob from yfinance
    ai_analysis      = Column(String, nullable=True)   # JSON blob from Claude (forward-looking)
    call_summary     = Column(String, nullable=True)   # JSON blob: most-recent earnings call summary
    last_fetched     = Column(DateTime, nullable=True)
    last_analyzed    = Column(DateTime, nullable=True)
    last_summarized  = Column(DateTime, nullable=True)


class SuperInvestorCache(Base):
    """Cache for Dataroma superinvestor 13F data."""
    __tablename__ = "superinvestor_cache"

    key        = Column(String, primary_key=True, index=True)  # e.g. "managers", "portfolio_BRK", "activity"
    data       = Column(String, nullable=True)                  # JSON blob
    fetched_at = Column(DateTime, nullable=True)


class NewsItem(Base):
    """Cached news articles for portfolio + watchlist symbols, refreshed every 5 min."""
    __tablename__ = "news_items"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)   # the tracked symbol this belongs to
    asset_type = Column(String, default="stock")           # "stock" | "real_estate"
    title = Column(String, nullable=False)
    publisher = Column(String, nullable=True)
    url = Column(String, nullable=False)
    published_at = Column(DateTime, nullable=False, index=True)
    impact_score = Column(Float, nullable=True)            # -10 to +10
    impact_label = Column(String, nullable=True)           # Very Bullish / Bullish / Neutral / Bearish / Very Bearish
    impact_summary = Column(String, nullable=True)         # 1-sentence why this matters
    action_required = Column(String, nullable=True)        # None | "monitor" | "consider_selling" | "consider_buying"
    fetched_at = Column(DateTime, default=datetime.utcnow)
