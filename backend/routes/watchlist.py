from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from database import get_db
from models import WatchlistItem, User
from routes.auth import get_current_user

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


class WatchlistAdd(BaseModel):
    symbol: str
    name: Optional[str] = None
    notes: Optional[str] = None


@router.get("/")
def get_watchlist(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == current_user.id)
        .order_by(WatchlistItem.added_at.desc())
        .all()
    )


@router.post("/")
def add_to_watchlist(
    req: WatchlistAdd,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    symbol = req.symbol.upper()
    existing = db.query(WatchlistItem).filter(
        WatchlistItem.user_id == current_user.id,
        WatchlistItem.symbol == symbol,
    ).first()
    if existing:
        return existing
    item = WatchlistItem(
        user_id=current_user.id,
        symbol=symbol,
        name=req.name,
        notes=req.notes,
        added_at=datetime.utcnow(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}")
def remove_from_watchlist(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.query(WatchlistItem).filter(
        WatchlistItem.id == item_id,
        WatchlistItem.user_id == current_user.id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(item)
    db.commit()
    return {"ok": True}
