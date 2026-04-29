# compound.ai — Personal Portfolio Tracker

A full-stack personal finance dashboard with AI-powered analysis, real-time prices, and multi-user support. Built with FastAPI + React.

---

## What it does

- **Track portfolios** across multiple account types (Brokerage, Roth IRA, Traditional IRA, 401k, Cash)
- **Real-time prices** via WebSocket — live P&L, day change, cost basis
- **AI Buy Price Targets** — Claude calculates fair value and buy zones for every holding
- **AI Advisor** — ask anything about your portfolio in natural language
- **Popi Sim** — Claude acts as a portfolio manager over a fully virtual account
- **Earnings Intelligence** — upcoming earnings calendar with AI beat-probability analysis and last-call summaries
- **News Feed** — auto-refreshed news for all portfolio + watchlist symbols with impact scoring
- **Recommendations Hub** — AI-generated buy/sell/hold signals across your entire portfolio
- **Technical Signals** — RSI, MACD, Bollinger Bands, SMA/EMA crossovers with AI interpretation
- **Superinvestors** — tracks 13F filings from 18 top investors (Buffett, Ackman, Klarman, etc.)
- **Real Estate** — track property equity alongside your investment portfolio
- **Watchlist** — monitor stocks you don't yet own
- **Achievements** — streaks and badges for daily engagement
- **Multi-user auth** — JWT login, bcrypt passwords, per-user data isolation

---

## Tech Stack

### Backend
| Package | Purpose |
|---|---|
| FastAPI 0.128 | REST API + WebSocket server |
| SQLAlchemy | ORM — SQLite database |
| yfinance | Market data, earnings, stock info |
| Anthropic SDK 0.96 | Claude AI (buy targets, advisor, Popi, earnings analysis) |
| BeautifulSoup4 | Scrapes Dataroma for 13F superinvestor data |
| passlib + bcrypt | Password hashing |
| python-jose | JWT token generation + verification |
| uvicorn | ASGI server with hot reload |

### Frontend
| Package | Purpose |
|---|---|
| React 19 + TypeScript | UI framework |
| Vite | Dev server + build |
| Tailwind CSS 4 | Styling |
| Recharts | Portfolio charts |
| Axios | HTTP client (auto-attaches JWT + API key) |
| Lucide React | Icons |
| TanStack Query | (available, used selectively) |

---

## Project Structure

```
portfolio-tracker/
├── backend/
│   ├── main.py                  # FastAPI app, startup tasks, DB migrations, WebSocket
│   ├── models.py                # SQLAlchemy models
│   ├── database.py              # DB engine + session
│   ├── price_poller.py          # Real-time price polling + WebSocket broadcast
│   └── routes/
│       ├── auth.py              # Signup, login, JWT, user profile
│       ├── portfolios.py        # CRUD portfolios, holdings, transactions, sell (FIFO)
│       ├── watchlist.py         # Watchlist CRUD
│       ├── real_estate.py       # Property tracking
│       ├── stocks.py            # Stock data, price history, sector lookup
│       ├── search.py            # Symbol search
│       ├── buy_targets.py       # Manual buy price target calculator
│       ├── ai_buy_targets.py    # Claude-powered buy targets
│       ├── cached_buy_targets.py# DB-cached buy targets (refreshed daily)
│       ├── advisor.py           # AI portfolio advisor chat
│       ├── popi.py              # Popi chat (non-simulation)
│       ├── simulation.py        # Popi as portfolio manager (virtual account)
│       ├── earnings.py          # Earnings calendar, AI analysis, call summaries
│       ├── news.py              # News feed with impact scoring
│       ├── signals.py           # Technical signals (RSI, MACD, BB, SMA, EMA)
│       ├── superinvestors.py    # 13F scraper + consensus + Claude theme analysis
│       └── achievements.py      # Streaks + 35 badges
│
├── frontend/
│   └── src/
│       ├── main.tsx             # App entry point + AuthProvider
│       ├── App.tsx              # Tab routing + auth gate + nav bar
│       ├── api.ts               # All API calls + TypeScript types (JWT interceptor)
│       ├── types.ts             # Shared TypeScript interfaces
│       ├── contexts/
│       │   └── AuthContext.tsx  # Global auth state (user, token, login, logout)
│       ├── hooks/
│       │   └── useWebSocket.ts  # WebSocket hook for live prices
│       └── pages/
│           ├── AuthPage.tsx         # Login + signup (combined)
│           ├── SetupWizard.tsx      # 5-step optional profile setup after signup
│           ├── Home.tsx             # Portfolio dashboard
│           ├── PortfolioDetail.tsx  # Individual portfolio view
│           ├── MasterPortfolio.tsx  # Aggregate view across all portfolios
│           ├── StockPage.tsx        # Deep-dive stock analysis page
│           ├── Watchlist.tsx        # Watchlist management
│           ├── NewsTab.tsx          # News feed
│           ├── RecommendationsHub.tsx # AI recommendations
│           ├── EarningsTab.tsx      # Earnings calendar + AI analysis
│           ├── SimulationTab.tsx    # Popi virtual portfolio
│           └── SuperInvestorsPage.tsx # 13F superinvestor tracker
│       └── components/
│           ├── ProfileModal.tsx     # Full profile editor (3 tabs)
│           ├── GlobalSearch.tsx     # Symbol search bar
│           ├── AddHoldingModal.tsx  # Add stock/ETF/crypto/cash
│           ├── HoldingsTable.tsx    # Holdings with P&L
│           ├── PortfolioChart.tsx   # Portfolio value chart
│           ├── TotalChart.tsx       # Total net worth chart
│           ├── AllocationChart.tsx  # Pie chart by asset type
│           ├── SectorPieChart.tsx   # Sector allocation
│           ├── TechnicalChart.tsx   # Candlestick + indicators
│           ├── BuyAnalysis.tsx      # Buy price target card
│           ├── AdvisorPanel.tsx     # AI advisor chat
│           ├── Popi.tsx             # Popi chat component
│           ├── WealthScoreCard.tsx  # Wealth score widget
│           ├── AchievementsCard.tsx # Badges + streaks
│           ├── RealEstatePanel.tsx  # Property equity panel
│           ├── SellModal.tsx        # Sell shares (FIFO)
│           └── CashModal.tsx        # Cash balance management
│
├── start.sh                     # Starts both backend + frontend
├── .gitignore
└── README.md
```

