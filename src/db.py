from sqlalchemy import create_engine, text

ENGINE = create_engine("sqlite:///portfolio.db", future=True)

def init_db():
    with ENGINE.begin() as conn:
        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS positions (
            ticker TEXT PRIMARY KEY,
            quantity REAL NOT NULL,
            avg_price REAL NOT NULL
        );
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS news_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT,
            title TEXT,
            url TEXT UNIQUE,
            published TEXT,
            source TEXT,
            snippet TEXT,
            summary TEXT,
            impact_score INTEGER,
            action_hint TEXT
        );
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS fundamentals_snapshot (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            snapshot_date TEXT NOT NULL,
            market_cap REAL,
            revenue_ttm REAL,
            revenue_growth_yoy REAL,
            net_income_ttm REAL,
            net_income_growth_yoy REAL,
            eps_ttm REAL,
            forward_eps REAL,
            pe REAL,
            forward_pe REAL,
            peg REAL,
            fcf_ttm REAL,
            gross_margin REAL,
            operating_margin REAL
        );
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS estimates_snapshot (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            snapshot_date TEXT NOT NULL,
            analyst_target_12m REAL,
            analyst_low REAL,
            analyst_high REAL
        );
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS targets_model (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            snapshot_date TEXT NOT NULL,
            target_12m REAL,
            target_24m REAL,
            target_36m REAL,
            assumptions TEXT
        );
        """))
