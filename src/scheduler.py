import threading
from apscheduler.schedulers.background import BackgroundScheduler

from .news import ingest_news_once
from .kpis import refresh_kpis_for_portfolio

_scheduler = None
_lock = threading.Lock()

def ensure_scheduler_running():
    global _scheduler
    with _lock:
        if _scheduler is not None:
            return

        _scheduler = BackgroundScheduler(daemon=True)

        # News refresh every 2 hours (your requirement)
        _scheduler.add_job(ingest_news_once, "interval", hours=2)

        # KPI refresh daily (can be changed to every 6h if you want)
        _scheduler.add_job(refresh_kpis_for_portfolio, "interval", hours=24)

        _scheduler.start()
