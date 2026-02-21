from __future__ import annotations
from typing import Optional


def safe_div(a: Optional[float], b: Optional[float]) -> Optional[float]:
    try:
        if a is None or b is None:
            return None
        if b == 0:
            return None
        return a / b
    except Exception:
        return None


def compute_growth(current: float, previous: float) -> Optional[float]:
    """
    Returns growth in PERCENT.
    """
    if current is None or previous is None:
        return None
    if previous == 0:
        return None
    return ((current - previous) / abs(previous)) * 100


def compute_cagr(latest: float, earliest: float, years: int) -> Optional[float]:
    """
    CAGR returned in PERCENT.
    """
    if latest is None or earliest is None or years <= 0:
        return None
    if earliest <= 0:
        return None
    try:
        return ((latest / earliest) ** (1 / years) - 1) * 100
    except Exception:
        return None


def compute_peg(pe: Optional[float], growth_percent: Optional[float]) -> Optional[float]:
    """
    PEG = PE / Growth%
    Growth must be percent (e.g., 30 for 30%)
    """
    if pe is None or growth_percent is None:
        return None
    if growth_percent <= 0:
        return None
    return pe / growth_percent


def compute_price_to_fair_value(price: float, fair_value: float) -> Optional[float]:
    if price is None or fair_value is None:
        return None
    if fair_value == 0:
        return None
    return price / fair_value
