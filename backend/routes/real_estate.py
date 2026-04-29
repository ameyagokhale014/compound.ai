from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models import RealEstate, User
from routes.auth import get_current_user

router = APIRouter(prefix="/real-estate", tags=["real_estate"])


class RealEstateCreate(BaseModel):
    address: str
    estimated_value: float
    ownership_pct: float = 100.0


class RealEstateUpdate(BaseModel):
    address: Optional[str] = None
    estimated_value: Optional[float] = None
    ownership_pct: Optional[float] = None


def to_dict(r: RealEstate) -> dict:
    equity = r.estimated_value * (r.ownership_pct / 100)
    return {
        "id": r.id,
        "address": r.address,
        "estimated_value": r.estimated_value,
        "ownership_pct": r.ownership_pct,
        "equity": equity,
        "created_at": r.created_at.isoformat(),
        "updated_at": r.updated_at.isoformat(),
    }


@router.get("/")
def list_properties(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return [to_dict(r) for r in db.query(RealEstate).filter(RealEstate.user_id == current_user.id).all()]


@router.post("/")
def add_property(
    body: RealEstateCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    r = RealEstate(
        user_id=current_user.id,
        address=body.address,
        estimated_value=body.estimated_value,
        ownership_pct=body.ownership_pct,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return to_dict(r)


@router.put("/{property_id}")
def update_property(
    property_id: int,
    body: RealEstateUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    r = db.query(RealEstate).filter(
        RealEstate.id == property_id, RealEstate.user_id == current_user.id
    ).first()
    if not r:
        raise HTTPException(404, "Property not found")
    if body.address is not None:
        r.address = body.address
    if body.estimated_value is not None:
        r.estimated_value = body.estimated_value
    if body.ownership_pct is not None:
        r.ownership_pct = body.ownership_pct
    from datetime import datetime
    r.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(r)
    return to_dict(r)


@router.delete("/{property_id}")
def delete_property(
    property_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    r = db.query(RealEstate).filter(
        RealEstate.id == property_id, RealEstate.user_id == current_user.id
    ).first()
    if not r:
        raise HTTPException(404, "Property not found")
    db.delete(r)
    db.commit()
    return {"ok": True}
