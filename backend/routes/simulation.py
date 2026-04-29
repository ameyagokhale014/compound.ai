"""
Popi Simulation route — compound.ai

Popi acts as a portfolio manager over a fully virtual/simulated account.
Completely isolated from the user's real portfolio and net-wealth figures.

Endpoints:
  GET    /simulation/          — current simulation state (or null)
  POST   /simulation/          — create / restart simulation
  DELETE /simulation/          — reset
  POST   /simulation/trade     — Popi evaluates & executes rebalancing trades
  POST   /simulation/contribute — add a cash contribution; Popi deploys it
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Optional

import anthropic
import yfinance as yf
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import SimGoal, SimHolding, SimPortfolio, SimTrade, User
from routes.auth import get_current_user
import price_poller

router = APIRouter(prefix="/simulation", tags=["simulation"])


# ── Price helper ───────────────────────────────────────────────────────────────

def _live_price(symbol: str) -> float:
    p = price_poller.latest_prices.get(symbol)
    if p:
        return p
    try:
        info = yf.Ticker(symbol).fast_info
        return float(info.last_price or 0)
    except Exception:
        try:
            info = yf.Ticker(symbol).info
            return float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
        except Exception:
            return 0.0


# ── Format helpers ─────────────────────────────────────────────────────────────

def _format_state(sim: SimPortfolio) -> dict:
    holdings_out = []
    total_invested = 0.0
    total_cost_all = 0.0

    for h in sim.holdings:
        price = _live_price(h.symbol)
        if price == 0:
            price = h.avg_cost  # fallback to cost
        cv   = price * h.quantity
        cost = h.avg_cost * h.quantity
        gl   = cv - cost
        glp  = (gl / cost * 100) if cost > 0 else 0.0
        total_invested  += cv
        total_cost_all  += cost
        holdings_out.append({
            "symbol":        h.symbol,
            "name":          h.name,
            "quantity":      h.quantity,
            "avg_cost":      h.avg_cost,
            "current_price": price,
            "current_value": cv,
            "total_cost":    cost,
            "gain_loss":     gl,
            "gain_loss_pct": glp,
            "target_pct":    h.target_pct,
            "rationale":     h.rationale,
            "asset_class":   h.asset_class,
        })

    total_value = total_invested + sim.cash_balance
    total_deployed = sim.principal + sim.total_contributed
    overall_gl  = total_value - total_deployed
    overall_glp = (overall_gl / total_deployed * 100) if total_deployed > 0 else 0.0

    # Benchmark comparison (SPY)
    bench_return_pct = None
    if sim.benchmark_start_price and sim.benchmark_start_price > 0:
        spy_now = _live_price("SPY")
        if spy_now > 0:
            bench_return_pct = (spy_now - sim.benchmark_start_price) / sim.benchmark_start_price * 100

    trades_out = []
    for t in sorted(sim.trades, key=lambda x: x.executed_at, reverse=True)[:30]:
        trades_out.append({
            "symbol":      t.symbol,
            "action":      t.action,
            "quantity":    t.quantity,
            "price":       t.price,
            "amount":      t.amount,
            "reason":      t.reason,
            "executed_at": t.executed_at.isoformat(),
        })

    goals_out = [
        {"id": g.id, "name": g.name, "amount": g.amount, "years": g.years, "priority": g.priority}
        for g in sim.goals
    ]

    plan = json.loads(sim.popi_plan) if sim.popi_plan else None

    return {
        "id":                sim.id,
        "principal":         sim.principal,
        "total_contributed": sim.total_contributed,
        "cash_balance":      sim.cash_balance,
        "total_value":       total_value,
        "total_invested":    total_invested,
        "monthly_salary":    sim.monthly_salary,
        "risk_appetite":     sim.risk_appetite,
        "plan":              plan,
        "goals":             goals_out,
        "holdings":          holdings_out,
        "trades":            trades_out,
        "gain_loss":         overall_gl,
        "gain_loss_pct":     overall_glp,
        "bench_return_pct":  bench_return_pct,
        "created_at":        sim.created_at.isoformat(),
        "last_traded":       sim.last_traded.isoformat() if sim.last_traded else None,
    }


# ── Claude helpers ─────────────────────────────────────────────────────────────

def _initial_plan_prompt(principal: float, salary: float | None,
                          contribution: float | None,
                          risk: str, goals: list[dict]) -> str:
    risk_guide = {
        "conservative":   "60% stable ETFs/bonds, 25% blue-chip dividend stocks, 15% cash",
        "moderate":       "50% diversified ETFs, 30% growth stocks, 15% blue-chip, 5% cash",
        "aggressive":     "40% growth/tech stocks, 35% broad ETFs, 15% small-cap, 10% international",
        "very_aggressive":"50% high-growth individual stocks, 30% sector ETFs, 15% speculative, 5% cash",
    }
    goals_text = "\n".join(
        f"  • {g['name']}: ${g['amount']:,.0f} needed in {g['years']:.1f} years (priority {g['priority']})"
        for g in goals
    ) or "  • No specific goals — grow wealth according to risk appetite"

    contrib_line = ""
    if contribution and contribution > 0:
        contrib_line = f"  Monthly contribution committed: ${contribution:,.0f}/mo\n"
    elif salary:
        contrib_line = f"  (No fixed monthly contribution specified — suggest an amount based on goals)\n"

    return (
        f"You are Popi, a skilled portfolio manager. Build a complete investment plan.\n\n"
        f"Client Profile:\n"
        f"  Principal to invest: ${principal:,.0f}\n"
        f"  Monthly salary: {'$' + f'{salary:,.0f}' if salary else 'Not provided'}\n"
        f"{contrib_line}"
        f"  Risk appetite: {risk} — {risk_guide.get(risk, risk)}\n\n"
        f"Goals:\n{goals_text}\n\n"
        f"Instructions:\n"
        f"- Pick 6–10 real, tradeable symbols (stocks + ETFs). Use actual tickers like VTI, AAPL, MSFT.\n"
        f"- Allocations must sum to 100% including cash_reserve_pct.\n"
        f"- Weight short-term goals (< 3 years) toward stable assets.\n"
        f"- Weight long-term goals toward growth.\n"
        f"- Be specific and direct — cite real reasons for each pick.\n\n"
        f"Return ONLY valid JSON (no markdown, no text outside JSON):\n"
        f"{{\n"
        f'  "strategy_summary": "<2-3 sentence strategy overview>",\n'
        f'  "popi_message": "<warm personal message to the client about this plan>",\n'
        f'  "monthly_contribution_needed": <number — monthly $ needed to hit all goals>,\n'
        f'  "projected_value_3yr": <estimated portfolio value in 3 years>,\n'
        f'  "projected_value_5yr": <estimated portfolio value in 5 years>,\n'
        f'  "projected_value_10yr": <estimated portfolio value in 10 years>,\n'
        f'  "goal_analysis": [\n'
        f'    {{"goal_name": "...", "amount": 0, "years": 0, '
        f'"feasibility": "achievable|challenging|unlikely", '
        f'"note": "<direct honest note>", "suggested_allocation_usd": 0}}\n'
        f'  ],\n'
        f'  "holdings": [\n'
        f'    {{"symbol": "VTI", "name": "Vanguard Total Stock Market ETF", '
        f'"allocation_pct": 20, "rationale": "...", "asset_class": "etf"}}\n'
        f'  ],\n'
        f'  "cash_reserve_pct": <5-10>,\n'
        f'  "rebalance_frequency": "monthly|quarterly",\n'
        f'  "key_risks": "<main risks in this plan>"\n'
        f"}}"
    )


def _rebalance_prompt(state: dict) -> str:
    holdings_lines = []
    total_val = state["total_value"]
    for h in state["holdings"]:
        actual_pct = (h["current_value"] / total_val * 100) if total_val > 0 else 0
        drift = actual_pct - (h["target_pct"] or actual_pct)
        holdings_lines.append(
            f"  • {h['symbol']} ({h['name']}): {h['quantity']:.3f} shares, "
            f"avg ${h['avg_cost']:.2f} → now ${h['current_price']:.2f} | "
            f"P&L {h['gain_loss_pct']:+.1f}% | "
            f"target {h['target_pct'] or '?'}% → actual {actual_pct:.1f}% (drift {drift:+.1f}%)"
        )
    goals_lines = [
        f"  • {g['name']}: ${g['amount']:,.0f} in {g['years']} years"
        for g in state["goals"]
    ]
    plan = state.get("plan") or {}

    return (
        f"You are Popi, reviewing a simulated portfolio for rebalancing.\n\n"
        f"Portfolio Summary:\n"
        f"  Total Value: ${state['total_value']:,.2f}\n"
        f"  Cash: ${state['cash_balance']:,.2f} ({state['cash_balance'] / state['total_value'] * 100:.1f}%)\n"
        f"  Overall P&L: {state['gain_loss_pct']:+.1f}% (${state['gain_loss']:+,.2f})\n"
        f"  Risk appetite: {state['risk_appetite']}\n\n"
        f"Holdings:\n" + "\n".join(holdings_lines) + "\n\n"
        f"Goals:\n" + ("\n".join(goals_lines) or "  No goals set") + "\n\n"
        f"Target rebalance frequency: {plan.get('rebalance_frequency', 'monthly')}\n\n"
        f"Decide: should any trades happen today?\n"
        f"Return ONLY valid JSON:\n"
        f"{{\n"
        f'  "should_rebalance": true | false,\n'
        f'  "popi_comment": "<direct personal update to client — what you see, what you\'re doing>",\n'
        f'  "trades": [\n'
        f'    {{"symbol": "...", "action": "buy"|"sell", "amount_usd": 0, "reason": "..."}}\n'
        f'  ]\n'
        f"}}"
    )


def _suggest_prompt(state: dict, user_message: str) -> str:
    """Prompt for user-directed suggestion flow — Popi proposes, does NOT execute."""
    total_val = state["total_value"]
    holdings_lines = [
        f"  • {h['symbol']} ({h['name']}): ${h['current_value']:,.0f} "
        f"({h['current_value']/total_val*100:.1f}%) — {h['asset_class'] or 'stock'} "
        f"| P&L {h['gain_loss_pct']:+.1f}%"
        for h in state["holdings"]
    ]
    goals_lines = [
        f"  • {g['name']}: ${g['amount']:,.0f} in {g['years']} years"
        for g in state["goals"]
    ]
    return (
        f"You are Popi, a portfolio manager. Your client has a portfolio change request.\n\n"
        f"Current Portfolio:\n"
        f"  Total Value: ${total_val:,.0f} | Cash: ${state['cash_balance']:,.0f} "
        f"({state['cash_balance']/total_val*100:.1f}%)\n"
        f"  Risk Appetite: {state['risk_appetite']}\n\n"
        f"Holdings:\n" + "\n".join(holdings_lines) + "\n\n"
        f"Goals:\n" + ("\n".join(goals_lines) or "  None") + "\n\n"
        f"Client request: \"{user_message}\"\n\n"
        f"Your job: propose specific trades that address this request. Be direct and honest.\n"
        f"IMPORTANT RULES:\n"
        f"- Do NOT execute anything — this is a proposal the client must approve\n"
        f"- Only propose trades that are appropriate and feasible given available cash/holdings\n"
        f"- If the request conflicts with their goals or risk profile, say so in popi_comment\n"
        f"- If no trades are needed (e.g. request already satisfied), set no_change_needed=true\n"
        f"- Keep proposed_trades to 1–5 trades max\n"
        f"- amount_usd must not exceed available cash for buys, or holding value for sells\n\n"
        f"Return ONLY valid JSON:\n"
        f"{{\n"
        f'  "popi_comment": "<conversational response to the client — explain your thinking, '
        f'any concerns, and what you\'re proposing>",\n'
        f'  "proposed_trades": [\n'
        f'    {{"symbol": "NVDA", "action": "buy"|"sell", "amount_usd": 5000, '
        f'"reason": "<one-sentence justification>"}}\n'
        f"  ],\n"
        f'  "no_change_needed": false\n'
        f"}}"
    )


def _contribute_prompt(state: dict, contribution: float) -> str:
    return (
        f"You are Popi. A client just added ${contribution:,.0f} to their portfolio.\n\n"
        f"Current portfolio value: ${state['total_value']:,.2f}\n"
        f"Cash on hand (before contribution): ${state['cash_balance']:,.2f}\n"
        f"Risk appetite: {state['risk_appetite']}\n\n"
        f"Holdings:\n"
        + "\n".join(
            f"  • {h['symbol']}: {h['current_value']:,.0f} ({h['current_value']/state['total_value']*100:.1f}%)"
            for h in state["holdings"]
        )
        + f"\n\nGoals:\n"
        + "\n".join(f"  • {g['name']}: ${g['amount']:,.0f} in {g['years']} years" for g in state["goals"])
        + f"\n\nDecide where to deploy the ${contribution:,.0f} contribution.\n"
        f"Return ONLY valid JSON:\n"
        f"{{\n"
        f'  "popi_comment": "<personal message about how you\'re deploying this money>",\n'
        f'  "trades": [\n'
        f'    {{"symbol": "...", "action": "buy", "amount_usd": 0, "reason": "..."}}\n'
        f'  ]\n'
        f"}}"
    )


def _extract_json(text: str) -> dict:
    """
    Robustly extract the first complete JSON object from a Claude response.
    Handles markdown fences, leading prose, and truncated responses.
    """
    text = text.strip()

    # Strip markdown code fences (``` or ```json ... ```)
    if text.startswith("```"):
        inner = text.split("```")
        # Pick the first non-empty segment after the opening fence
        for seg in inner[1:]:
            seg = seg.lstrip("json").strip()
            if seg:
                text = seg
                break

    text = text.strip()

    # Fast path: well-formed JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Slow path: find the outermost balanced { ... } and parse that.
    # This recovers from leading prose or trailing text after the object.
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in response")

    depth = 0
    in_str = False
    esc = False
    for i, ch in enumerate(text[start:], start):
        if esc:
            esc = False
            continue
        if ch == "\\" and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])

    raise ValueError("Incomplete JSON object — response was likely truncated")


def _call_claude(prompt: str, api_key: str, max_tokens: int = 1200) -> dict | None:
    try:
        client  = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        return _extract_json(raw)
    except anthropic.AuthenticationError:
        return {"__error__": "invalid_api_key"}
    except anthropic.RateLimitError:
        return {"__error__": "rate_limit"}
    except anthropic.APIConnectionError:
        return {"__error__": "connection_error"}
    except (json.JSONDecodeError, ValueError) as e:
        return {"__error__": f"json_parse:{str(e)[:120]}"}
    except Exception as e:
        return {"__error__": str(e)[:200]}


def _execute_trades(sim: SimPortfolio, trades: list[dict], reason_prefix: str, db: Session):
    """Execute virtual buy/sell trades on the simulation."""
    now = datetime.utcnow()
    for t in trades:
        symbol   = t.get("symbol", "").upper()
        action   = t.get("action", "buy").lower()
        amt_usd  = float(t.get("amount_usd", 0))
        reason   = t.get("reason", "")
        if not symbol or amt_usd <= 0:
            continue

        price = _live_price(symbol)
        if price <= 0:
            continue

        if action == "buy":
            if sim.cash_balance < amt_usd:
                amt_usd = sim.cash_balance  # can't buy more than available
            if amt_usd < 1:
                continue
            qty = amt_usd / price
            sim.cash_balance -= amt_usd

            # Update or create holding
            holding = next((h for h in sim.holdings if h.symbol == symbol), None)
            if holding:
                new_qty  = holding.quantity + qty
                new_cost = (holding.avg_cost * holding.quantity + price * qty) / new_qty
                holding.quantity = new_qty
                holding.avg_cost = new_cost
            else:
                # Fetch name
                try:
                    info = yf.Ticker(symbol).info
                    name = info.get("longName") or info.get("shortName") or symbol
                except Exception:
                    name = symbol
                holding = SimHolding(
                    sim_id=sim.id, symbol=symbol, name=name,
                    quantity=qty, avg_cost=price,
                )
                db.add(holding)
                sim.holdings.append(holding)

        elif action == "sell":
            holding = next((h for h in sim.holdings if h.symbol == symbol), None)
            if not holding:
                continue
            qty = min(amt_usd / price, holding.quantity)
            proceeds = qty * price
            holding.quantity -= qty
            sim.cash_balance += proceeds
            if holding.quantity < 0.0001:
                db.delete(holding)
                sim.holdings.remove(holding)

        db.add(SimTrade(
            sim_id=sim.id, symbol=symbol, action=action,
            quantity=qty if action == "buy" else qty,
            price=price, amount=amt_usd,
            reason=f"{reason_prefix}: {reason}",
            executed_at=now,
        ))

    sim.last_traded = now
    db.commit()


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/")
def get_simulation(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sim = db.query(SimPortfolio).filter(SimPortfolio.user_id == current_user.id).first()
    if not sim:
        return None
    return _format_state(sim)


class GoalIn(BaseModel):
    name:     str
    amount:   float
    years:    float
    priority: int = 1


class SimCreateBody(BaseModel):
    principal:             float
    monthly_salary:        Optional[float] = None
    monthly_contribution:  Optional[float] = None   # what the user can actually add each month
    risk_appetite:         str = "moderate"
    goals:                 list[GoalIn] = []


@router.post("/")
def create_simulation(
    body: SimCreateBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"error": "No Anthropic API key — add it in profile settings."}

    # --- Delete any existing simulation for this user ---
    for sim in db.query(SimPortfolio).filter(SimPortfolio.user_id == current_user.id).all():
        db.delete(sim)
    db.commit()

    # --- Build Popi's plan ---
    prompt = _initial_plan_prompt(
        body.principal,
        body.monthly_salary,
        body.monthly_contribution,
        body.risk_appetite,
        [g.dict() for g in body.goals],
    )
    plan = _call_claude(prompt, api_key, max_tokens=3500)
    if not plan:
        return {"error": "Popi could not build a plan. Check your API key and try again."}
    if "__error__" in plan:
        err = plan["__error__"]
        if err == "invalid_api_key":
            return {"error": "Invalid API key. Please update your Anthropic API key in Profile Settings (top-right corner)."}
        elif err == "rate_limit":
            return {"error": "API rate limit reached. Please wait a moment and try again."}
        elif err == "connection_error":
            return {"error": "Could not reach Anthropic. Check your internet connection and try again."}
        else:
            return {"error": f"Popi encountered an error: {err}"}

    # --- Get SPY benchmark price ---
    spy_price = _live_price("SPY")

    # --- Create SimPortfolio ---
    sim = SimPortfolio(
        user_id=current_user.id,
        principal=body.principal,
        cash_balance=body.principal,   # start with full cash; buys will reduce it
        total_contributed=0.0,
        monthly_salary=body.monthly_salary,
        risk_appetite=body.risk_appetite,
        popi_plan=json.dumps(plan),
        benchmark_start_price=spy_price if spy_price > 0 else None,
    )
    db.add(sim)
    db.flush()  # get sim.id

    # --- Goals ---
    for i, g in enumerate(body.goals):
        db.add(SimGoal(
            sim_id=sim.id,
            name=g.name, amount=g.amount, years=g.years, priority=g.priority,
        ))

    db.commit()
    db.refresh(sim)

    # --- Execute initial buys ---
    cash_reserve_pct = float(plan.get("cash_reserve_pct", 5))
    invest_amount    = body.principal * (1 - cash_reserve_pct / 100)
    initial_trades   = []
    for h in plan.get("holdings", []):
        alloc_pct = float(h.get("allocation_pct", 0))
        amount_usd = body.principal * alloc_pct / 100
        if amount_usd < 1:
            continue
        initial_trades.append({
            "symbol":     h["symbol"].upper(),
            "action":     "buy",
            "amount_usd": amount_usd,
            "reason":     h.get("rationale", "Initial allocation per Popi's plan"),
        })
        # Attach target_pct to holding after buy
    _execute_trades(sim, initial_trades, "Initial allocation", db)

    # --- Set target_pct and rationale on created holdings ---
    plan_map = {h["symbol"].upper(): h for h in plan.get("holdings", [])}
    for holding in sim.holdings:
        ph = plan_map.get(holding.symbol)
        if ph:
            holding.target_pct = ph.get("allocation_pct")
            holding.rationale  = ph.get("rationale")
            holding.asset_class = ph.get("asset_class")
    db.commit()

    db.refresh(sim)
    return _format_state(sim)


@router.delete("/")
def reset_simulation(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for sim in db.query(SimPortfolio).filter(SimPortfolio.user_id == current_user.id).all():
        db.delete(sim)
    db.commit()
    return {"ok": True}


@router.post("/trade")
def popi_trade(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    """Popi evaluates the portfolio and decides if rebalancing is needed."""
    api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"error": "No Anthropic API key."}

    sim = db.query(SimPortfolio).filter(SimPortfolio.user_id == current_user.id).first()
    if not sim:
        return {"error": "No simulation found."}

    state  = _format_state(sim)
    prompt = _rebalance_prompt(state)
    result = _call_claude(prompt, api_key, max_tokens=1000)

    if not result:
        return {"error": "Popi could not evaluate the portfolio right now."}

    popi_comment = result.get("popi_comment", "")
    trades_done  = []

    if result.get("should_rebalance") and result.get("trades"):
        _execute_trades(sim, result["trades"], "Popi rebalance", db)
        trades_done = result["trades"]

    db.refresh(sim)
    return {
        "popi_comment":    popi_comment,
        "should_rebalance": result.get("should_rebalance", False),
        "trades_executed":  trades_done,
        "state":            _format_state(sim),
    }


class SimSettingsBody(BaseModel):
    risk_appetite:        Optional[str]         = None
    goals:                Optional[list[GoalIn]] = None
    monthly_salary:       Optional[float]       = None
    monthly_contribution: Optional[float]       = None


@router.post("/settings")
def update_settings(
    body: SimSettingsBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    """Update risk appetite / goals / contribution; triggers Popi rebalance if risk changed."""
    sim = db.query(SimPortfolio).filter(SimPortfolio.user_id == current_user.id).first()
    if not sim:
        return {"error": "No simulation found."}

    risk_changed = False
    if body.risk_appetite and body.risk_appetite != sim.risk_appetite:
        sim.risk_appetite = body.risk_appetite
        risk_changed = True

    if body.monthly_salary is not None:
        sim.monthly_salary = body.monthly_salary if body.monthly_salary > 0 else None

    if body.goals is not None:
        for g in list(sim.goals):
            db.delete(g)
        db.flush()
        for g in body.goals:
            db.add(SimGoal(
                sim_id=sim.id,
                name=g.name, amount=g.amount,
                years=g.years, priority=g.priority,
            ))

    db.commit()
    db.refresh(sim)

    popi_comment = ""
    if risk_changed:
        api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        if api_key:
            state  = _format_state(sim)
            prompt = _rebalance_prompt(state)
            result = _call_claude(prompt, api_key, max_tokens=1000)
            if result and "__error__" not in result:
                popi_comment = result.get("popi_comment", "")
                if result.get("should_rebalance") and result.get("trades"):
                    _execute_trades(sim, result["trades"], "Risk change rebalance", db)
            db.refresh(sim)

    return {"popi_comment": popi_comment, "state": _format_state(sim)}


class ContributeBody(BaseModel):
    amount: float


@router.post("/contribute")
def contribute(
    body: ContributeBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    """Add cash to the simulation; Popi deploys it."""
    api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    sim = db.query(SimPortfolio).filter(SimPortfolio.user_id == current_user.id).first()
    if not sim:
        return {"error": "No simulation found."}

    sim.cash_balance      += body.amount
    sim.total_contributed += body.amount
    db.commit()

    if not api_key:
        # No AI key — just add cash, don't deploy
        db.refresh(sim)
        return {"popi_comment": f"${body.amount:,.0f} added to your cash balance. Add an API key so Popi can deploy it.", "state": _format_state(sim)}

    state  = _format_state(sim)
    prompt = _contribute_prompt(state, body.amount)
    result = _call_claude(prompt, api_key, max_tokens=800)

    if result and result.get("trades"):
        _execute_trades(sim, result["trades"], "Contribution deployment", db)

    db.refresh(sim)
    return {
        "popi_comment": result.get("popi_comment", "") if result else "",
        "state":        _format_state(sim),
    }


# ── User-directed suggestion flow ──────────────────────────────────────────────

class SuggestBody(BaseModel):
    message: str


@router.post("/suggest")
def suggest_changes(
    body: SuggestBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    """
    User describes a desired change; Popi proposes specific trades.
    Nothing is executed — the client must call /execute-trades to confirm.
    """
    api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"error": "No Anthropic API key."}

    sim = db.query(SimPortfolio).filter(SimPortfolio.user_id == current_user.id).first()
    if not sim:
        return {"error": "No simulation found."}

    state  = _format_state(sim)
    prompt = _suggest_prompt(state, body.message.strip())
    result = _call_claude(prompt, api_key, max_tokens=1200)

    if not result:
        return {"error": "Popi couldn't process your suggestion right now."}
    if "__error__" in result:
        err = result["__error__"]
        if err == "invalid_api_key":
            return {"error": "Invalid API key. Please check Profile Settings."}
        return {"error": f"Popi encountered an error: {err}"}

    return {
        "popi_comment":    result.get("popi_comment", ""),
        "proposed_trades": result.get("proposed_trades", []),
        "no_change_needed": result.get("no_change_needed", False),
    }


class ExecuteTradesBody(BaseModel):
    trades: list[dict]


@router.post("/execute-trades")
def execute_proposed_trades(
    body: ExecuteTradesBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Execute a user-approved set of trades."""
    sim = db.query(SimPortfolio).filter(SimPortfolio.user_id == current_user.id).first()
    if not sim:
        return {"error": "No simulation found."}

    _execute_trades(sim, body.trades, "User-directed", db)
    db.refresh(sim)
    return {"state": _format_state(sim)}
