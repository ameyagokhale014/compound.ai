"""
Technical Signals route — computes 9 indicators + Claude insight for any symbol.
GET /signals/{symbol}         — full analysis + chart data
GET /signals/alerts           — portfolio/watchlist symbols with |score| >= 4
"""
from __future__ import annotations
import json, math
from typing import Optional
from fastapi import APIRouter, Header, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
import models

try:
    import yfinance as yf
    import pandas as pd
    import numpy as np
    HAS_YFINANCE = True
except ImportError:
    HAS_YFINANCE = False

try:
    import anthropic as _anthropic_lib
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

router = APIRouter(prefix="/signals", tags=["signals"])

# ── helpers ────────────────────────────────────────────────────────────────────

def _safe(v) -> Optional[float]:
    """Convert numpy scalar → Python float, replacing nan/inf with None."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    except (TypeError, ValueError):
        return None


def _fetch_ohlcv(symbol: str, period: str = "2y") -> Optional["pd.DataFrame"]:
    """Download OHLCV via yfinance, flatten MultiIndex if needed."""
    if not HAS_YFINANCE:
        return None
    try:
        df = yf.download(symbol, period=period, auto_adjust=True, progress=False)
        if df is None or df.empty:
            return None
        # Flatten MultiIndex columns e.g. ("Close", "AAPL") → "Close"
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [col[0] for col in df.columns]
        # Ensure standard column names (case-insensitive)
        df.columns = [c.capitalize() for c in df.columns]
        for col in ["Open", "High", "Low", "Close", "Volume"]:
            if col not in df.columns:
                return None
        df = df.dropna(subset=["Close"])
        return df if len(df) >= 50 else None
    except Exception:
        return None


def _compute(df: "pd.DataFrame") -> dict:
    """Compute all technical indicators, return as dict of pd.Series."""
    close = df["Close"]
    high  = df["High"]
    low   = df["Low"]
    vol   = df["Volume"]

    ind: dict = {}

    # Moving averages
    ind["sma20"]  = close.rolling(20).mean()
    ind["sma50"]  = close.rolling(50).mean()
    ind["sma200"] = close.rolling(200).mean()
    ind["ema9"]   = close.ewm(span=9,  adjust=False).mean()
    ind["ema21"]  = close.ewm(span=21, adjust=False).mean()

    # RSI (Wilder's, period=14)
    delta = close.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=13, adjust=False).mean()
    avg_loss = loss.ewm(com=13, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, float("nan"))
    ind["rsi"] = 100 - (100 / (1 + rs))

    # MACD (12/26/9)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    ind["macd"]        = ema12 - ema26
    ind["macd_signal"] = ind["macd"].ewm(span=9, adjust=False).mean()
    ind["macd_hist"]   = ind["macd"] - ind["macd_signal"]

    # Bollinger Bands (20-day, ±2σ)
    sma20    = ind["sma20"]
    std20    = close.rolling(20).std()
    ind["bb_mid"]   = sma20
    ind["bb_upper"] = sma20 + 2 * std20
    ind["bb_lower"] = sma20 - 2 * std20
    ind["bb_width"] = (ind["bb_upper"] - ind["bb_lower"]) / sma20

    # OBV
    sign = pd.Series(0.0, index=close.index)
    sign[close.diff() > 0]  =  1.0
    sign[close.diff() < 0]  = -1.0
    ind["obv"] = (vol * sign).cumsum()

    # Volume MA
    ind["vol_ma20"] = vol.rolling(20).mean()

    # ATR (14-day)
    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low  - close.shift(1)).abs()
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    ind["atr"] = true_range.rolling(14).mean()

    return ind


def _detect_signals(df: "pd.DataFrame", ind: dict) -> tuple[list[dict], int]:
    """
    Evaluate 9 signals. Returns (signals_list, total_score).
    Each signal dict: id, name, category, direction, strength, title,
                      what_it_is, threshold, what_it_means_now, action, values
    """
    close = df["Close"]
    vol   = df["Volume"]

    signals: list[dict] = []
    total_score = 0

    def last(series, n=1):
        try:
            v = series.dropna()
            return v.iloc[-n] if len(v) >= n else None
        except Exception:
            return None

    price   = _safe(last(close))
    sma20   = _safe(last(ind["sma20"]))
    sma50   = _safe(last(ind["sma50"]))
    sma200  = _safe(last(ind["sma200"]))
    ema9    = _safe(last(ind["ema9"]))
    ema21   = _safe(last(ind["ema21"]))
    rsi_val = _safe(last(ind["rsi"]))
    macd_val = _safe(last(ind["macd"]))
    macd_sig = _safe(last(ind["macd_signal"]))
    macd_h   = _safe(last(ind["macd_hist"]))
    bb_up    = _safe(last(ind["bb_upper"]))
    bb_lo    = _safe(last(ind["bb_lower"]))
    bb_mid   = _safe(last(ind["bb_mid"]))
    bb_wid   = _safe(last(ind["bb_width"]))
    obv_val  = _safe(last(ind["obv"]))
    vol_ma   = _safe(last(ind["vol_ma20"]))
    atr_val  = _safe(last(ind["atr"]))

    # ── 1. Price vs 200-day SMA ───────────────────────────────────────────────
    if price is not None and sma200 is not None:
        above = price > sma200
        pct_from = ((price - sma200) / sma200) * 100
        score = 1 if above else -1
        total_score += score
        signals.append({
            "id": "price_vs_200sma",
            "name": "Price vs 200-Day SMA",
            "category": "Trend",
            "direction": "bullish" if above else "bearish",
            "strength": "moderate",
            "score": score,
            "title": f"Price is {'above' if above else 'below'} 200-day moving average",
            "what_it_is": "The 200-day Simple Moving Average (SMA) is the average closing price over the last 200 trading days (~10 months). It is the gold standard for identifying long-term trend direction.",
            "threshold": "Price > SMA200 = bullish regime. Price < SMA200 = bearish regime.",
            "what_it_means_now": f"At ${price:.2f}, the stock is {abs(pct_from):.1f}% {'above' if above else 'below'} its 200-day SMA of ${sma200:.2f}. {'This confirms a long-term uptrend.' if above else 'This confirms a long-term downtrend — proceed with caution.'}",
            "action": "Favor longs when above; reduce exposure when below." if above else "Avoid new longs; consider trimming positions.",
            "values": {"price": price, "sma200": sma200, "pct_from_200": round(pct_from, 2)},
        })

    # ── 2. Golden / Death Cross (SMA50 vs SMA200) ─────────────────────────────
    if sma50 is not None and sma200 is not None:
        sma50_s  = ind["sma50"].dropna()
        sma200_s = ind["sma200"].dropna()
        common   = sma50_s.index.intersection(sma200_s.index)
        if len(common) >= 11:
            diff_series = sma50_s.loc[common] - sma200_s.loc[common]
            recent_cross = None
            for i in range(1, min(11, len(diff_series))):
                prev_d = _safe(diff_series.iloc[-(i+1)])
                curr_d = _safe(diff_series.iloc[-i])
                if prev_d is None or curr_d is None:
                    continue
                if prev_d < 0 and curr_d > 0:
                    recent_cross = ("golden", i)
                    break
                if prev_d > 0 and curr_d < 0:
                    recent_cross = ("death", i)
                    break

            is_golden_regime = diff_series.iloc[-1] > 0
            if recent_cross:
                cross_type, days_ago = recent_cross
                score = 3 if cross_type == "golden" else -3
                total_score += score
                signals.append({
                    "id": "golden_death_cross",
                    "name": f"{'Golden' if cross_type == 'golden' else 'Death'} Cross",
                    "category": "Trend",
                    "direction": "bullish" if cross_type == "golden" else "bearish",
                    "strength": "strong",
                    "score": score,
                    "title": f"{'Golden Cross just fired' if cross_type == 'golden' else 'Death Cross just fired'} ({days_ago} days ago)",
                    "what_it_is": "A Golden Cross occurs when the 50-day SMA crosses above the 200-day SMA — historically one of the most reliable long-term bull signals. A Death Cross is the opposite: 50-day crosses below 200-day, signaling a shift to a bear regime.",
                    "threshold": "SMA50 crossing above SMA200 = Golden Cross (+3 pts). SMA50 crossing below = Death Cross (-3 pts).",
                    "what_it_means_now": f"A {'Golden' if cross_type == 'golden' else 'Death'} Cross occurred {days_ago} days ago. {'Historically this has led to extended rallies in ~70% of cases.' if cross_type == 'golden' else 'Historically this has preceded continued selling pressure in ~65% of cases.'}",
                    "action": "High-conviction buy signal — consider initiating or adding to positions." if cross_type == "golden" else "High-conviction sell signal — consider reducing exposure significantly.",
                    "values": {"sma50": sma50, "sma200": sma200, "cross_days_ago": days_ago},
                })
            else:
                score = 2 if is_golden_regime else -2
                total_score += score
                signals.append({
                    "id": "golden_death_cross",
                    "name": "SMA50/200 Regime",
                    "category": "Trend",
                    "direction": "bullish" if is_golden_regime else "bearish",
                    "strength": "moderate",
                    "score": score,
                    "title": f"Currently in a {'bullish' if is_golden_regime else 'bearish'} MA regime",
                    "what_it_is": "When SMA50 > SMA200 (Golden Cross regime), the stock is in a confirmed long-term uptrend. When SMA50 < SMA200 (Death Cross regime), the stock is in a confirmed long-term downtrend.",
                    "threshold": "SMA50 > SMA200 = bullish (+2 pts). SMA50 < SMA200 = bearish (-2 pts).",
                    "what_it_means_now": f"SMA50 (${sma50:.2f}) is {'above' if is_golden_regime else 'below'} SMA200 (${sma200:.2f}). The stock is in a {'sustained uptrend — trend followers are long.' if is_golden_regime else 'sustained downtrend — institutional selling is dominant.'}",
                    "action": "Trend is your friend — remain long until Death Cross forms." if is_golden_regime else "Reduce or avoid new positions until Golden Cross forms.",
                    "values": {"sma50": sma50, "sma200": sma200},
                })

    # ── 3. EMA 9/21 Crossover (short-term momentum) ───────────────────────────
    if ema9 is not None and ema21 is not None:
        ema9_s  = ind["ema9"].dropna()
        ema21_s = ind["ema21"].dropna()
        common  = ema9_s.index.intersection(ema21_s.index)
        if len(common) >= 5:
            diff_e = ema9_s.loc[common] - ema21_s.loc[common]
            recent_ema_cross = None
            for i in range(1, min(5, len(diff_e))):
                pd_ = _safe(diff_e.iloc[-(i+1)])
                cd_ = _safe(diff_e.iloc[-i])
                if pd_ is None or cd_ is None:
                    continue
                if pd_ < 0 and cd_ > 0:
                    recent_ema_cross = ("bullish", i)
                    break
                if pd_ > 0 and cd_ < 0:
                    recent_ema_cross = ("bearish", i)
                    break

            is_ema_bull = diff_e.iloc[-1] > 0
            if recent_ema_cross:
                direction, days_ago = recent_ema_cross
                score = 2 if direction == "bullish" else -2
                total_score += score
                signals.append({
                    "id": "ema_crossover",
                    "name": "EMA 9/21 Crossover",
                    "category": "Momentum",
                    "direction": direction,
                    "strength": "strong",
                    "score": score,
                    "title": f"EMA 9 just crossed {'above' if direction == 'bullish' else 'below'} EMA 21 ({days_ago}d ago)",
                    "what_it_is": "The 9-day EMA responds to price changes faster than the 21-day EMA. When the faster EMA crosses the slower one, it signals a short-term momentum shift — widely used by swing traders and momentum funds.",
                    "threshold": "EMA9 crossing above EMA21 within 3 days = fresh bullish signal (+2). Vice versa = bearish (-2).",
                    "what_it_means_now": f"The 9-day EMA (${ema9:.2f}) crossed {'above' if direction == 'bullish' else 'below'} the 21-day EMA (${ema21:.2f}) {days_ago} days ago — a fresh {'bullish' if direction == 'bullish' else 'bearish'} momentum trigger.",
                    "action": "Short-term momentum is accelerating — watch for follow-through." if direction == "bullish" else "Short-term momentum is weakening — watch for further deterioration.",
                    "values": {"ema9": ema9, "ema21": ema21, "cross_days_ago": days_ago},
                })
            else:
                score = 1 if is_ema_bull else -1
                total_score += score
                signals.append({
                    "id": "ema_crossover",
                    "name": "EMA 9/21 Alignment",
                    "category": "Momentum",
                    "direction": "bullish" if is_ema_bull else "bearish",
                    "strength": "moderate",
                    "score": score,
                    "title": f"EMA 9 is {'above' if is_ema_bull else 'below'} EMA 21",
                    "what_it_is": "The relative positioning of the 9-day and 21-day Exponential Moving Averages indicates the current short-term trend. EMA gives more weight to recent prices than SMA.",
                    "threshold": "EMA9 > EMA21 = short-term bullish trend (+1). EMA9 < EMA21 = short-term bearish trend (-1).",
                    "what_it_means_now": f"EMA9 (${ema9:.2f}) is {'above' if is_ema_bull else 'below'} EMA21 (${ema21:.2f}), indicating {'positive' if is_ema_bull else 'negative'} short-term momentum.",
                    "action": "Short-term trend is up — pullbacks can be buying opportunities." if is_ema_bull else "Short-term trend is down — rallies may be selling opportunities.",
                    "values": {"ema9": ema9, "ema21": ema21},
                })

    # ── 4. RSI ────────────────────────────────────────────────────────────────
    if rsi_val is not None:
        if rsi_val < 30:
            score = 1
            direction = "bullish"
            msg = f"RSI is deeply oversold at {rsi_val:.1f}. Stocks rarely stay at this level for long — short-covering and value-buying typically produce a bounce."
            action = "Look for a bullish reversal candle or volume spike to time an entry."
        elif rsi_val > 70:
            score = -1
            direction = "bearish"
            msg = f"RSI is overbought at {rsi_val:.1f}. Momentum may be exhausted — the stock could be due for a pullback or consolidation."
            action = "Consider taking partial profits or tightening stop-losses."
        else:
            score = 0
            direction = "neutral"
            msg = f"RSI is neutral at {rsi_val:.1f}, in the healthy 30–70 range. No extreme reading."
            action = "No RSI-based action needed — watch other indicators."
        total_score += score
        signals.append({
            "id": "rsi",
            "name": "RSI",
            "category": "Momentum",
            "direction": direction,
            "strength": "strong" if (rsi_val < 25 or rsi_val > 75) else "moderate",
            "score": score,
            "title": f"RSI at {rsi_val:.1f} — {'Oversold (bullish)' if rsi_val < 30 else 'Overbought (bearish)' if rsi_val > 70 else 'Neutral'}",
            "what_it_is": "The Relative Strength Index (RSI) measures the speed and magnitude of recent price changes on a 0–100 scale. It tells you whether a stock has moved too far too fast in either direction.",
            "threshold": "RSI < 30 = oversold, typically a buy signal (+1). RSI > 70 = overbought, typically a sell signal (-1). RSI 30–70 = neutral (0).",
            "what_it_means_now": msg,
            "action": action,
            "values": {"rsi": round(rsi_val, 1)},
        })

    # ── 5. MACD ───────────────────────────────────────────────────────────────
    if macd_val is not None and macd_sig is not None and macd_h is not None:
        macd_s  = ind["macd"].dropna()
        msig_s  = ind["macd_signal"].dropna()
        mhist_s = ind["macd_hist"].dropna()
        common  = macd_s.index.intersection(msig_s.index)

        fresh_cross = None
        if len(common) >= 3:
            diff_m = macd_s.loc[common] - msig_s.loc[common]
            for i in range(1, min(4, len(diff_m))):
                pd_ = _safe(diff_m.iloc[-(i+1)])
                cd_ = _safe(diff_m.iloc[-i])
                if pd_ is None or cd_ is None:
                    continue
                if pd_ < 0 and cd_ > 0:
                    fresh_cross = ("bullish", i)
                    break
                if pd_ > 0 and cd_ < 0:
                    fresh_cross = ("bearish", i)
                    break

        is_macd_bull = macd_val > macd_sig

        # Histogram divergence: last 3 bars increasing vs MACD direction
        hist_score = 0
        if len(mhist_s) >= 4:
            h_now  = _safe(mhist_s.iloc[-1])
            h_prev = _safe(mhist_s.iloc[-2])
            h_prev2 = _safe(mhist_s.iloc[-3])
            if h_now is not None and h_prev is not None and h_prev2 is not None:
                if is_macd_bull and h_now > h_prev > h_prev2:
                    hist_score = 1   # histogram growing — strong bull momentum
                elif not is_macd_bull and h_now < h_prev < h_prev2:
                    hist_score = -1  # histogram falling — strong bear momentum

        if fresh_cross:
            direction, days_ago = fresh_cross
            score = 2 if direction == "bullish" else -2
            score += hist_score
            total_score += score
            signals.append({
                "id": "macd",
                "name": "MACD Crossover",
                "category": "Momentum",
                "direction": direction,
                "strength": "strong",
                "score": score,
                "title": f"MACD just crossed {'bullish' if direction == 'bullish' else 'bearish'} ({days_ago}d ago)",
                "what_it_is": "MACD (Moving Average Convergence Divergence) is the difference between 12-day and 26-day EMAs. When the MACD line crosses its 9-day signal line, it triggers a buy or sell signal used by traders worldwide.",
                "threshold": "MACD crossing above signal within 3 days = fresh bullish cross (+2). Histogram also accelerating adds +1. Vice versa for bearish.",
                "what_it_means_now": f"The MACD line (${macd_val:.3f}) just crossed {'above' if direction == 'bullish' else 'below'} its signal line (${macd_sig:.3f}) {days_ago} days ago. {'The histogram is also expanding — momentum is building.' if hist_score != 0 else ''}",
                "action": "MACD crossover confirmed — momentum is shifting bullish, consider building a position." if direction == "bullish" else "MACD crossover confirmed — momentum is shifting bearish, consider reducing exposure.",
                "values": {"macd": round(macd_val, 4), "signal": round(macd_sig, 4), "hist": round(macd_h, 4), "cross_days_ago": days_ago},
            })
        else:
            score = (1 if is_macd_bull else -1) + hist_score
            total_score += score
            signals.append({
                "id": "macd",
                "name": "MACD Alignment",
                "category": "Momentum",
                "direction": "bullish" if is_macd_bull else "bearish",
                "strength": "moderate",
                "score": score,
                "title": f"MACD is {'above' if is_macd_bull else 'below'} its signal line",
                "what_it_is": "MACD (Moving Average Convergence Divergence) tracks the relationship between two exponential moving averages. When MACD > signal line, the short-term trend is outpacing the medium-term — a bullish condition.",
                "threshold": "MACD > signal line = bullish (+1). Histogram also widening = extra +1. MACD < signal = bearish (-1 to -2).",
                "what_it_means_now": f"MACD ({macd_val:.3f}) is {'above' if is_macd_bull else 'below'} the signal line ({macd_sig:.3f}). {'The histogram is expanding — momentum building.' if hist_score > 0 else 'The histogram is contracting — momentum may be fading.' if hist_score < 0 else ''}",
                "action": "Bullish MACD alignment — stay long while MACD holds above signal." if is_macd_bull else "Bearish MACD alignment — caution on new longs.",
                "values": {"macd": round(macd_val, 4), "signal": round(macd_sig, 4), "hist": round(macd_h, 4)},
            })

    # ── 6. Bollinger Bands ────────────────────────────────────────────────────
    if bb_up is not None and bb_lo is not None and bb_mid is not None and price is not None:
        band_range = bb_up - bb_lo
        pct_b = (price - bb_lo) / band_range if band_range > 0 else 0.5  # 0=lower, 1=upper

        if pct_b < 0.1:  # near lower band — oversold
            score = 1
            direction = "bullish"
            title = "Price near Bollinger Lower Band (oversold)"
            msg = f"Price (${price:.2f}) is near the lower Bollinger Band (${bb_lo:.2f}), with %B at {pct_b*100:.1f}%. This often marks a short-term low."
            action = "Mean-reversion opportunity — stocks near lower BB tend to bounce toward the middle band."
        elif pct_b > 0.9:  # near upper band — overbought
            score = -1
            direction = "bearish"
            title = "Price near Bollinger Upper Band (overbought)"
            msg = f"Price (${price:.2f}) is touching the upper Bollinger Band (${bb_up:.2f}), with %B at {pct_b*100:.1f}%. Short-term pullback risk is elevated."
            action = "Consider trimming or tightening stops — upper BB resistance is significant."
        elif bb_wid is not None and bb_wid < 0.05:  # squeeze
            score = 0
            direction = "neutral"
            title = "Bollinger Band Squeeze — breakout imminent"
            msg = f"The Bollinger Bands are extremely tight (width {bb_wid*100:.1f}% of price). Volatility compression like this typically precedes a large directional move."
            action = "Watch closely — the next 1–2 weeks could see an explosive move in either direction. Wait for the breakout direction before acting."
        else:
            score = 0
            direction = "neutral"
            title = f"Price in middle of Bollinger Bands (%B: {pct_b*100:.0f}%)"
            msg = f"Price (${price:.2f}) is in the middle zone of its Bollinger Bands (${bb_lo:.2f}–${bb_up:.2f}). No extreme reading."
            action = "No Bollinger Band edge currently — watch for a move toward either band."

        total_score += score
        signals.append({
            "id": "bollinger_bands",
            "name": "Bollinger Bands",
            "category": "Volatility",
            "direction": direction,
            "strength": "moderate",
            "score": score,
            "title": title,
            "what_it_is": "Bollinger Bands are a volatility envelope: a 20-day SMA with upper/lower bands 2 standard deviations away. About 95% of price action falls within the bands. They expand during volatility and contract during calm periods.",
            "threshold": "Price near lower band (%B < 10%) = oversold (+1). Price near upper band (%B > 90%) = overbought (-1). Very tight bands = squeeze — volatility breakout incoming (watch signal).",
            "what_it_means_now": msg,
            "action": action,
            "values": {"price": price, "bb_upper": round(bb_up, 2), "bb_mid": round(bb_mid, 2), "bb_lower": round(bb_lo, 2), "pct_b": round(pct_b * 100, 1)},
        })

    # ── 7. Volume Analysis ────────────────────────────────────────────────────
    if vol_ma is not None and vol_ma > 0:
        last_vol  = _safe(vol.iloc[-1])
        close_df  = df["Close"]
        open_df   = df["Open"]
        last_close = _safe(close_df.iloc[-1])
        last_open  = _safe(open_df.iloc[-1])
        is_up_day  = (last_close is not None and last_open is not None and last_close > last_open)
        vol_ratio  = (last_vol / vol_ma) if (last_vol is not None) else 0

        if vol_ratio >= 2.0:
            if is_up_day:
                score = 1
                direction = "bullish"
                title = f"High-volume up day ({vol_ratio:.1f}x average volume)"
                msg = f"Today's volume ({int(last_vol):,}) is {vol_ratio:.1f}x the 20-day average ({int(vol_ma):,}). Heavy buying on an up day signals strong institutional conviction."
                action = "Institutional accumulation signal — buyers are in control. This often precedes sustained upward momentum."
            else:
                score = -1
                direction = "bearish"
                title = f"High-volume down day ({vol_ratio:.1f}x average volume)"
                msg = f"Today's volume ({int(last_vol):,}) is {vol_ratio:.1f}x the 20-day average ({int(vol_ma):,}). Heavy selling on a down day signals institutional distribution."
                action = "Institutional distribution signal — sellers are in control. This often precedes further selling."
        else:
            score = 0
            direction = "neutral"
            title = f"Volume normal ({vol_ratio:.1f}x average)"
            msg = f"Volume ({int(last_vol):,} vs {int(vol_ma):,} avg) shows no unusual activity. No volume-driven signal."
            action = "No volume spike — wait for a high-conviction volume day to act."

        total_score += score
        signals.append({
            "id": "volume",
            "name": "Volume Analysis",
            "category": "Volume",
            "direction": direction,
            "strength": "moderate" if vol_ratio >= 2.0 else "weak",
            "score": score,
            "title": title,
            "what_it_is": "Volume is the number of shares traded. Unusually high volume on a price move confirms the move's legitimacy — professionals call it 'volume confirms price.' A move on low volume may be a false signal.",
            "threshold": "Volume > 2x 20-day average = significant spike. Spike on an up day = bullish (+1). Spike on a down day = bearish (-1). Normal volume = neutral.",
            "what_it_means_now": msg,
            "action": action,
            "values": {"last_volume": last_vol, "vol_ma20": round(vol_ma, 0), "vol_ratio": round(vol_ratio, 2), "is_up_day": is_up_day},
        })

    # ── 8. OBV Divergence ────────────────────────────────────────────────────
    obv_s   = ind["obv"].dropna()
    close_s = df["Close"].dropna()
    if len(obv_s) >= 20 and len(close_s) >= 20:
        obv_20d_change   = _safe((obv_s.iloc[-1] - obv_s.iloc[-20]) / abs(obv_s.iloc[-20])) if abs(_safe(obv_s.iloc[-20]) or 1) > 0 else 0
        price_20d_change = _safe((close_s.iloc[-1] - close_s.iloc[-20]) / close_s.iloc[-20])

        if obv_20d_change is not None and price_20d_change is not None:
            # Bullish divergence: OBV rising while price flat/falling
            # Bearish divergence: OBV falling while price flat/rising
            if obv_20d_change > 0.02 and price_20d_change < -0.01:
                score = 1
                direction = "bullish"
                title = "Bullish OBV divergence — accumulation under the surface"
                msg = f"Price dropped {abs(price_20d_change*100):.1f}% over 20 days, but OBV rose {obv_20d_change*100:.1f}%. Smart money is buying the weakness — institutional accumulation is happening."
                action = "Bullish divergence is a leading indicator — the stock may reverse higher soon. Consider building a position."
            elif obv_20d_change < -0.02 and price_20d_change > 0.01:
                score = -1
                direction = "bearish"
                title = "Bearish OBV divergence — distribution under the surface"
                msg = f"Price rose {price_20d_change*100:.1f}% over 20 days, but OBV fell {abs(obv_20d_change*100):.1f}%. Smart money is selling into strength — institutional distribution is happening."
                action = "Bearish divergence is a warning sign — the rally may be running on fumes. Consider trimming or hedging."
            else:
                score = 0
                direction = "neutral"
                title = "OBV confirming price action — no divergence"
                msg = "On-Balance Volume is moving in line with price — no warning signs of hidden buying or selling."
                action = "OBV is confirming the current trend — no action signal."
        else:
            score = 0
            direction = "neutral"
            title = "OBV neutral"
            msg = "On-Balance Volume shows no significant divergence."
            action = "No OBV-based signal."

        total_score += score
        signals.append({
            "id": "obv",
            "name": "On-Balance Volume (OBV)",
            "category": "Volume",
            "direction": direction,
            "strength": "moderate",
            "score": score,
            "title": title,
            "what_it_is": "On-Balance Volume (OBV) adds volume on up days and subtracts it on down days to create a running total. It reveals whether big players (institutions) are quietly accumulating or distributing shares before the price reflects it.",
            "threshold": "OBV rising while price falls = bullish divergence (smart money buying). OBV falling while price rises = bearish divergence (smart money selling). Confirmation = no signal.",
            "what_it_means_now": msg,
            "action": action,
            "values": {"obv_20d_change_pct": round((obv_20d_change or 0) * 100, 1), "price_20d_change_pct": round((price_20d_change or 0) * 100, 1)},
        })

    # ── 9. 52-Week Range ──────────────────────────────────────────────────────
    if price is not None and len(close_s) >= 252:
        year_data = close_s.iloc[-252:]
        high_52w  = _safe(year_data.max())
        low_52w   = _safe(year_data.min())
        if high_52w and low_52w and high_52w > low_52w:
            pct_from_high = ((price - high_52w) / high_52w) * 100
            pct_from_low  = ((price - low_52w) / low_52w) * 100
            range_pct     = ((price - low_52w) / (high_52w - low_52w)) * 100

            if pct_from_high > -3:  # within 3% of 52-week high
                score = -1
                direction = "bearish"
                title = f"Near 52-week high (${high_52w:.2f}) — resistance zone"
                msg = f"Price (${price:.2f}) is only {abs(pct_from_high):.1f}% below its 52-week high of ${high_52w:.2f}. Major resistance is overhead."
                action = "Breakout above 52-week high = very bullish. But buying this close to resistance carries risk — wait for confirmed breakout or pullback."
            elif pct_from_low < 5:  # within 5% of 52-week low
                score = 1
                direction = "bullish"
                title = f"Near 52-week low (${low_52w:.2f}) — potential support"
                msg = f"Price (${price:.2f}) is only {pct_from_low:.1f}% above its 52-week low of ${low_52w:.2f}. Strong support may be forming."
                action = "52-week lows often represent maximum pessimism — watch for stabilization and volume surge as a potential reversal signal."
            else:
                score = 0
                direction = "neutral"
                title = f"In mid-range ({range_pct:.0f}% of 52-week range)"
                msg = f"Price (${price:.2f}) is {range_pct:.0f}% of the way through its 52-week range (${low_52w:.2f}–${high_52w:.2f}). No extremes."
                action = "No 52-week range signal — watch for a move toward either extreme."

            total_score += score
            signals.append({
                "id": "52wk_range",
                "name": "52-Week Range Position",
                "category": "Price Structure",
                "direction": direction,
                "strength": "moderate",
                "score": score,
                "title": title,
                "what_it_is": "The 52-week high and low mark a year of price discovery. Being near the high tests overhead resistance built up by investors looking to break even. Being near the low often indicates maximum pessimism — which can be a contrarian buying opportunity.",
                "threshold": "Within 3% of 52-week high = resistance zone (-1 point). Within 5% of 52-week low = support zone (+1 point).",
                "what_it_means_now": msg,
                "action": action,
                "values": {"price": price, "high_52w": round(high_52w, 2), "low_52w": round(low_52w, 2), "pct_from_high": round(pct_from_high, 1), "pct_from_low": round(pct_from_low, 1), "range_pct": round(range_pct, 1)},
            })

    return signals, total_score


def _generate_insight(symbol: str, name: str, price: float, score: int,
                      signals: list[dict], api_key: str) -> Optional[dict]:
    """Call Claude for a short packaged verdict."""
    if not HAS_ANTHROPIC or not api_key:
        return None
    try:
        client = _anthropic_lib.Anthropic(api_key=api_key)
        bull_signals = [s for s in signals if s["direction"] == "bullish" and s["score"] != 0]
        bear_signals = [s for s in signals if s["direction"] == "bearish" and s["score"] != 0]

        sig_summary = "\n".join(
            f"- [{s['direction'].upper()} | score {s['score']:+d}] {s['name']}: {s['title']}"
            for s in signals if s["score"] != 0
        )

        prompt = f"""You are a senior technical analyst. A user owns or watches {name} ({symbol}), currently priced at ${price:.2f}.

