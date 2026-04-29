from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
import anthropic
import os

from database import get_db
from routes.advisor import build_portfolio_context

router = APIRouter()

POPI_SYSTEM = """You are Popi, a warm, knowledgeable, and deeply empathetic personal wealth management advisor. You are exclusively a portfolio and financial advisor — your entire purpose is helping users with their investments, wealth, and financial decisions.

IMPORTANT SCOPE RULE: If a user asks about anything completely unrelated to finance, investments, portfolios, wealth management, taxes, retirement, or financial planning, gently redirect them. Say something like: "Hey, I'm Popi — your dedicated wealth manager. I'm not a general-purpose assistant, but I'm here to give you honest, personalised advice about your portfolio and finances. What would you like to explore?" Keep it warm, not robotic.

Your personality:
- Speak like a trusted friend who happens to be a CFP — direct, warm, never corporate
- Never judgmental. Every financial situation is valid and can be improved.
- Use the user's EXACT numbers: tickers, dollar amounts, percentages
- Be honest about risks but frame them constructively — always a path forward
- End every analysis with 3–5 clear, prioritized action items
- Use markdown formatting: headers, bullet points, bold for key numbers

Your analysis framework (always cover these):
1. **Portfolio Health Score** (1–10) — give a number and one-sentence explanation
2. **What's working** — highlight top performers, smart allocations, strengths
3. **Risks & concerns** — concentration, sector exposure, cash drag, liquidity
4. **Goal alignment** — how well does the current portfolio serve the stated goals?
5. **Recommendations** — specific, actionable, ordered by priority
6. **Cash deployment** — if idle cash exists, suggest where it could work harder

Tone rules:
- Never say "I cannot provide financial advice" — you ARE a financial advisor
- Never hedge with disclaimers like "consult a professional"
- Be direct: "I'd sell X and buy Y" not "you might consider potentially..."
- Acknowledge emotions: wealth is personal, changes can feel scary, that's okay
- Create psychological safety — no decision they've made is stupid"""


class ConversationMessage(BaseModel):
    role: str    # "user" or "assistant"
    content: str


class PophiRequest(BaseModel):
    goals: Optional[list[str]] = None
    risk_appetite: Optional[str] = "moderate"
    follow_up: Optional[str] = None
    history: Optional[list[ConversationMessage]] = None
    mode: Optional[str] = "wealth"


@router.post("/popi")
def ask_popi(
    req: PophiRequest,
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"response": "⚠️ No Anthropic API key found. Open profile settings (top-right) and paste your key."}

    context = build_portfolio_context(db)

    goals_text = "\n".join(f"- {g}" for g in req.goals) if req.goals else "- Not specified by user"
    risk_map = {
        "conservative": "Conservative — protect capital, slow steady growth",
        "moderate": "Moderate — balance growth and safety",
        "aggressive": "Aggressive — maximize long-term returns, comfortable with volatility",
        "very_aggressive": "Very Aggressive — high risk, high reward, long time horizon",
    }
    risk_text = risk_map.get(req.risk_appetite, req.risk_appetite)

    system_context = f"""{POPI_SYSTEM}

---
USER'S FINANCIAL PROFILE:

Goals:
{goals_text}

Risk Appetite: {risk_text}

COMPLETE NET WEALTH DATA:
{context}
---"""

    messages = []

    if req.history:
        for msg in req.history:
            messages.append({"role": msg.role, "content": msg.content})

    if req.follow_up:
        # Follow-up: free-form conversational answer
        messages.append({"role": "user", "content": req.follow_up})
    else:
        # Initial analysis: request structured JSON
        if req.mode == "stocks":
            user_content = (
                "Review my stock and crypto holdings specifically (ignore cash and real estate for now) "
                "and return ONLY valid JSON — no markdown, no text outside the JSON. "
                "Use this exact schema:\n"
                "{\n"
                '  "health_score": <integer 1-10>,\n'
                '  "health_summary": "<one punchy sentence about my stock portfolio specifically>",\n'
                '  "strengths": ["<specific strength with ticker and numbers>", ...],\n'
                '  "risks": ["<specific risk with ticker and numbers>", ...],\n'
                '  "goal_alignment": "<2-3 sentences on how well the stock portfolio serves stated goals>",\n'
                '  "recommendations": ["<concrete action: buy X, sell Y, rebalance Z>", ...],\n'
                '  "cash_insight": "<one sentence on uninvested cash opportunity, or null>"\n'
                "}\n"
                "Focus on: concentration risk, sector exposure, individual position sizing, winners vs losers. "
                "Use exact tickers and dollar amounts. 3-5 items per list."
            )
        else:
            user_content = (
                "Review my complete financial picture and return ONLY valid JSON — no markdown, no text outside the JSON. "
                "Use this exact schema:\n"
                "{\n"
                '  "health_score": <integer 1-10>,\n'
                '  "health_summary": "<one punchy sentence explaining the score>",\n'
                '  "strengths": ["<specific strength with numbers>", ...],\n'
                '  "risks": ["<specific risk with numbers>", ...],\n'
                '  "goal_alignment": "<2-3 sentences on how well the portfolio serves stated goals>",\n'
                '  "recommendations": ["<concrete action step>", ...],\n'
                '  "cash_insight": "<one sentence on cash, or null if no notable cash situation>"\n'
                "}\n"
                "Be specific — use exact tickers, dollar amounts, percentages from my data. 3-5 items per list."
            )
        messages.append({"role": "user", "content": user_content})

    client = anthropic.Anthropic(api_key=api_key)
    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2000,
            system=system_context,
            messages=messages,
        )
        raw = message.content[0].text.strip()

        # For initial analysis, try to parse as structured JSON
        if not req.follow_up:
            import json
            # Strip code fences if present
            clean = raw
            if clean.startswith("```"):
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            clean = clean.strip()
            try:
                structured = json.loads(clean)
                return {"response": raw, "structured": structured}
            except Exception:
                pass  # fall through to plain text

        return {"response": raw, "structured": None}
    except anthropic.AuthenticationError:
        return {"response": "⚠️ Invalid Anthropic API key. Check the key in your profile settings.", "structured": None}
    except Exception as e:
        return {"response": f"⚠️ Something went wrong: {str(e)}", "structured": None}
