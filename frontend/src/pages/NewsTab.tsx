import { useState, useEffect, useMemo, useCallback } from "react";
import { RefreshCw, ExternalLink, Clock, TrendingUp, TrendingDown, Minus, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { NewsItem, Portfolio, RealEstateProperty } from "../types";
import { getNews, refreshNews, getNewsLastRefresh } from "../api";

interface Props {
  portfolios: Portfolio[];
  properties: RealEstateProperty[];
  onViewStock?: (symbol: string) => void;
}

// ─── Impact badge ─────────────────────────────────────────────────────────────
const IMPACT_STYLE: Record<string, { bg: string; border: string; text: string; icon: typeof TrendingUp }> = {
  "Very Bullish": { bg: "bg-[#071a07]", border: "border-[#00c805]", text: "text-[#00c805]", icon: TrendingUp },
  "Bullish":      { bg: "bg-[#0a1f0a]", border: "border-[#4dbb50]", text: "text-[#4dbb50]", icon: TrendingUp },
  "Neutral":      { bg: "bg-[#141414]", border: "border-[#333]",    text: "text-[#777]",    icon: Minus },
  "Bearish":      { bg: "bg-[#1f0a0a]", border: "border-[#cc3300]", text: "text-[#cc3300]", icon: TrendingDown },
  "Very Bearish": { bg: "bg-[#2a0505]", border: "border-[#ff2200]", text: "text-[#ff4444]", icon: TrendingDown },
};

const ACTION_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  consider_buying:  { bg: "bg-[#0a2a0a]", text: "text-[#00c805]",  label: "Consider Buying" },
  monitor:          { bg: "bg-[#261f00]", text: "text-[#f7c44f]",  label: "Monitor" },
  consider_selling: { bg: "bg-[#2a0a0a]", text: "text-[#ff5000]",  label: "Consider Selling" },
};

function timeAgo(isoStr: string) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function scoreColor(score: number | null) {
  if (score == null) return "#555";
  if (score >= 4)   return "#00c805";
  if (score >= 1.5) return "#4dbb50";
  if (score > -1.5) return "#777";
  if (score > -4)   return "#cc3300";
  return "#ff4444";
}