Technical signal scan results (overall score: {score:+d} out of ±10):
{sig_summary}

Score interpretation: +5 to +10 = strong bull setup. +2 to +4 = mild bull. -1 to +1 = mixed/neutral. -2 to -4 = mild bear. -5 to -10 = strong bear.

Respond ONLY with a JSON object (no markdown):
{{
  "verdict": "bullish" | "bearish" | "neutral" | "mixed",
  "headline": "One punchy sentence (max 12 words) summarizing the setup",
  "insight": "2-3 sentences. Explain what the signals collectively say. What is the key tension or agreement? Be direct, not generic.",
  "key_action": "One specific, actionable recommendation for this investor right now (1 sentence). Be concrete — mention the stock, a level, or a condition.",
  "main_risk": "The single biggest risk to the bull/bear thesis (1 sentence)."
}}"""

        resp = client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text if resp.content else ""
        # Extract JSON
        start = text.find("{")
        if start == -1:
            return None
        depth = 0; in_str = False; esc = False
        for i, ch in enumerate(text[start:], start):
            if esc: esc = False; continue
            if ch == "\\" and in_str: esc = True; continue
            if ch == '"': in_str = not in_str; continue
            if in_str: continue
            if ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(text[start: i + 1])
        return None
    except Exception:
        return None


def _build_chart_data(df: "pd.DataFrame", ind: dict, limit: int = 252) -> list[dict]:
    """Build chart data rows for the frontend (last `limit` trading days)."""
    close  = df["Close"]
    high   = df["High"]
    low    = df["Low"]
    vol    = df["Volume"]
    n = min(limit, len(close))
    rows = []
    for i in range(-n, 0):
        date = df.index[i]
        date_str = date.strftime("%Y-%m-%d") if hasattr(date, "strftime") else str(date)[:10]
        rows.append({
            "date":       date_str,
            "close":      _safe(close.iloc[i]),
            "high":       _safe(high.iloc[i]),
            "low":        _safe(low.iloc[i]),
            "volume":     _safe(vol.iloc[i]),
            "sma20":      _safe(ind["sma20"].iloc[i]),
            "sma50":      _safe(ind["sma50"].iloc[i]),
            "sma200":     _safe(ind["sma200"].iloc[i]),
            "ema9":       _safe(ind["ema9"].iloc[i]),
            "ema21":      _safe(ind["ema21"].iloc[i]),
            "rsi":        _safe(ind["rsi"].iloc[i]),
            "macd":       _safe(ind["macd"].iloc[i]),
            "macd_signal": _safe(ind["macd_signal"].iloc[i]),
            "macd_hist":  _safe(ind["macd_hist"].iloc[i]),
            "bb_upper":   _safe(ind["bb_upper"].iloc[i]),
            "bb_lower":   _safe(ind["bb_lower"].iloc[i]),
            "bb_mid":     _safe(ind["bb_mid"].iloc[i]),
            "vol_ma20":   _safe(ind["vol_ma20"].iloc[i]),
            "obv":        _safe(ind["obv"].iloc[i]),
        })
    return rows


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/{symbol}")
def get_signals(
    symbol: str,
    insight: bool = Query(False, description="Whether to run Claude insight (requires API key)"),
    x_api_key: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Full technical analysis for a symbol."""
    symbol = symbol.upper()

    if not HAS_YFINANCE:
        return {"error": "yfinance not installed", "symbol": symbol}

    df = _fetch_ohlcv(symbol)
    if df is None:
        return {"error": f"Could not fetch data for {symbol}", "symbol": symbol}

    ind = _compute(df)
    signals, score = _detect_signals(df, ind)
    chart_data = _build_chart_data(df, ind, limit=365)

    # Stock name from yfinance
    name = symbol
    try:
        ticker = yf.Ticker(symbol)
        info   = ticker.info or {}
        name   = info.get("shortName") or info.get("longName") or symbol
    except Exception:
        pass

    ai_insight = None
    price = chart_data[-1]["close"] if chart_data else None
    if insight and x_api_key and price:
        ai_insight = _generate_insight(symbol, name, price, score, signals, x_api_key)

    return {
        "symbol":     symbol,
        "name":       name,
        "score":      score,
        "signals":    signals,
        "chart_data": chart_data,
        "ai_insight": ai_insight,
    }


