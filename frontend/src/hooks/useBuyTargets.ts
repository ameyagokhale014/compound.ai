import { useState, useEffect } from "react";
import type { CachedBuyTarget } from "../types";
import { getCachedBuyTargets } from "../api";

export function useBuyTargets(symbols: string[]): Map<string, CachedBuyTarget> {
  const [targets, setTargets] = useState<Map<string, CachedBuyTarget>>(new Map());
  const key = symbols.slice().sort().join(",");

  useEffect(() => {
    if (symbols.length === 0) return;
    getCachedBuyTargets(symbols)
      .then((data) => {
        const map = new Map<string, CachedBuyTarget>();
        for (const t of data) map.set(t.symbol, t);
        setTargets(map);
      })
      .catch(() => {});
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return targets;
}
