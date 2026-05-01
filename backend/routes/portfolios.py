from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
from database import get_db
from models import Portfolio, Holding, Transaction, PortfolioSnapshot, PriceSnapshot, AssetType, User
from routes.auth import get_current_user
import price_poller

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


class PortfolioCreate(BaseModel):
    name: str
    account_type: str = "brokerage"
    company_name: Optional[str] = None
    employer_status: Optional[str] = None


class PortfolioUpdate(BaseModel):
    name: str
    cash_balance: Optional[float] = None


class HoldingCreate(BaseModel):
    symbol: str
    name: str
    asset_type: str = "stock"
    quantity: float
    buy_price: float
    purchased_at: Optional[datetime] = None


class TransactionCreate(BaseModel):
    quantity: float
    buy_price: float
    purchased_at: Optional[datetime] = None


class SellRequest(BaseModel):
    quantity: float
    sell_price: float


def holding_to_dict(holding: Holding, prices: dict) -> dict:
    price = prices.get(holding.symbol, 0)
    prev_close = price_poller.previous_closes.get(holding.symbol)

    transactions = [
        {
            "id": t.id,
            "quantity": t.quantity,
            "buy_price": t.buy_price,
            "purchased_at": t.purchased_at.isoformat(),
        }
        for t in holding.transactions
    ]
    total_qty = sum(t.quantity for t in holding.transactions)
    total_cost = sum(t.quantity * t.buy_price for t in holding.transactions)
    avg_cost = total_cost / total_qty if total_qty else 0
    current_value = price * total_qty
    gain_loss = current_value - total_cost
    gain_loss_pct = (gain_loss / total_cost * 100) if total_cost else 0

    # Day change
    if prev_close and prev_close > 0 and price > 0:
        day_change = price - prev_close
        day_change_pct = (day_change / prev_close) * 100
        day_change_value = day_change * total_qty
    else:
        day_change = 0.0
        day_change_pct = 0.0
        day_change_value = 0.0

    return {
        "id": holding.id,
        "symbol": holding.symbol,
        "name": holding.name,
        "asset_type": holding.asset_type,
        "transactions": transactions,
        "total_quantity": total_qty,
        "avg_cost": avg_cost,
        "current_price": price,
        "current_value": current_value,
        "total_cost": total_cost,
        "gain_loss": gain_loss,
        "gain_loss_pct": gain_loss_pct,
        "day_change": day_change,
        "day_change_pct": day_change_pct,
        "day_change_value": day_change_value,
    }


def portfolio_to_dict(portfolio: Portfolio, prices: dict) -> dict:
    holdings = [holding_to_dict(h, prices) for h in portfolio.holdings]
    total_value = portfolio.cash_balance + sum(h["current_value"] for h in holdings)
    total_cost = sum(h["total_cost"] for h in holdings)
    total_gain_loss = total_value - total_cost - portfolio.cash_balance
    total_gain_loss_pct = (total_gain_loss / total_cost * 100) if total_cost else 0

    return {
        "id": portfolio.id,
        "name": portfolio.name,
        "account_type": portfolio.account_type or "brokerage",
        "company_name": portfolio.company_name,
        "employer_status": portfolio.employer_status,
        "cash_balance": portfolio.cash_balance,
        "holdings": holdings,
        "total_value": total_value,
        "total_cost": total_cost,
        "total_gain_loss": total_gain_loss,
        "total_gain_loss_pct": total_gain_loss_pct,
        "created_at": portfolio.created_at.isoformat(),
    }


def _own(db: Session, portfolio_id: int, user_id: int) -> Portfolio:
    p = db.query(Portfolio).filter(Portfolio.id == portfolio_id, Portfolio.user_id == user_id).first()
    if not p:
        raise HTTPException(404, "Portfolio not found")
    return p


