from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
import anthropic
import os

from database import get_db
from models import Portfolio, Holding, Transaction, RealEstate

router = APIRouter()


class AdvisorRequest(BaseModel):
    question: Optional[str] = None


def build_portfolio_context(db: Session) -> str:
    portfolios = db.query(Portfolio).all()
    real_estate = db.query(RealEstate).all()

    lines = []

    # Net wealth summary
    from price_poller import latest_prices, previous_closes

    total_invested = 0.0
    total_cash = 0.0
    total_cost = 0.0
    total_gain = 0.0

    for p in portfolios:
        total_cash += p.cash_balance
        for h in p.holdings:
            total_qty = sum(t.quantity for t in h.transactions)
            avg_cost = (sum(t.quantity * t.buy_price for t in h.transactions) / total_qty) if total_qty else 0
            price = latest_prices.get(h.symbol, 0)
            value = price * total_qty
            cost = avg_cost * total_qty
            total_invested += value
            total_cost += cost
            total_gain += value - cost

    total_portfolio = total_invested + total_cash
    total_re_equity = sum(re.estimated_value * (re.ownership_pct / 100) for re in real_estate)
    net_wealth = total_portfolio + total_re_equity

    lines.append(f"## Net Wealth: ${net_wealth:,.0f}")
    lines.append(f"- Stocks & Crypto (market value): ${total_invested:,.0f}")
    lines.append(f"- Cash (across all portfolios): ${total_cash:,.0f}")
    lines.append(f"- Real Estate Equity: ${total_re_equity:,.0f}")
    lines.append(f"- Total Invested Cost Basis: ${total_cost:,.0f}")
    lines.append(f"- Unrealized Gain/Loss: ${total_gain:+,.0f} ({(total_gain/total_cost*100):+.1f}% overall)" if total_cost else "")
    lines.append("")

    # Portfolios
    for p in portfolios:
        p_value = p.cash_balance
        p_cost = 0.0
        holding_lines = []
        for h in p.holdings:
            total_qty = sum(t.quantity for t in h.transactions)
            avg_cost = (sum(t.quantity * t.buy_price for t in h.transactions) / total_qty) if total_qty else 0
            price = latest_prices.get(h.symbol, 0)
            prev = previous_closes.get(h.symbol, 0)
            value = price * total_qty
            cost = avg_cost * total_qty
            gain = value - cost
            gain_pct = (gain / cost * 100) if cost else 0
            day_chg_pct = ((price - prev) / prev * 100) if prev else 0
            p_value += value
            p_cost += cost
            holding_lines.append(
                f"  - {h.symbol} ({h.asset_type}): {total_qty:.4g} shares @ avg ${avg_cost:.2f} | "
                f"Current ${price:.2f} | Value ${value:,.0f} | "
                f"Gain ${gain:+,.0f} ({gain_pct:+.1f}%) | Today {day_chg_pct:+.1f}%"
            )
        p_gain = p_value - p_cost - p.cash_balance
        lines.append(f"### Portfolio: {p.name}")
        lines.append(f"Total Value: ${p_value:,.0f} | Cash: ${p.cash_balance:,.0f} | Gain: ${p_gain:+,.0f}")
        lines.extend(holding_lines)
        lines.append("")

    # Real estate
    if real_estate:
        lines.append("### Real Estate")
        for re in real_estate:
            equity = re.estimated_value * (re.ownership_pct / 100)
            lines.append(
                f"  - {re.address}: Value ${re.estimated_value:,.0f} | "
                f"Owned {re.ownership_pct}% | Equity ${equity:,.0f}"
            )
        lines.append("")

    return "\n".join(lines)


@router.post("/advisor")
def ask_advisor(
    req: AdvisorRequest,
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"response": "⚠️ No Anthropic API key found. Open the profile settings (top-right) and paste your key."}

    context = build_portfolio_context(db)
    question = req.question or (
        "Give me concise proactive financial advice based on my portfolio. Cover:\n"
        "1. Concentration risks or over-exposure\n"
        "2. Top performers and underperformers to watch\n"
        "3. Cash deployment opportunities\n"
        "4. Overall portfolio health score (1-10) with reasoning\n"
        "Be specific with ticker names and numbers."
    )

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1200,
        system=(
            "You are a sharp, direct personal financial advisor. "
            "You have the user's complete net worth picture below. "
            "Be specific — use exact ticker symbols, dollar amounts, and percentages. "
            "Format with markdown. Keep it tight and actionable. No disclaimers."
        ),
        messages=[{"role": "user", "content": f"MY PORTFOLIO DATA:\n{context}\n\nQUESTION: {question}"}],
    )

    return {"response": message.content[0].text}
