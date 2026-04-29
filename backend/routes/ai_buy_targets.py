from fastapi import APIRouter, Depends, HTTPException, Header
from typing import Optional
from pydantic import BaseModel
from sqlalchemy.orm import Session
from concurrent.futures import ThreadPoolExecutor, as_completed
import yfinance as yf
import anthropic
import os
import json

from database import get_db
from models import Portfolio, Holding
from price_poller import latest_prices

router = APIRouter()


class BuyTargetRequest(BaseModel):
    cagr_map: dict[str, float] = {}
    default_cagr: float = 15.0

    def get_cagr(self, symbol: str) -> float:
        return self.cagr_map.get(symbol, self.default_cagr)


def fetch_fundamentals(symbol: str) -> dict:
    try:
        t = yf.Ticker(symbol)
        info = t.info

        # ── EPS history (last 5 fiscal years) ──────────────────────────────
        eps_history = []
        pe_history = []
        try:
            stmt = t.income_stmt  # columns = annual dates (most-recent first)
            if stmt is not None and not stmt.empty:
                eps_row = None
                for label in ["Diluted EPS", "Basic EPS"]:
                    if label in stmt.index:
                        eps_row = stmt.loc[label].dropna()
                        break

                if eps_row is not None and len(eps_row) > 0:
                    # Sort ascending (oldest first), take last 5 years
                    pairs = sorted(
                        [(col, float(val)) for col, val in eps_row.items()],
                        key=lambda x: x[0],
                    )[-5:]

                    for i, (date, eps) in enumerate(pairs):
                        yoy = None
                        if i > 0:
                            prev_eps = pairs[i - 1][1]
                            # Only compute YoY when both years are positive — cross-zero
                            # changes (e.g. loss year → profit year) produce nonsensical %
                            if prev_eps > 0 and eps > 0:
                                yoy = round((eps / prev_eps - 1) * 100, 1)
                        eps_history.append({
                            "year": date.year,
                            "value": round(eps, 2),
                            "yoy": yoy,
                        })

                    # ── P/E history + 5-year price CAGR ───────────────────
                    price_cagr_5y = None
                    try:
                        hist = t.history(period="6y", interval="1mo")
                        if not hist.empty:
                            for i, (date, eps) in enumerate(pairs):
                                if eps <= 0:
                                    pe_history.append({"year": date.year, "value": None, "yoy": None})
                                    continue
                                dec = hist[(hist.index.year == date.year) & (hist.index.month == 12)]["Close"]
                                year_prices = hist[hist.index.year == date.year]["Close"]
                                if not dec.empty:
                                    price = float(dec.iloc[-1])
                                elif not year_prices.empty:
                                    price = float(year_prices.iloc[-1])
                                else:
                                    pe_history.append({"year": date.year, "value": None, "yoy": None})
                                    continue
                                pe = round(price / eps, 1)
                                prev_pe = pe_history[-1]["value"] if pe_history else None
                                yoy_pe = round((pe / prev_pe - 1) * 100, 1) if prev_pe else None
                                pe_history.append({"year": date.year, "value": pe, "yoy": yoy_pe})

                            # 5-year price CAGR: earliest vs latest close in the window
                            closes = hist["Close"].dropna()
                            if len(closes) >= 2:
                                p0 = float(closes.iloc[0])
                                p1 = float(closes.iloc[-1])
                                years = len(closes) / 12.0
                                if p0 > 0 and years > 0:
                                    price_cagr_5y = round(((p1 / p0) ** (1 / years) - 1) * 100, 1)
                    except Exception:
                        pass
        except Exception as e:
            print(f"[fundamentals] history error for {symbol}: {e}")

        return {
            "symbol": symbol,
            "name": info.get("longName") or info.get("shortName", symbol),
            "sector": info.get("sector", ""),
            "forward_eps": info.get("forwardEps"),
            "trailing_eps": info.get("trailingEps"),
            "forward_pe": info.get("forwardPE"),
            "trailing_pe": info.get("trailingPE"),
            "peg_ratio": info.get("pegRatio"),
            "revenue_growth": info.get("revenueGrowth"),
            "earnings_growth": info.get("earningsGrowth"),
            "gross_margins": info.get("grossMargins"),
            "operating_margins": info.get("operatingMargins"),
            "return_on_equity": info.get("returnOnEquity"),
            "free_cashflow": info.get("freeCashflow"),
            "total_revenue": info.get("totalRevenue"),
            "market_cap": info.get("marketCap"),
            "target_mean_price": info.get("targetMeanPrice"),
            "target_low_price": info.get("targetLowPrice"),
            "target_high_price": info.get("targetHighPrice"),
            "recommendation": info.get("recommendationKey"),
            "num_analysts": info.get("numberOfAnalystOpinions"),
            "beta": info.get("beta"),
            "long_summary": (info.get("longBusinessSummary") or "")[:300],
            "eps_history": eps_history,
            "pe_history": pe_history,
            "price_cagr_5y": price_cagr_5y,
        }
    except Exception as e:
        return {"symbol": symbol, "error": str(e)}