@router.get("/alerts/scan")
def get_signal_alerts(
    db: Session = Depends(get_db),
):
    """
    Scan all portfolio + watchlist symbols and return those with |score| >= 4.
    Does NOT call Claude (no API key needed — fast scan).
    """
    if not HAS_YFINANCE:
        return []

    # Gather unique symbols
    symbols: set[str] = set()
    try:
        holdings = db.query(models.Holding).filter(
            models.Holding.asset_type != "cash"
        ).all()
        for h in holdings:
            if h.symbol:
                symbols.add(h.symbol.upper())
    except Exception:
        pass
    try:
        watchlist = db.query(models.WatchlistItem).all()
        for w in watchlist:
            if w.symbol:
                symbols.add(w.symbol.upper())
    except Exception:
        pass

    alerts = []
    for sym in sorted(symbols):
        try:
            df = _fetch_ohlcv(sym)
            if df is None:
                continue
            ind = _compute(df)
            sigs, score = _detect_signals(df, ind)
            if abs(score) >= 4:
                price_val = _safe(df["Close"].iloc[-1])
                top_bull = [s for s in sigs if s["direction"] == "bullish" and s["score"] > 0]
                top_bear = [s for s in sigs if s["direction"] == "bearish" and s["score"] < 0]
                alerts.append({
                    "symbol": sym,
                    "score": score,
                    "verdict": "bullish" if score >= 4 else "bearish",
                    "price": price_val,
                    "top_signals": (top_bull if score >= 4 else top_bear)[:2],
                })
        except Exception:
            continue

    # Sort by abs score descending
    alerts.sort(key=lambda x: abs(x["score"]), reverse=True)
    return alerts


