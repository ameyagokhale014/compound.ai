"""
Authentication routes
─────────────────────
POST /auth/signup   — create account (returns token + user)
POST /auth/login    — email + password (returns token + user)
GET  /auth/me       — get current user profile (requires token)
PUT  /auth/me       — update profile fields (requires token)
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database import get_db
from models import User

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Crypto setup ───────────────────────────────────────────────────────────────
# In production this should come from an env var; fine hardcoded for a personal app
SECRET_KEY = os.environ.get("JWT_SECRET", "compound-ai-secret-change-in-prod-2024")
ALGORITHM  = "HS256"
TOKEN_DAYS = 30

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── JWT helpers ────────────────────────────────────────────────────────────────

def _make_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(days=TOKEN_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def _verify_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        return int(sub) if sub else None
    except JWTError:
        return None


def get_current_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Dependency: extract + validate JWT, return User row."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not authorization or not authorization.startswith("Bearer "):
        raise credentials_exc
    token = authorization.split(" ", 1)[1]
    user_id = _verify_token(token)
    if not user_id:
        raise credentials_exc
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise credentials_exc
    return user


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class SignupBody(BaseModel):
    email:          str
    password:       str
    first_name:     str
    last_name:      str
    date_of_birth:  Optional[str] = None  # "YYYY-MM-DD"


class LoginBody(BaseModel):
    email:    str
    password: str


class ProfileUpdateBody(BaseModel):
    first_name:           Optional[str]   = None
    last_name:            Optional[str]   = None
    date_of_birth:        Optional[str]   = None
    company_name:         Optional[str]   = None
    employer_sector:      Optional[str]   = None
    annual_income:        Optional[float] = None
    monthly_investable:   Optional[float] = None
    experience_level:     Optional[str]   = None
    time_horizon:         Optional[str]   = None
    risk_tolerance:       Optional[int]   = None
    country:              Optional[str]   = None
    investing_goals:      Optional[list]  = None   # list of {id, label, weight}
    net_worth_outside:    Optional[float] = None
    retirement_target_age:Optional[int]   = None
    sectors_to_avoid:     Optional[list]  = None   # list of strings
    has_dependents:       Optional[bool]  = None
    anthropic_api_key:    Optional[str]   = None
    setup_complete:       Optional[bool]  = None


# ── User serialiser ────────────────────────────────────────────────────────────

def _user_dict(user: User) -> dict:
    goals = None
    if user.investing_goals:
        try:
            goals = json.loads(user.investing_goals)
        except Exception:
            goals = []

    sectors = None
    if user.sectors_to_avoid:
        try:
            sectors = json.loads(user.sectors_to_avoid)
        except Exception:
            sectors = []

    return {
        "id":                    user.id,
        "email":                 user.email,
        "first_name":            user.first_name,
        "last_name":             user.last_name,
        "date_of_birth":         user.date_of_birth.isoformat() if user.date_of_birth else None,
        "company_name":          user.company_name,
        "employer_sector":       user.employer_sector,
        "annual_income":         user.annual_income,
        "monthly_investable":    user.monthly_investable,
        "experience_level":      user.experience_level,
        "time_horizon":          user.time_horizon,
        "risk_tolerance":        user.risk_tolerance,
        "country":               user.country,
        "investing_goals":       goals,
        "net_worth_outside":     user.net_worth_outside,
        "retirement_target_age": user.retirement_target_age,
        "sectors_to_avoid":      sectors,
        "has_dependents":        user.has_dependents,
        "anthropic_api_key":     user.anthropic_api_key,
        "setup_complete":        user.setup_complete,
        "created_at":            user.created_at.isoformat() if user.created_at else None,
    }


def _token_response(user: User) -> dict:
    return {
        "access_token": _make_token(user.id),
        "token_type":   "bearer",
        "user":         _user_dict(user),
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/signup")
def signup(body: SignupBody, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email.lower().strip()).first():
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    dob = None
    if body.date_of_birth:
        try:
            dob = date.fromisoformat(body.date_of_birth)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    user = User(
        email         = body.email.lower().strip(),
        password_hash = pwd_ctx.hash(body.password),
        first_name    = body.first_name.strip(),
        last_name     = body.last_name.strip(),
        date_of_birth = dob,
        setup_complete= False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _token_response(user)


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower().strip()).first()
    # Constant-time compare to avoid timing attacks
    if not user or not pwd_ctx.verify(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    user.last_login = datetime.utcnow()
    db.commit()
    return _token_response(user)


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    return _user_dict(current_user)


@router.put("/me")
def update_me(
    body: ProfileUpdateBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.first_name is not None:
        current_user.first_name = body.first_name.strip()
    if body.last_name is not None:
        current_user.last_name = body.last_name.strip()
    if body.date_of_birth is not None:
        try:
            current_user.date_of_birth = date.fromisoformat(body.date_of_birth) if body.date_of_birth else None
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    if body.company_name is not None:
        current_user.company_name = body.company_name or None
    if body.employer_sector is not None:
        current_user.employer_sector = body.employer_sector or None
    if body.annual_income is not None:
        current_user.annual_income = body.annual_income
    if body.monthly_investable is not None:
        current_user.monthly_investable = body.monthly_investable
    if body.experience_level is not None:
        current_user.experience_level = body.experience_level or None
    if body.time_horizon is not None:
        current_user.time_horizon = body.time_horizon or None
    if body.risk_tolerance is not None:
        current_user.risk_tolerance = body.risk_tolerance
    if body.country is not None:
        current_user.country = body.country or None
    if body.investing_goals is not None:
        current_user.investing_goals = json.dumps(body.investing_goals)
    if body.net_worth_outside is not None:
        current_user.net_worth_outside = body.net_worth_outside
    if body.retirement_target_age is not None:
        current_user.retirement_target_age = body.retirement_target_age
    if body.sectors_to_avoid is not None:
        current_user.sectors_to_avoid = json.dumps(body.sectors_to_avoid)
    if body.has_dependents is not None:
        current_user.has_dependents = body.has_dependents
    if body.anthropic_api_key is not None:
        current_user.anthropic_api_key = body.anthropic_api_key.strip() or None
    if body.setup_complete is not None:
        current_user.setup_complete = body.setup_complete

    db.commit()
    db.refresh(current_user)
    return _user_dict(current_user)