def build_analysis_prompt(stocks_data: list[dict], cagr_map: dict[str, float], default_cagr: float, live_prices: Optional[dict] = None) -> str:
    if live_prices is None:
        live_prices = {}
    stock_lines = []
    for s in stocks_data:
        if "error" in s:
            continue
        sym = s["symbol"]
        cagr = cagr_map.get(sym, default_cagr)
        live_price = live_prices.get(sym) or latest_prices.get(sym, 0)
        line = f"""
### {sym} — {s.get('name', '')} ({s.get('sector', '')})
- **Investor Target CAGR: {cagr}% per year over 5 years**
- Current Price: ${live_price:.2f}
- Forward EPS: {s.get('forward_eps')} | Trailing EPS: {s.get('trailing_eps')}
- Forward P/E: {s.get('forward_pe')} | Trailing P/E: {s.get('trailing_pe')}
- PEG Ratio: {s.get('peg_ratio')}
- Revenue Growth (TTM): {f"{s['revenue_growth']*100:.1f}%" if s.get('revenue_growth') else 'N/A'}
- Earnings Growth (TTM): {f"{s['earnings_growth']*100:.1f}%" if s.get('earnings_growth') else 'N/A'}
- Gross Margin: {f"{s['gross_margins']*100:.1f}%" if s.get('gross_margins') else 'N/A'}
- Operating Margin: {f"{s['operating_margins']*100:.1f}%" if s.get('operating_margins') else 'N/A'}
- Return on Equity: {f"{s['return_on_equity']*100:.1f}%" if s.get('return_on_equity') else 'N/A'}
- Analyst Target: Low ${s.get('target_low_price')} / Mean ${s.get('target_mean_price')} / High ${s.get('target_high_price')}
- Analyst Consensus: {s.get('recommendation')} ({s.get('num_analysts')} analysts)
- Business: {s.get('long_summary', '')[:200]}
- **DCF Formula for this stock:** buy_price = (forward_eps * (1 + annual_eps_growth)^5 * exit_pe) / (1 + {cagr}/100)^5"""
        stock_lines.append(line)

    return f"""You are a senior equity research analyst. For each stock below, use your knowledge of their most recent earnings calls, management guidance, and strategic outlook (through your training data), combined with the financial metrics provided.

Each stock has its own investor target CAGR listed in its section — use that specific CAGR for that stock's DCF calculation.

**Buy Price Formula (DCF):**
For each scenario, compute buy price using the stock's individual target CAGR:
  buy_price = (forward_eps * (1 + annual_eps_growth)^5 * exit_pe) / (1 + target_cagr/100)^5

Use a reasonable exit P/E for each company based on its growth profile and sector.

**For each stock, output ONLY valid JSON** (no markdown, no explanation outside the JSON):

{{
  "results": [
    {{
      "symbol": "TICKER",
      "current_price": <float>,
      "bear": {{
        "annual_revenue_growth": <float, e.g. 0.08 for 8%>,
        "annual_eps_growth": <float>,
        "exit_pe": <float>,
        "buy_price": <float>,
        "rationale": "<one sentence: what drives the bear case>"
      }},
      "base": {{
        "annual_revenue_growth": <float>,
        "annual_eps_growth": <float>,
        "exit_pe": <float>,
        "buy_price": <float>,
        "rationale": "<one sentence: what drives the base case>"
      }},
      "bull": {{
        "annual_revenue_growth": <float>,
        "annual_eps_growth": <float>,
        "exit_pe": <float>,
        "buy_price": <float>,
        "rationale": "<one sentence: what drives the bull case>"
      }},
      "management_outlook": "<2-3 sentences summarizing the company's revenue/earnings growth outlook for the next 5 years based on most recent earnings call and management guidance>",
      "key_risks": "<one sentence on the biggest risk to the thesis>"
    }}
  ]
}}

**STOCKS TO ANALYZE:**
{''.join(stock_lines)}
"""


