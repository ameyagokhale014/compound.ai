import { useState, useCallback } from "react";

const STORAGE_KEY = "holding_tags_v1";

export type StrategyTag = "none" | "growth_value" | "hyper_growth" | "speculative" | "etf_fund" | "crypto";

export interface TagMeta {
  id: StrategyTag;
  label: string;
  short: string;
  color: string;
  bg: string;
}

export const STRATEGY_TAGS: TagMeta[] = [
  { id: "none",         label: "None",                  short: "None",        color: "#555",    bg: "#1a1a1a" },
  { id: "growth_value", label: "Growth + Value",        short: "Growth",      color: "#4f8ef7", bg: "#0d1520" },
  { id: "hyper_growth", label: "Hyper Growth",          short: "Hyper",       color: "#00c805", bg: "#0a1a0a" },
  { id: "speculative",  label: "Speculative Moon Shot", short: "Spec",        color: "#ff5000", bg: "#2a0a0a" },
  { id: "etf_fund",     label: "ETF / Fund",            short: "ETF",         color: "#a78bfa", bg: "#1a0d2a" },
  { id: "crypto",       label: "Crypto",                short: "Crypto",      color: "#f7c44f", bg: "#1a1500" },
];

export const TAG_META: Record<StrategyTag, TagMeta> = Object.fromEntries(
  STRATEGY_TAGS.map((t) => [t.id, t])
) as Record<StrategyTag, TagMeta>;

export function useHoldingTags() {
  const [tags, setTagsState] = useState<Record<string, StrategyTag>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return {};
    }
  });

  const setTag = useCallback((symbol: string, tag: StrategyTag) => {
    setTagsState((prev) => {
      const next = { ...prev, [symbol]: tag };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { tags, setTag };
}
