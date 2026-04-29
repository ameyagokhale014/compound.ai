from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from database import engine, get_db
import models
from routes import portfolios, search, real_estate, advisor, buy_targets, ai_buy_targets, popi, cached_buy_targets, stocks, watchlist, news as news_route, achievements as achievements_route, earnings as earnings_route, simulation as simulation_route, signals as signals_route, superinvestors as superinvestors_route, auth as auth_route
import price_poller

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Portfolio Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175",
                   "http://localhost:5176", "http://localhost:5177", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(portfolios.router)
app.include_router(search.router)
app.include_router(real_estate.router)
app.include_router(advisor.router)
app.include_router(buy_targets.router)
app.include_router(ai_buy_targets.router)
app.include_router(popi.router)
app.include_router(cached_buy_targets.router)
app.include_router(stocks.router)
app.include_router(watchlist.router)
app.include_router(news_route.router)
app.include_router(achievements_route.router)
app.include_router(earnings_route.router)
app.include_router(simulation_route.router)
app.include_router(signals_route.router)
app.include_router(superinvestors_route.router)
app.include_router(auth_route.router)


@app.on_event("startup")
async def startup():
    _run_migrations()
    asyncio.create_task(_startup_fetch())


def _run_migrations():
    db = next(get_db())
    try:
        from sqlalchemy import text
        # earnings_cache table
        try:
            db.execute(text(
                "CREATE TABLE IF NOT EXISTS earnings_cache "
                "(symbol VARCHAR PRIMARY KEY, yf_data TEXT, ai_analysis TEXT, "
                "last_fetched DATETIME, last_analyzed DATETIME)"
            ))
            db.commit()
        except Exception:
            pass

        for col, defn in [
            ("account_type", "VARCHAR DEFAULT 'brokerage'"),
            ("company_name", "VARCHAR"),
            ("employer_status", "VARCHAR"),
        ]:
            try:
                db.execute(text(f"ALTER TABLE portfolios ADD COLUMN {col} {defn}"))
                db.commit()
            except Exception:
                pass  # column already exists

        # users table
        try:
            db.execute(text(
                "CREATE TABLE IF NOT EXISTS users ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "email VARCHAR UNIQUE NOT NULL, "
                "password_hash VARCHAR NOT NULL, "
                "first_name VARCHAR NOT NULL, "
                "last_name VARCHAR NOT NULL, "
                "date_of_birth DATE, "
                "company_name VARCHAR, employer_sector VARCHAR, "
                "annual_income FLOAT, monthly_investable FLOAT, "
                "experience_level VARCHAR, time_horizon VARCHAR, "
                "risk_tolerance INTEGER, country VARCHAR, "
                "investing_goals TEXT, net_worth_outside FLOAT, "
                "retirement_target_age INTEGER, sectors_to_avoid TEXT, "
                "has_dependents BOOLEAN, anthropic_api_key VARCHAR, "
                "setup_complete BOOLEAN DEFAULT 0, "
                "created_at DATETIME, last_login DATETIME)"
            ))
            db.commit()
        except Exception:
            pass

        # superinvestor_cache table
        try:
            db.execute(text(
                "CREATE TABLE IF NOT EXISTS superinvestor_cache "
                "(key VARCHAR PRIMARY KEY, data TEXT, fetched_at DATETIME)"
            ))
            db.commit()
        except Exception:
            pass

        # earnings_cache extra columns
        for col, defn in [
            ("call_summary", "TEXT"),
            ("last_summarized", "DATETIME"),
        ]:
            try:
                db.execute(text(f"ALTER TABLE earnings_cache ADD COLUMN {col} {defn}"))
                db.commit()
            except Exception:
                pass

        # ── Multi-user isolation migrations ──────────────────────────────────
        # Add user_id to portfolios, real_estate, sim_portfolio
        for table in ("portfolios", "real_estate", "sim_portfolio"):
            try:
                db.execute(text(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER"))
                db.commit()
            except Exception:
                pass  # column already exists

        # Backfill existing rows to user_id=1 (first registered user)
        for table in ("portfolios", "real_estate", "sim_portfolio"):
            try:
                db.execute(text(f"UPDATE {table} SET user_id = 1 WHERE user_id IS NULL"))
                db.commit()
            except Exception:
                pass

        # Recreate watchlist_items with (user_id, symbol) uniqueness
        try:
            cols = [r[1] for r in db.execute(text("PRAGMA table_info(watchlist_items)")).fetchall()]
            if "user_id" not in cols:
                db.execute(text(
                    "CREATE TABLE IF NOT EXISTS watchlist_items_new ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "user_id INTEGER, symbol VARCHAR NOT NULL, "
                    "name VARCHAR, notes VARCHAR, added_at DATETIME, "
                    "UNIQUE(user_id, symbol))"
                ))
                db.execute(text(
                    "INSERT INTO watchlist_items_new "
                    "SELECT id, 1, symbol, name, notes, added_at FROM watchlist_items"
                ))
                db.execute(text("DROP TABLE watchlist_items"))
                db.execute(text("ALTER TABLE watchlist_items_new RENAME TO watchlist_items"))
                db.commit()
        except Exception:
            pass

        # Recreate user_activity with (user_id, date) uniqueness
        try:
            cols = [r[1] for r in db.execute(text("PRAGMA table_info(user_activity)")).fetchall()]
            if "user_id" not in cols:
                db.execute(text(
                    "CREATE TABLE IF NOT EXISTS user_activity_new ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                    "user_id INTEGER, date DATE NOT NULL, "
                    "visited BOOLEAN DEFAULT 1, news_viewed BOOLEAN DEFAULT 0, "
                    "recs_viewed BOOLEAN DEFAULT 0, wealth_score FLOAT, net_worth FLOAT, "
                    "UNIQUE(user_id, date))"
                ))
                db.execute(text(
                    "INSERT INTO user_activity_new "
                    "SELECT id, 1, date, visited, news_viewed, recs_viewed, wealth_score, net_worth "
                    "FROM user_activity"
                ))
                db.execute(text("DROP TABLE user_activity"))
                db.execute(text("ALTER TABLE user_activity_new RENAME TO user_activity"))
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


async def _startup_fetch():
    # Step 1: restore last known prices from DB (SQLite-compatible query)
    db = next(get_db())
    try:
        from sqlalchemy import text
        rows = db.execute(text(
            """
            SELECT s.symbol, s.price
            FROM price_snapshots s
            INNER JOIN (
                SELECT symbol, MAX(recorded_at) AS max_ts
                FROM price_snapshots
                GROUP BY symbol
            ) latest ON s.symbol = latest.symbol AND s.recorded_at = latest.max_ts
            """
        )).fetchall()
        for row in rows:
            price_poller.latest_prices[row[0]] = row[1]
        print(f"[startup] restored {len(rows)} prices from DB")
    except Exception as e:
        print(f"[startup] DB restore error: {e}")
    finally:
        db.close()

    # Step 2: immediately fetch live prices for all tracked symbols
    db2 = next(get_db())
    try:
        symbol_map = price_poller.get_tracked_symbols(db2)
        if symbol_map:
            print(f"[startup] fetching live prices for {list(symbol_map.keys())}")
            prices = await price_poller.fetch_initial_prices(list(symbol_map.keys()), symbol_map)
            # Persist these snapshots
            now = __import__("datetime").datetime.utcnow()
            for sym, price in prices.items():
                from models import PriceSnapshot
                db2.add(PriceSnapshot(symbol=sym, price=price, recorded_at=now))
            db2.commit()
            await price_poller.broadcast_prices(prices)
            print(f"[startup] fetched {len(prices)} live prices")
    except Exception as e:
        print(f"[startup] live fetch error: {e}")
    finally:
        db2.close()

    # Step 3: kick off the continuous polling loop
    asyncio.create_task(price_poller.poll_prices())

    # Step 4: kick off daily buy price target refresh
    asyncio.create_task(_buy_target_refresh_loop())

    # Step 5: kick off 5-minute news poller
    asyncio.create_task(_news_refresh_loop())


async def _buy_target_refresh_loop():
    """Refresh buy price targets once on startup (after prices load), then every 24 hours."""
    await asyncio.sleep(90)  # wait for live prices to populate first
    while True:
        _refresh_all_buy_targets()
        await asyncio.sleep(24 * 3600)


def _refresh_all_buy_targets():
    db = next(get_db())
    try:
        from routes.cached_buy_targets import refresh_symbols_in_db
        sym_set: set = set()
        for p in db.query(models.Portfolio).all():
            for h in p.holdings:
                if h.asset_type != "cash":
                    sym_set.add(h.symbol)
        # Also include watchlist symbols
        for w in db.query(models.WatchlistItem).all():
            sym_set.add(w.symbol)
        if sym_set:
            print(f"[buy-targets] refreshing {len(sym_set)} symbols: {sym_set}")
            count = refresh_symbols_in_db(list(sym_set), db)
            print(f"[buy-targets] refreshed {count} symbols")
    except Exception as e:
        print(f"[buy-targets] refresh error: {e}")
    finally:
        db.close()


async def _news_refresh_loop():
    """Fetch news every 5 minutes for all portfolio + watchlist symbols."""
    await asyncio.sleep(30)   # brief startup delay
    while True:
        try:
            db = next(get_db())
            from routes.news import refresh_all_news
            count = refresh_all_news(db)
            print(f"[news] refreshed — {count} new articles")
        except Exception as e:
            print(f"[news] refresh error: {e}")
        finally:
            try:
                db.close()
            except Exception:
                pass
        await asyncio.sleep(300)   # 5 minutes


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    price_poller.connected_clients.add(websocket)
    try:
        # Send current prices immediately on connect
        if price_poller.latest_prices:
            await websocket.send_json({"type": "price_update", "prices": price_poller.latest_prices})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        price_poller.connected_clients.discard(websocket)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "market_open":   price_poller.is_market_open(),
        "extended_hours": price_poller.is_extended_hours(),
        "session":        price_poller.current_session(),
    }