@router.post("/portfolios/{portfolio_id}/ai-buy-targets")
def get_ai_buy_targets(
    portfolio_id: int,
    body: BuyTargetRequest,
    db: Session = Depends(get_db),
    x_api_key: Optional[str] = Header(default=None),
):
    api_key = x_api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(400, "Anthropic API key not set. Add it in the profile settings.")

    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(404, "Portfolio not found")

    # If the caller explicitly provided a cagr_map, use those symbols directly.
    # Do NOT filter against the portfolio's holdings — the master portfolio passes a
    # virtual portfolio id that may not contain the requested symbol, which would cause
    # a silent fallback to all holdings in that portfolio.
    if body.cagr_map:
        symbols = list(body.cagr_map.keys())
    else:
        holdings = [h for h in portfolio.holdings if h.asset_type != "cash"]
        if not holdings:
            raise HTTPException(400, "No holdings to analyze")
        symbols = list({h.symbol for h in holdings})

    # Fetch fundamentals in parallel
    fundamentals: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(fetch_fundamentals, sym): sym for sym in symbols}
        for future in as_completed(futures):
            result = future.result()
            fundamentals[result["symbol"]] = result

    # ── Batch-fetch live prices via yf.download (single HTTP call, always reliable) ──
    # This is done SEPARATELY from fundamentals so that threading/rate-limit issues
    # in fetch_fundamentals never cause us to fall back to Claude's stale training prices.
    live_prices: dict[str, float] = {}
    try:
        dl_syms = " ".join(symbols)
        raw_dl = yf.download(dl_syms, period="5d", progress=False, auto_adjust=True)
        if not raw_dl.empty:
            # yf.download always returns a DataFrame with a Ticker column level (even for
            # a single symbol). Never use iloc[-1] on the whole DataFrame — it returns a
            # Series, not a float. Always index by symbol name first.
            close = raw_dl["Close"]  # DataFrame: rows=dates, columns=ticker names
            for sym in symbols:
                if sym in close.columns:
                    series = close[sym].dropna()
                    if not series.empty:
                        live_prices[sym] = float(series.iloc[-1])
    except Exception as e:
        print(f"[ai-buy-targets] batch price fetch failed: {e}")

    # Fallback for any symbols still missing: individual history call (confirmed reliable)
    for sym in [s for s in symbols if s not in live_prices]:
        try:
            hist = yf.Ticker(sym).history(period="5d")
            if not hist.empty:
                live_prices[sym] = float(hist["Close"].dropna().iloc[-1])
        except Exception:
            pass

    stocks_data = list(fundamentals.values())

    # Build prompt and call Claude
    prompt = build_analysis_prompt(stocks_data, body.cagr_map, body.default_cagr, live_prices)
    client = anthropic.Anthropic(api_key=api_key)

    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8000,
            system=(
                "You are a senior equity research analyst with deep knowledge of public company earnings calls, "
                "management guidance, and DCF valuation. Output only valid JSON as instructed. "
                "Be realistic and data-driven. Use your knowledge through your training cutoff for earnings call context."
            ),
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AuthenticationError:
        raise HTTPException(401, "Invalid Anthropic API key. Check the key in profile settings.")
    except anthropic.RateLimitError:
        raise HTTPException(429, "Anthropic rate limit hit. Wait a moment and try again.")
    except anthropic.APIError as e:
        raise HTTPException(502, f"Anthropic API error: {str(e)}")

    raw = message.content[0].text.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        parsed = json.loads(raw)
        results = parsed.get("results", [])
    except json.JSONDecodeError:
        raise HTTPException(500, f"Failed to parse AI response: {raw[:200]}")

    # Enrich with current price and distance calculation
    enriched = []
    for r in results:
        sym = r["symbol"]
        # Use the batch-fetched live price. Never fall back to Claude's JSON current_price
        # (r["current_price"]) — that value comes from Claude's training data and is stale.
        current = live_prices.get(sym) or latest_prices.get(sym) or 0
        base_buy = r.get("base", {}).get("buy_price", 0)
        bear_buy = r.get("bear", {}).get("buy_price", 0)
        bull_buy = r.get("bull", {}).get("buy_price", 0)

        # Distance from base buy price (negative = below = attractive)
        distance_pct = ((current - base_buy) / base_buy * 100) if base_buy else 0

        if distance_pct < -20:
            signal = "strong_buy"
        elif distance_pct < 0:
            signal = "buy"
        elif distance_pct < 15:
            signal = "near_target"
        else:
            signal = "above_target"

        enriched.append({
            **r,
            "current_price": current,
            "forward_eps_used": fundamentals.get(sym, {}).get("forward_eps"),
            "eps_history": fundamentals.get(sym, {}).get("eps_history", []),
            "pe_history": fundamentals.get(sym, {}).get("pe_history", []),
            "price_cagr_5y": fundamentals.get(sym, {}).get("price_cagr_5y"),
            "bear_buy_price": bear_buy,
            "base_buy_price": base_buy,
            "bull_buy_price": bull_buy,
            "distance_from_base_pct": round(distance_pct, 1),
            "signal": signal,
            "cagr_used": body.get_cagr(sym),
        })

    # Sort: closest to / below base buy price first (most attractive on top)
    enriched.sort(key=lambda x: x["distance_from_base_pct"])

    return enriched