// ─── Single news card ─────────────────────────────────────────────────────────
function NewsCard({ item, onViewStock }: { item: NewsItem; onViewStock?: (sym: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const label = item.impact_label ?? "Neutral";
  const style = IMPACT_STYLE[label] ?? IMPACT_STYLE["Neutral"];
  const Icon  = style.icon;
  const scoreVal = item.impact_score;

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${style.bg} ${style.border}`}>
      {/* Header row */}
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {/* Score ring */}
          <div className="shrink-0 flex flex-col items-center mt-0.5">
            <div
              className="w-9 h-9 rounded-full border-2 flex items-center justify-center text-[11px] font-bold tabular-nums"
              style={{ borderColor: scoreColor(scoreVal), color: scoreColor(scoreVal), backgroundColor: `${scoreColor(scoreVal)}18` }}
            >
              {scoreVal != null ? (scoreVal >= 0 ? `+${scoreVal.toFixed(0)}` : scoreVal.toFixed(0)) : "—"}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            {/* Title */}
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white text-sm font-medium leading-snug hover:text-[#4f8ef7] transition-colors flex items-start gap-1 group"
            >
              <span className="flex-1">{item.title}</span>
              <ExternalLink size={11} className="shrink-0 opacity-0 group-hover:opacity-100 mt-0.5 transition-opacity" />
            </a>

            {/* Meta row */}
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
              {/* Symbol chip */}
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#222] ${item.asset_type === "real_estate" ? "text-[#00c805]" : "text-[#4f8ef7]"} ${onViewStock && item.asset_type !== "real_estate" ? "cursor-pointer hover:bg-[#2a2a2a]" : ""}`}
                onClick={() => item.asset_type !== "real_estate" && onViewStock?.(item.symbol)}
              >
                {item.asset_type === "real_estate" ? "🏠 RE Market" : item.symbol}
              </span>

              {/* Impact badge */}
              <span className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${style.bg} ${style.border} ${style.text}`}>
                <Icon size={9} />
                {label}
              </span>

              {/* Action badge */}
              {item.action_required && ACTION_STYLE[item.action_required] && (
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${ACTION_STYLE[item.action_required].bg} ${ACTION_STYLE[item.action_required].text}`}>
                  {ACTION_STYLE[item.action_required].label}
                </span>
              )}

              {/* Publisher + time */}
              <span className="text-[#444] text-[10px] ml-auto flex items-center gap-1">
                <Clock size={9} />
                {item.publisher ? `${item.publisher} · ` : ""}{timeAgo(item.published_at)}
              </span>
            </div>
          </div>
        </div>

        {/* Impact summary */}
        {item.impact_summary && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-2 ml-12 w-[calc(100%-3rem)] text-left"
          >
            <div className={`text-xs leading-relaxed ${style.text} opacity-80 ${!expanded ? "line-clamp-1" : ""}`}>
              {item.impact_summary}
            </div>
            {item.impact_summary.length > 90 && (
              <span className="text-[10px] text-[#444] flex items-center gap-0.5 mt-0.5">
                {expanded ? <><ChevronUp size={9} /> Show less</> : <><ChevronDown size={9} /> Show more</>}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Filter types ─────────────────────────────────────────────────────────────
type FilterMode = "all" | "high_impact" | "action_needed" | string; // string = symbol filter

// ─── Main component ───────────────────────────────────────────────────────────
export default function NewsTab({ portfolios, properties, onViewStock }: Props) {
  const [news, setNews]             = useState<NewsItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [filter, setFilter]         = useState<FilterMode>("all");

  const hasRE = properties.length > 0;

  // All unique stock symbols from portfolios (not cash)
  const stockSymbols = useMemo(() => {
    const s = new Set<string>();
    for (const p of portfolios) {
      for (const h of p.holdings) {
        if (h.asset_type !== "cash") s.add(h.symbol);
      }
    }
    return Array.from(s);
  }, [portfolios]);

  const fetchNews = useCallback(async () => {
    if (!stockSymbols.length && !hasRE) { setLoading(false); return; }
    try {
      const [data, refresh] = await Promise.all([
        getNews(stockSymbols, hasRE, 150),
        getNewsLastRefresh(),
      ]);
      setNews(data);
      setLastRefresh(refresh.last_refresh);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [stockSymbols.join(","), hasRE]);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchNews]);

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      await refreshNews();
      await fetchNews();
    } finally {
      setRefreshing(false);
    }
  }

  // Build per-symbol counts for filter chips
  const symbolCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of news) {
      m.set(n.symbol, (m.get(n.symbol) ?? 0) + 1);
    }
    return m;
  }, [news]);

  const filtered = useMemo(() => {
    let items = [...news];
    if (filter === "high_impact") {
      items = items.filter(n => n.impact_score != null && Math.abs(n.impact_score) >= 3);
    } else if (filter === "action_needed") {
      items = items.filter(n => n.action_required != null);
    } else if (filter !== "all") {
      items = items.filter(n => n.symbol === filter);
    }
    return items;
  }, [news, filter]);

  const actionCount  = news.filter(n => n.action_required).length;
  const highImpCount = news.filter(n => n.impact_score != null && Math.abs(n.impact_score) >= 3).length;

  // Unique symbols in current news (for filter chips)
  const newsSymbols = useMemo(() => {
    const seen = new Set<string>();
    for (const n of news) seen.add(n.symbol);
    return Array.from(seen).sort();
  }, [news]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-[#555] text-sm animate-pulse">Loading news…</div>
      </div>
    );
  }

  if (!stockSymbols.length && !hasRE) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">📰</div>
          <div className="text-white font-semibold mb-1">No positions yet</div>
          <div className="text-[#555] text-sm">Add holdings to see personalised news.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-[900px] mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Portfolio News</h1>
            <p className="text-[#555] text-sm mt-0.5">
              {news.length} articles · only news on {stockSymbols.length} stock{stockSymbols.length !== 1 ? "s" : ""} you own{hasRE ? " + real estate market" : ""}
            </p>
            {lastRefresh && (
              <p className="text-[#3a3a3a] text-xs mt-0.5 flex items-center gap-1">
                <Clock size={10} /> Last refreshed {timeAgo(lastRefresh)} · auto-refreshes every 5 min
              </p>
            )}
          </div>
          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 bg-[#1a1a1a] border border-[#2a2a2a] text-[#8a8a8a] hover:text-white hover:border-[#444] text-xs px-3 py-2 rounded-xl transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap mb-5">
          {[
            { key: "all",          label: `All (${news.length})` },
            { key: "high_impact",  label: `High Impact (${highImpCount})` },
            { key: "action_needed",label: `Action Needed (${actionCount})`, warn: actionCount > 0 },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as FilterMode)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filter === f.key
                  ? "bg-[#222] text-white border-[#444]"
                  : f.warn
                    ? "bg-[#1a0a0a] text-[#ff8800] border-[#3a2010] hover:border-[#554020]"
                    : "text-[#555] border-[#222] hover:text-[#8a8a8a] hover:border-[#333]"
              }`}
            >
              {f.warn && "⚠ "}{f.label}
            </button>
          ))}

          <div className="w-px h-4 bg-[#222] mx-1" />

          {/* Per-symbol chips */}
          {newsSymbols.map(sym => {
            const isRE = sym === "RDFN" || sym === "Z" || sym === "VNQ" || sym === "IYR" || sym === "REXR";
            return (
              <button
                key={sym}
                onClick={() => setFilter(filter === sym ? "all" : sym)}
                className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors ${
                  filter === sym
                    ? "bg-[#4f8ef7] text-white border-[#4f8ef7]"
                    : isRE
                      ? "text-[#00c805] border-[#00c80530] hover:border-[#00c80560]"
                      : "text-[#555] border-[#222] hover:text-[#8a8a8a]"
                }`}
              >
                {isRE ? "🏠" : ""}{sym} {symbolCounts.get(sym) ? `(${symbolCounts.get(sym)})` : ""}
              </button>
            );
          })}
        </div>

        {/* News feed */}
        {filtered.length === 0 ? (
          <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-12 text-center">
            <div className="text-[#444] text-4xl mb-3">📭</div>
            <div className="text-white font-semibold mb-1">No news matching this filter</div>
            <div className="text-[#555] text-sm">Try "All" or refresh to fetch the latest articles.</div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(item => (
              <NewsCard key={`${item.symbol}-${item.id}`} item={item} onViewStock={onViewStock} />
            ))}
          </div>
        )}

        {/* Source attribution */}
        <div className="mt-6 text-center text-[#2a2a2a] text-xs">
          News sourced via Yahoo Finance (Reuters, AP, Bloomberg, Barron's) · Refreshed every 5 minutes
        </div>
      </div>
    </div>
  );
}