@router.get("/")
def list_portfolios(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
    prices = price_poller.latest_prices
    return [portfolio_to_dict(p, prices) for p in portfolios]


@router.get("/total-history")
def get_total_history(
    period: str = "1M",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregate history across current user's portfolios, summed per timestamp."""
    now = datetime.utcnow()
    period_map = {
        "1D": timedelta(days=1),
        "1M": timedelta(days=30),
        "3M": timedelta(days=90),
        "6M": timedelta(days=180),
        "1Y": timedelta(days=365),
        "ALL": timedelta(days=3650),
    }
    delta = period_map.get(period, timedelta(days=30))
    since = now - delta

    from sqlalchemy import func
    user_portfolio_ids = [
        p.id for p in db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
    ]
    if not user_portfolio_ids:
        return []

    rows = (
        db.query(
            PortfolioSnapshot.recorded_at,
            func.sum(PortfolioSnapshot.total_value).label("total"),
        )
        .filter(
            PortfolioSnapshot.portfolio_id.in_(user_portfolio_ids),
            PortfolioSnapshot.recorded_at >= since,
        )
        .group_by(PortfolioSnapshot.recorded_at)
        .order_by(PortfolioSnapshot.recorded_at)
        .all()
    )

    return [{"timestamp": r.recorded_at.isoformat(), "value": r.total} for r in rows]


@router.post("/")
def create_portfolio(
    body: PortfolioCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = Portfolio(
        user_id=current_user.id,
        name=body.name,
        account_type=body.account_type,
        company_name=body.company_name,
        employer_status=body.employer_status,
        cash_balance=0.0,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return portfolio_to_dict(p, {})


@router.get("/{portfolio_id}")
def get_portfolio(
    portfolio_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = _own(db, portfolio_id, current_user.id)
    return portfolio_to_dict(p, price_poller.latest_prices)


@router.put("/{portfolio_id}")
def update_portfolio(
    portfolio_id: int,
    body: PortfolioUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = _own(db, portfolio_id, current_user.id)
    p.name = body.name
    if body.cash_balance is not None:
        p.cash_balance = body.cash_balance
    db.commit()
    db.refresh(p)
    return portfolio_to_dict(p, price_poller.latest_prices)


@router.delete("/{portfolio_id}")
def delete_portfolio(
    portfolio_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = _own(db, portfolio_id, current_user.id)
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.post("/{portfolio_id}/holdings")
async def add_holding(
    portfolio_id: int,
    body: HoldingCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = _own(db, portfolio_id, current_user.id)

    # Find or create holding for this symbol
    holding = next((h for h in p.holdings if h.symbol == body.symbol), None)
    if not holding:
        holding = Holding(
            portfolio_id=portfolio_id,
            symbol=body.symbol,
            name=body.name,
            asset_type=body.asset_type,
        )
        db.add(holding)
        db.flush()

    tx = Transaction(
        holding_id=holding.id,
        quantity=body.quantity,
        buy_price=body.buy_price,
        purchased_at=body.purchased_at or datetime.utcnow(),
    )
    db.add(tx)

    # Deduct purchase cost from cash balance (mirrors sell adding cash)
    p.cash_balance -= body.quantity * body.buy_price

    db.commit()

    # Fetch price if not cached
    if body.symbol not in price_poller.latest_prices:
        await price_poller.fetch_initial_prices([body.symbol], {body.symbol: body.asset_type})

    db.refresh(p)
    return portfolio_to_dict(p, price_poller.latest_prices)


@router.post("/{portfolio_id}/holdings/{holding_id}/transactions")
async def add_transaction(
    portfolio_id: int, holding_id: int, body: TransactionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    p = _own(db, portfolio_id, current_user.id)
    holding = db.query(Holding).filter(
        Holding.id == holding_id, Holding.portfolio_id == portfolio_id
    ).first()
    if not holding:
        raise HTTPException(404, "Holding not found")

    tx = Transaction(
        holding_id=holding_id,
        quantity=body.quantity,
        buy_price=body.buy_price,
        purchased_at=body.purchased_at or datetime.utcnow(),
    )
    db.add(tx)

    p.cash_balance -= body.quantity * body.buy_price

    db.commit()
    return portfolio_to_dict(p, price_poller.latest_prices)


@router.post("/{portfolio_id}/holdings/{holding_id}/sell")
def sell_holding(
    portfolio_id: int, holding_id: int, body: SellRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _own(db, portfolio_id, current_user.id)
    holding = db.query(Holding).filter(
        Holding.id == holding_id, Holding.portfolio_id == portfolio_id
    ).first()
    if not holding:
        raise HTTPException(404, "Holding not found")

    total_qty = sum(t.quantity for t in holding.transactions)
    if body.quantity <= 0 or body.quantity > total_qty + 1e-9:
        raise HTTPException(400, f"Cannot sell {body.quantity} shares — only {total_qty} held")

    proceeds = body.quantity * body.sell_price

    # FIFO: reduce from oldest transactions first
    remaining = body.quantity
    for tx in sorted(holding.transactions, key=lambda t: t.purchased_at):
        if remaining <= 0:
            break
        if tx.quantity <= remaining + 1e-9:
            remaining -= tx.quantity
            db.delete(tx)
        else:
            tx.quantity -= remaining
            remaining = 0

    db.flush()

    # If no transactions remain, remove the holding
    db.refresh(holding)
    if not holding.transactions:
        db.delete(holding)

    # Add proceeds to portfolio cash
    portfolio = db.query(Portfolio).filter(
        Portfolio.id == portfolio_id, Portfolio.user_id == current_user.id
    ).first()
    portfolio.cash_balance += proceeds

    db.commit()
    db.refresh(portfolio)
    return portfolio_to_dict(portfolio, price_poller.latest_prices)


@router.delete("/{portfolio_id}/holdings/{holding_id}")
def delete_holding(
    portfolio_id: int, holding_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _own(db, portfolio_id, current_user.id)
    portfolio = db.query(Portfolio).filter(
        Portfolio.id == portfolio_id, Portfolio.user_id == current_user.id
    ).first()
    holding = db.query(Holding).filter(
        Holding.id == holding_id, Holding.portfolio_id == portfolio_id
    ).first()
    if not holding:
        raise HTTPException(404, "Holding not found")
    # Return cost basis to cash (mirrors the deduction made when buying)
    cost_basis = sum(tx.quantity * tx.buy_price for tx in holding.transactions)
    portfolio.cash_balance += cost_basis
    db.delete(holding)
    db.commit()
    db.refresh(portfolio)
    return portfolio_to_dict(portfolio, price_poller.latest_prices)


@router.delete("/{portfolio_id}/holdings/{holding_id}/transactions/{tx_id}")
def delete_transaction(
    portfolio_id: int, holding_id: int, tx_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _own(db, portfolio_id, current_user.id)
    portfolio = db.query(Portfolio).filter(
        Portfolio.id == portfolio_id, Portfolio.user_id == current_user.id
    ).first()
    tx = db.query(Transaction).filter(Transaction.id == tx_id, Transaction.holding_id == holding_id).first()
    if not tx:
        raise HTTPException(404, "Transaction not found")
    # Return this lot's cost to cash
    portfolio.cash_balance += tx.quantity * tx.buy_price
    db.delete(tx)
    holding = db.query(Holding).filter(Holding.id == holding_id).first()
    if holding and not holding.transactions:
        db.delete(holding)
    db.commit()
    db.refresh(portfolio)
    return portfolio_to_dict(portfolio, price_poller.latest_prices)


@router.get("/{portfolio_id}/history")
def get_portfolio_history(
    portfolio_id: int, period: str = "1M",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _own(db, portfolio_id, current_user.id)
    now = datetime.utcnow()
    period_map = {
        "1D": timedelta(days=1),
        "1M": timedelta(days=30),
        "3M": timedelta(days=90),
        "6M": timedelta(days=180),
        "1Y": timedelta(days=365),
        "ALL": timedelta(days=3650),
    }
    delta = period_map.get(period, timedelta(days=30))
    since = now - delta

    snapshots = (
        db.query(PortfolioSnapshot)
        .filter(
            PortfolioSnapshot.portfolio_id == portfolio_id,
            PortfolioSnapshot.recorded_at >= since,
        )
        .order_by(PortfolioSnapshot.recorded_at)
        .all()
    )

    return [
        {"timestamp": s.recorded_at.isoformat(), "value": s.total_value}
        for s in snapshots
    ]