@router.get("/oversold/scan")
def get_oversold_scan(db: Session = Depends(get_db)):
    """
    Scan all portfolio + watchlist symbols for oversold conditions:
    - Bollinger Band %B < 15% (price near or below lower band)
    - RSI < 40 (approaching or in oversold territory)
    Returns all stocks meeting either condition, sorted by severity.
    """
    if not HAS_YFINANCE:
        return []

    symbols: set[str] = set()
    try:
        for h in db.query(models.Holding).filter(models.Holding.asset_type != "cash").all():
            if h.symbol:
                symbols.add(h.symbol.upper())
    except Exception:
        pass
    try:
        for w in db.query(models.WatchlistItem).all():
            if w.symbol:
                symbols.add(w.symbol.upper())
    except Exception:
        pass

    results = []
    for sym in sorted(symbols):
        try:
            df = _fetch_ohlcv(sym)
            if df is None:
                continue
            ind = _compute(df)

            price   = _safe(df["Close"].iloc[-1])
            rsi     = _safe(ind["rsi"].iloc[-1])
            bb_up   = _safe(ind["bb_upper"].iloc[-1])
            bb_lo   = _safe(ind["bb_lower"].iloc[-1])
            bb_mid  = _safe(ind["sma20"].iloc[-1])
            bb_wid  = _safe(ind["bb_width"].iloc[-1])

            if price is None or bb_up is None or bb_lo is None:
                continue

            pct_b = (price - bb_lo) / (bb_up - bb_lo) if (bb_up - bb_lo) > 0 else 0.5

            # Only include if near lower Bollinger Band OR RSI oversold
            bb_oversold  = pct_b < 0.15
            rsi_oversold = rsi is not None and rsi < 40

            if not bb_oversold and not rsi_oversold:
                continue

            # Severity: lower pct_b and lower RSI = more oversold
            severity = 0
            triggers = []
            if bb_oversold:
                severity += (0.15 - pct_b) * 10   # 0→1.5 pts
                triggers.append({
                    "name": "Bollinger Bands",
                    "detail": f"%B at {pct_b*100:.1f}% — price near lower band (${bb_lo:.2f})",
                    "type": "bollinger",
                })
            if rsi_oversold:
                severity += (40 - rsi) / 10        # 0→4 pts if RSI=0
                triggers.append({
                    "name": "RSI",
                    "detail": f"RSI at {rsi:.1f} — {'deeply ' if rsi < 30 else ''}oversold territory",
                    "type": "rsi",
                })

            # 1-week and 1-month price change
            week_chg = month_chg = None
            try:
                if len(df) >= 5:
                    week_chg = ((price - float(df["Close"].iloc[-6])) / float(df["Close"].iloc[-6])) * 100
                if len(df) >= 21:
                    month_chg = ((price - float(df["Close"].iloc[-22])) / float(df["Close"].iloc[-22])) * 100
            except Exception:
                pass

            results.append({
                "symbol":     sym,
                "price":      round(price, 2),
                "pct_b":      round(pct_b * 100, 1),
                "rsi":        round(rsi, 1) if rsi is not None else None,
                "bb_lower":   round(bb_lo, 2),
                "bb_upper":   round(bb_up, 2),
                "bb_mid":     round(bb_mid, 2) if bb_mid else None,
                "week_chg":   round(week_chg, 1) if week_chg is not None else None,
                "month_chg":  round(month_chg, 1) if month_chg is not None else None,
                "severity":   round(severity, 3),
                "triggers":   triggers,
            })
        except Exception:
            continue

    results.sort(key=lambda x: x["severity"], reverse=True)
    return results