---

## Database (SQLite)

| Table | Description |
|---|---|
| `users` | Auth + full investment profile (goals, risk, income, etc.) |
| `portfolios` | Per-user portfolio accounts |
| `holdings` | Stocks/ETFs/crypto within a portfolio |
| `transactions` | Buy lots per holding (supports FIFO sell) |
| `portfolio_snapshots` | Historical portfolio value (for charts) |
| `price_snapshots` | Historical price cache per symbol |
| `watchlist_items` | Per-user watchlist |
| `real_estate` | Per-user property holdings |
| `sim_portfolio` | Popi virtual portfolio (per user) |
| `sim_holdings` | Holdings in virtual portfolio |
| `sim_trades` | Trade log for virtual portfolio |
| `sim_goals` | Goals attached to virtual portfolio |
| `earnings_cache` | Cached earnings data + AI analysis per symbol |
| `buy_price_targets` | Cached buy targets (refreshed daily) |
| `news_items` | Cached news articles with impact scores |
| `stock_data_cache` | Cached yfinance data per symbol |
| `superinvestor_cache` | Cached 13F scrape data |
| `user_activity` | Per-user daily engagement (streaks) |

---

## Setup & Running

### Prerequisites
- Python 3.9+
- Node.js 18+
- An Anthropic API key (for all AI features)

### Backend
```bash
cd portfolio-tracker
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn sqlalchemy yfinance anthropic beautifulsoup4 requests passlib[bcrypt] "python-jose[cryptography]" "bcrypt==4.0.1"
cd backend
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd portfolio-tracker/frontend
npm install
npm run dev
```

Or use the start script to run both:
```bash
chmod +x start.sh && ./start.sh
```

App runs at **http://localhost:5173** — backend at **http://localhost:8000**

---

## Authentication

- JWT tokens (30-day expiry), stored in `localStorage`
- Passwords hashed with bcrypt (cost=12)
- All data routes require a valid token — each user sees only their own portfolios, watchlist, real estate, and simulation
- Shared across users (intentionally): stock data cache, earnings cache, buy targets cache, news, superinvestor data

### Environment Variables (optional)
```bash
JWT_SECRET=your-secret-key   # defaults to a dev key if not set
ANTHROPIC_API_KEY=sk-ant-... # fallback if user hasn't set one in their profile
```

---

## Key Design Decisions

- **SQLite** — single-file database, zero config, perfect for a personal app
- **WebSocket price feed** — prices poll every 60s during market hours, broadcast to all connected clients; previous close tracked for day change %
- **Background tasks on startup** — prices restored from DB immediately, then live prices fetched, then continuous polling starts; buy targets refresh daily after a 90s delay; news refreshes every 5 minutes
- **Anthropic API key per user** — stored in the user's DB profile, synced to `localStorage` on login so all existing AI interceptors continue to work unchanged
- **FIFO sell** — sell transactions reduce oldest buy lots first
- **Dataroma scraping** — dynamic column detection on 13F HTML tables so the scraper doesn't break if Dataroma changes column order
