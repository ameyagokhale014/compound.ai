import { useState, useEffect, useMemo } from "react";
import {
  RefreshCw, Zap, AlertTriangle, Eye, Briefcase,
  ChevronDown, ChevronUp, TrendingUp, TrendingDown,
  Minus, Calendar, Search,
} from "lucide-react";
import { getEarnings, refreshEarnings, analyzeEarnings, getEarningsCallSummary } from "../api";
import type { EarningsItem, EarningsAI, EarningsCallSummary, Portfolio } from "../api";
// Re-export Portfolio type is in types.ts, but api.ts imports from there too
import type { Portfolio as PortfolioType } from "../types";

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtPrice = (n: number | null) =>
  n != null ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
const fmtB = (n: number | null) =>
  n != null ? `$${(n / 1e9).toFixed(2)}B` : "—";
const fmtM = (n: number | null) =>
  n != null
    ? n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`
    : "—";

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Parse an earnings date string as a LOCAL calendar date (not UTC).
 *
 * yfinance returns dates like "2025-04-29T00:00:00" or "2025-04-29" — both
 * represent midnight UTC. If we feed that directly into `new Date()` JavaScript
 * converts it to local time, pushing it back to April 28 in any US timezone.
 * We strip the time portion and build the Date from year/month/day components
 * so it always means "April 29 in the user's local timezone."
 */
function parseLocalDate(dateStr: string): Date {
  const datePart = dateStr.split("T")[0]; // "2025-04-29"
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d);          // local midnight — no UTC shift
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const now  = new Date(); now.setHours(0, 0, 0, 0);
  const date = parseLocalDate(dateStr);
  return Math.round((date.getTime() - now.getTime()) / 86_400_000);
}

function daysLabel(d: number | null): string {
  if (d === null) return "Date TBD";
  if (d < 0)  return `${Math.abs(d)}d ago`;
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return `in ${d}d`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "TBD";
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function groupKey(dateStr: string | null): string {
  const d = daysUntil(dateStr);
  if (d === null)  return "z_unknown";
  if (d < 0)       return "a_past";
  if (d === 0)     return "b_today";
  if (d <= 7)      return "c_week";
  if (d <= 14)     return "d_next_week";
  if (d <= 31)     return "e_month";
  return "f_later";
}

const GROUP_LABELS: Record<string, string> = {
  a_past:     "Recently Reported",
  b_today:    "Today",
  c_week:     "This Week",
  d_next_week:"Next Week",
  e_month:    "This Month",
  f_later:    "Later",
  z_unknown:  "Date Unknown",
};

// ── Verdict style maps ────────────────────────────────────────────────────────
const PREDICT: Record<string, { bg: string; border: string; text: string; icon: React.ReactNode; label: string }> = {
  likely_up:   { bg: "bg-[#0a2a0a]", border: "border-[#00c805]", text: "text-[#00c805]", icon: <TrendingUp size={11}/>, label: "Likely Up"   },
  likely_down: { bg: "bg-[#2a0a0a]", border: "border-[#ff5000]", text: "text-[#ff5000]", icon: <TrendingDown size={11}/>, label: "Likely Down" },
  neutral:     { bg: "bg-[#1a1a1a]", border: "border-[#555]",    text: "text-[#8a8a8a]", icon: <Minus size={11}/>,       label: "Neutral"     },
  volatile:    { bg: "bg-[#261f00]", border: "border-[#f7c44f]", text: "text-[#f7c44f]", icon: <Zap size={11}/>,         label: "Volatile"    },
};

const ACTION: Record<string, { bg: string; text: string; label: string; emoji: string }> = {
  buy_before: { bg: "bg-[#0a2a0a]",  text: "text-[#00c805]", label: "Buy Before",   emoji: "🟢" },
  hold:       { bg: "bg-[#0d1520]",  text: "text-[#4f8ef7]", label: "Hold",         emoji: "🔵" },
  trim:       { bg: "bg-[#261f00]",  text: "text-[#f7c44f]", label: "Trim Position", emoji: "🟡" },
  avoid:      { bg: "bg-[#2a0a0a]",  text: "text-[#ff5000]", label: "Avoid / Exit", emoji: "🔴" },
};

const QUALITY: Record<string, { text: string; label: string }> = {
  strong: { text: "text-[#00c805]", label: "Strong Setup" },
  mixed:  { text: "text-[#f7c44f]", label: "Mixed Setup"  },
  weak:   { text: "text-[#ff5000]", label: "Weak Setup"   },
};

// ── Beat / miss badge row ─────────────────────────────────────────────────────
function BeatHistory({ history }: { history: EarningsItem["surprise_history"] }) {
  if (!history.length) return <span className="text-[#333] text-[10px]">No history</span>;
  const beats = history.filter(h => h.surprise_pct > 0).length;
  return (
    <div className="flex items-center gap-1.5">
      {history.slice(0, 4).map((h, i) => (
        <div
          key={i}
          title={`${h.date}: est $${h.eps_estimate} → $${h.eps_actual} (${h.surprise_pct > 0 ? "+" : ""}${h.surprise_pct.toFixed(1)}%)`}
          className={`w-4 h-4 rounded-sm flex items-center justify-center text-[8px] font-bold cursor-help ${
            h.surprise_pct > 5  ? "bg-[#00c805] text-black" :
            h.surprise_pct > 0  ? "bg-[#0a3a0a] text-[#00c805]" :
            h.surprise_pct > -5 ? "bg-[#3a0a0a] text-[#ff5000]" :
                                   "bg-[#ff5000] text-black"
          }`}
        >
          {h.surprise_pct > 0 ? "B" : "M"}
        </div>
      ))}
      <span className="text-[#555] text-[10px] ml-0.5">{beats}/{history.length} beats</span>
    </div>
  );
}

// ── Confidence bar ────────────────────────────────────────────────────────────
function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 8 ? "#00c805" : value >= 5 ? "#f7c44f" : "#ff5000";
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-sm"
            style={{ background: i < value ? color : "#1e1e1e" }}
          />
        ))}
      </div>
      <span className="text-[10px]" style={{ color }}>{value}/10</span>
    </div>
  );
}

// ── Call Summary panel ────────────────────────────────────────────────────────
const CALL_ACTION: Record<string, { bg: string; border: string; text: string; label: string; emoji: string }> = {
  buy:  { bg: "bg-[#071a07]", border: "border-[#1a3a1a]", text: "text-[#00c805]", label: "Buy",           emoji: "🟢" },
  hold: { bg: "bg-[#07101a]", border: "border-[#1a2a3a]", text: "text-[#4f8ef7]", label: "Hold",          emoji: "🔵" },
  trim: { bg: "bg-[#1a1400]", border: "border-[#3a2f00]", text: "text-[#f7c44f]", label: "Trim Position", emoji: "🟡" },
  sell: { bg: "bg-[#1a0707]", border: "border-[#3a1a1a]", text: "text-[#ff5000]", label: "Sell / Exit",   emoji: "🔴" },
};

const MGMT_TONE: Record<string, { color: string; label: string; emoji: string }> = {
  optimistic: { color: "text-[#00c805]", label: "Optimistic", emoji: "📈" },
  cautious:   { color: "text-[#f7c44f]", label: "Cautious",   emoji: "⚠️"  },
  neutral:    { color: "text-[#8a8a8a]", label: "Neutral",    emoji: "🔄"  },
  mixed:      { color: "text-[#f7a44f]", label: "Mixed",      emoji: "🔀"  },
};

// autoLoad=true → starts fetching immediately on mount (used for past earnings primary flow)
function CallSummaryPanel({ symbol, autoLoad = false }: { symbol: string; autoLoad?: boolean }) {
  const [summary, setSummary] = useState<EarningsCallSummary | null>(null);
  const [loading, setLoading] = useState(autoLoad);
  const [fetched, setFetched] = useState(false);

  async function fetchSummary() {
    setLoading(true);
    try {
      const res = await getEarningsCallSummary(symbol);
      setSummary(res as EarningsCallSummary);
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }

  // Auto-load on mount when flagged
  useEffect(() => {
    if (autoLoad) fetchSummary();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <RefreshCw size={18} className="text-[#a78bfa] animate-spin" />
        <div className="text-[#555] text-xs text-center">
          Analysing {symbol} earnings results…<br />
          <span className="text-[#333]">Reading financials, price reaction &amp; guidance</span>
        </div>
      </div>
    );
  }

  // ── Not yet triggered ──
  if (!fetched && !autoLoad) {
    return (
      <button
        onClick={fetchSummary}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-[#2a2a2a] text-[#555] text-xs hover:border-[#a78bfa] hover:text-[#a78bfa] transition-colors"
      >
        <Zap size={11} />
        Summarize most recent earnings call
      </button>
    );
  }

  // ── Error ──
  if (!summary || (summary as any).error) {
    return (
      <div className="flex items-center justify-between py-3 px-1">
        <span className="text-[#ff5000] text-xs">{(summary as any)?.error || "Failed to load. Check your API key in Profile Settings."}</span>
        <button onClick={fetchSummary} className="text-[#555] hover:text-[#888] text-[10px] flex items-center gap-1 shrink-0 ml-3">
          <RefreshCw size={9} /> Retry
        </button>
      </div>
    );
  }

  const act  = CALL_ACTION[summary.action] ?? CALL_ACTION.hold;
  const tone = MGMT_TONE[summary.management_tone] ?? MGMT_TONE.neutral;
  const rxn  = summary.price_reaction_pct;
  const surp = summary.eps_surprise_pct;

  return (
    <div className="space-y-3 pt-1">

      {/* ── Hero: headline + action ── */}
      <div className={`rounded-xl p-4 border ${act.bg} ${act.border}`}>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[#a78bfa] text-[10px] font-semibold uppercase tracking-wide">{summary.quarter} Results</span>
              <span className="text-[#444] text-[10px]">·</span>
              <span className="text-[#555] text-[10px]">{formatDate(summary.call_date)}</span>
            </div>
            <div className="text-white font-semibold text-sm leading-snug">{summary.headline}</div>
          </div>
          <div className={`shrink-0 text-center px-3 py-2 rounded-lg border ${act.bg} ${act.border}`}>
            <div className="text-lg">{act.emoji}</div>
            <div className={`text-[10px] font-bold ${act.text}`}>{act.label}</div>
          </div>
        </div>

        {/* Metrics pills */}
        <div className="flex flex-wrap gap-2 mt-2">
          {surp != null && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              surp > 0 ? "bg-[#00c80520] text-[#00c805] border border-[#00c80533]"
                       : "bg-[#ff500020] text-[#ff5000] border border-[#ff500033]"
            }`}>
              EPS {surp > 0 ? "Beat +" : "Miss "}{surp.toFixed(1)}%
            </span>
          )}
          {rxn != null && (
            <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              rxn >= 0 ? "bg-[#00c80520] text-[#00c805] border border-[#00c80533]"
                       : "bg-[#ff500020] text-[#ff5000] border border-[#ff500033]"
            }`}>
              {rxn >= 0 ? <TrendingUp size={9}/> : <TrendingDown size={9}/>}
              Stock {rxn >= 0 ? "+" : ""}{rxn.toFixed(1)}% after earnings
            </span>
          )}
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] ${tone.color}`}>
            {tone.emoji} {tone.label} tone
          </span>
        </div>
      </div>

      {/* ── What happened ── */}
      <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-3.5">
        <div className="text-[#555] text-[9px] uppercase tracking-widest mb-1.5">What Happened</div>
        <p className="text-[#aaa] text-xs leading-relaxed">{summary.what_happened}</p>
      </div>

      {/* ── vs Market Estimates ── */}
      <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-3.5">
        <div className="text-[#555] text-[9px] uppercase tracking-widest mb-1.5">vs Market Estimates</div>
        <p className="text-[#aaa] text-xs leading-relaxed">{summary.vs_estimates}</p>
      </div>

      {/* ── Key highlights ── */}
      {summary.key_highlights?.length > 0 && (
        <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-3.5">
          <div className="text-[#555] text-[9px] uppercase tracking-widest mb-2">Key Highlights from the Call</div>
          <div className="space-y-1.5">
            {summary.key_highlights.map((h, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-[#a78bfa] text-xs shrink-0 mt-0.5">✦</span>
                <span className="text-[#9a9a9a] text-xs leading-snug">{h}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Management Guidance ── */}
      {summary.guidance && (
        <div className="bg-[#071020] border border-[#1a2a4a] rounded-xl p-3.5">
          <div className="text-[#4f8ef7] text-[9px] uppercase tracking-widest mb-1.5">Management Guidance</div>
          <p className="text-[#7aabff] text-xs leading-relaxed">{summary.guidance}</p>
        </div>
      )}

      {/* ── Near + Long term outlook ── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-3">
          <div className="flex items-center gap-1 mb-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#f7c44f]" />
            <div className="text-[#f7c44f] text-[9px] uppercase tracking-widest">Near-Term (1–3 months)</div>
          </div>
          <p className="text-[#9a9a9a] text-[11px] leading-relaxed">{summary.near_term_outlook}</p>
        </div>
        <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-3">
          <div className="flex items-center gap-1 mb-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#4f8ef7]" />
            <div className="text-[#4f8ef7] text-[9px] uppercase tracking-widest">Long-Term (6–12 months)</div>
          </div>
          <p className="text-[#9a9a9a] text-[11px] leading-relaxed">{summary.long_term_outlook}</p>
        </div>
      </div>

      {/* ── Action reasoning ── */}
      <div className={`rounded-xl p-3.5 border ${act.bg} ${act.border}`}>
        <div className={`text-[9px] uppercase tracking-widest mb-1 ${act.text}`}>
          {act.emoji} What to do: {act.label}
        </div>
        <p className={`text-xs font-medium leading-relaxed ${act.text}`}>{summary.action_reasoning}</p>
      </div>

      {/* ── Risk ── */}
      <div className="bg-[#120606] border border-[#3a1212] rounded-xl p-3.5">
        <div className="text-[#ff5000] text-[9px] uppercase tracking-widest mb-1">⚠ Key Risk to Watch</div>
        <p className="text-[#cc5555] text-xs leading-relaxed">{summary.risk}</p>
      </div>

      <div className="flex justify-end pt-1">
        <button onClick={fetchSummary} disabled={loading}
          className="flex items-center gap-1 text-[#2a2a2a] hover:text-[#555] text-[9px] transition-colors">
          <RefreshCw size={8} /> Regenerate
        </button>
      </div>
    </div>
  );
}

// ── Single earnings card ──────────────────────────────────────────────────────
function EarningsCard({
  item,
  position,
  onAnalyze,
}: {
  item: EarningsItem & { ai_analysis: EarningsAI | null };
  position: { quantity: number; avg_cost: number; gain_loss: number; gain_loss_pct: number } | null;
  onAnalyze: () => void;
}) {
  const [expanded, setExpanded]       = useState(false);
  const [analyzing, setAnalyzing]     = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const days     = daysUntil(item.next_earnings_date);
  const isToday  = days === 0;
  const isPast   = days !== null && days < 0;
  const isUrgent = days !== null && days >= 0 && days <= 3;

  const ai   = item.ai_analysis;
  const pred = ai ? PREDICT[ai.price_move_prediction] : null;
  const act  = ai ? ACTION[ai.action]                 : null;
  const qual = ai ? QUALITY[ai.setup_quality]         : null;

  async function handleAnalyze() {
    setAnalyzing(true);
    try {
      await onAnalyze();
      setExpanded(true);
    } finally {
      setAnalyzing(false);
    }
  }

  function handleCardClick() {
    if (isPast) {
      // Past cards: primary expand = call summary
      setSummaryOpen(v => !v);
    } else if (ai) {
      setExpanded(v => !v);
    }
  }

  const upside = item.current_price && item.analyst_target
    ? ((item.analyst_target - item.current_price) / item.current_price) * 100
    : null;

  const hasSummaryHistory = item.surprise_history && item.surprise_history.length > 0;

  return (
    <div className={`bg-[#141414] border rounded-2xl overflow-hidden transition-all ${
      isToday  ? "border-[#f7c44f]" :
      isUrgent ? "border-[#2a3a2a]" :
      isPast   ? "border-[#2a1a3a]" :
                 "border-[#2a2a2a]"
    }`}>
      {/* ── Card header ── */}
      <div
        className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-[#1a1a1a] transition-colors"
        onClick={handleCardClick}
      >
        {/* Source badge */}
        <div className="shrink-0 mt-0.5">
          {item.source === "portfolio"
            ? <div className="w-6 h-6 rounded-lg bg-[#0d1a2a] flex items-center justify-center"><Briefcase size={11} className="text-[#4f8ef7]" /></div>
            : <div className="w-6 h-6 rounded-lg bg-[#1a1a2a] flex items-center justify-center"><Eye size={11} className="text-[#8a8a8a]" /></div>
          }
        </div>

        {/* Company info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-sm">{item.symbol}</span>
            {item.sector && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1a1a2a] text-[#4488ff] border border-[#1a1a2a]">
                {item.sector}
              </span>
            )}
            {isToday && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#261f00] text-[#f7c44f] font-semibold animate-pulse">
                Today
              </span>
            )}
            {isPast && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#1a0d2a] text-[#7755aa]">
                Reported
              </span>
            )}
          </div>
          <div className="text-[#555] text-[10px] truncate mt-0.5">{item.long_name}</div>

          {/* Data row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {item.current_price && (
              <span className="text-white text-xs font-semibold">{fmtPrice(item.current_price)}</span>
            )}
            {item.eps_estimate != null && (
              <span className="text-[#555] text-[10px]">EPS est. <span className="text-[#8a8a8a]">${item.eps_estimate.toFixed(2)}</span></span>
            )}
            {item.revenue_estimate != null && (
              <span className="text-[#555] text-[10px]">Rev est. <span className="text-[#8a8a8a]">{fmtM(item.revenue_estimate)}</span></span>
            )}
            {item.forward_pe != null && (
              <span className="text-[#555] text-[10px]">Fwd PE <span className="text-[#8a8a8a]">{item.forward_pe.toFixed(1)}x</span></span>
            )}
            {upside != null && (
              <span className={`text-[10px] ${upside > 0 ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                {upside > 0 ? "+" : ""}{upside.toFixed(1)}% to target
              </span>
            )}
          </div>

          {/* Beat history */}
          <div className="mt-2">
            <BeatHistory history={item.surprise_history} />
          </div>

          {/* Position context if held */}
          {position && (
            <div className="mt-2 flex items-center gap-2 text-[10px]">
              <span className="text-[#555]">Your position:</span>
              <span className="text-[#8a8a8a]">{position.quantity.toFixed(0)} shares @ {fmtPrice(position.avg_cost)}</span>
              <span className={position.gain_loss_pct >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}>
                {position.gain_loss_pct >= 0 ? "+" : ""}{position.gain_loss_pct.toFixed(1)}%
              </span>
            </div>
          )}

          {/* AI verdict summary (compact) — only relevant for upcoming */}
          {!isPast && ai && !ai.error && (
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              {pred && (
                <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${pred.bg} ${pred.text} ${pred.border}`}>
                  {pred.icon} {pred.label}
                  {ai.predicted_move_range && <span className="opacity-70 ml-1">{ai.predicted_move_range}</span>}
                </span>
              )}
              {act && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${act.bg} ${act.text}`}>
                  {act.emoji} {act.label}
                </span>
              )}
              {qual && (
                <span className={`text-[10px] ${qual.text}`}>{qual.label}</span>
              )}
              {/* Guidance bridge chip */}
              {ai.guidance_delivered && ai.guidance_delivered !== "unknown" && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                  ai.guidance_delivered === "ahead_of_guidance"
                    ? "bg-[#061a06] border-[#1a3a1a] text-[#44cc44]"
                    : ai.guidance_delivered === "on_track"
                    ? "bg-[#070f1a] border-[#1a2a3a] text-[#4f8ef7]"
                    : "bg-[#1a0808] border-[#3a1a1a] text-[#cc4444]"
                }`}>
                  {ai.guidance_delivered === "ahead_of_guidance" ? "✦ Ahead of guidance" :
                   ai.guidance_delivered === "on_track"          ? "→ On track" :
                                                                    "⚠ Behind guidance"}
                </span>
              )}
            </div>
          )}

          {/* Past card: hint to click for summary */}
          {isPast && !summaryOpen && (
            <div className="mt-2 flex items-center gap-1 text-[#3a2a5a] text-[10px]">
              <Zap size={9} className="text-[#5a3a8a]" />
              <span>Click to view earnings call summary &amp; action</span>
            </div>
          )}
        </div>

        {/* Right: date + actions */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          <div className="text-right">
            <div className={`text-xs font-semibold ${
              isToday ? "text-[#f7c44f]" : isUrgent ? "text-[#ff8c00]" : isPast ? "text-[#7755aa]" : "text-white"
            }`}>
              {formatDate(item.next_earnings_date)}
            </div>
            <div className={`text-[10px] ${
              isToday ? "text-[#f7c44f]" : isUrgent ? "text-[#f7944f]" : isPast ? "text-[#5a3a8a]" : "text-[#555]"
            }`}>
              {daysLabel(days)}
            </div>
          </div>

          {/* Action button — branches on past vs upcoming */}
          {isPast ? (
            /* Past: primary action = call summary */
            <button
              onClick={e => { e.stopPropagation(); setSummaryOpen(v => !v); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-semibold transition-colors ${
                summaryOpen
                  ? "bg-[#2a1a4a] border-[#5a3a8a] text-[#a78bfa]"
                  : "bg-[#1a0d2a] border-[#3a2a5a] text-[#7755aa] hover:border-[#5a3a8a] hover:text-[#a78bfa]"
              }`}
            >
              📊 {summaryOpen ? "Hide Summary" : "Last Call"}
            </button>
          ) : !ai ? (
            <button
              onClick={e => { e.stopPropagation(); handleAnalyze(); }}
              disabled={analyzing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#a78bfa] hover:bg-[#9370f0] disabled:opacity-50 text-white text-[10px] font-semibold transition-colors"
            >
              {analyzing
                ? <><RefreshCw size={10} className="animate-spin" /> Analyzing…</>
                : <><Zap size={10} /> Analyze</>
              }
            </button>
          ) : ai.error ? (
            <button
              onClick={e => { e.stopPropagation(); handleAnalyze(); }}
              disabled={analyzing}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[#333] text-[#555] text-[10px] hover:text-[#8a8a8a] transition-colors"
            >
              <RefreshCw size={9} /> Retry
            </button>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
              className="text-[#555] hover:text-[#8a8a8a] transition-colors"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* ── Past earnings: Call Summary as primary expanded content ── */}
      {isPast && summaryOpen && (
        <div className="border-t border-[#2a1a3a] px-4 py-4 bg-[#0a0810]">
          <CallSummaryPanel symbol={item.symbol} autoLoad={true} />
        </div>
      )}

      {/* ── Upcoming earnings: Forward-looking AI analysis panel ── */}
      {!isPast && expanded && ai && !ai.error && (
        <div className="border-t border-[#1e1e1e] px-4 py-4 space-y-4 bg-[#0d0d0d]">

          {/* ── Guidance bridge: last call → this call ── */}
          {ai.guidance_delivered && ai.guidance_delivered !== "unknown" && (
            <div className={`rounded-xl p-3.5 border ${
              ai.guidance_delivered === "ahead_of_guidance"
                ? "bg-[#061a06] border-[#1a3a1a]"
                : ai.guidance_delivered === "on_track"
                ? "bg-[#070f1a] border-[#1a2a3a]"
                : "bg-[#1a0808] border-[#3a1a1a]"
            }`}>
              <div className={`text-[9px] uppercase tracking-widest mb-1 flex items-center gap-2 ${
                ai.guidance_delivered === "ahead_of_guidance" ? "text-[#00c805]" :
                ai.guidance_delivered === "on_track"          ? "text-[#4f8ef7]" :
                                                                "text-[#ff5000]"
              }`}>
                <span>
                  {ai.guidance_delivered === "ahead_of_guidance" ? "✦ Tracking Ahead of Last Guidance" :
                   ai.guidance_delivered === "on_track"           ? "→ On Track vs Last Guidance" :
                                                                    "⚠ Behind Last Guidance"}
                </span>
              </div>
              <p className={`text-xs leading-relaxed ${
                ai.guidance_delivered === "ahead_of_guidance" ? "text-[#44aa44]" :
                ai.guidance_delivered === "on_track"          ? "text-[#7aabff]" :
                                                                "text-[#cc4444]"
              }`}>
                {ai.guidance_check_reasoning}
              </p>
            </div>
          )}

          {/* ── Beat/miss probability ── */}
          {ai.beat_probability && (
            <div>
              <div className="text-[#555] text-[9px] uppercase tracking-widest mb-2">Beat Probability This Call</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "EPS", value: ai.beat_probability.eps },
                  { label: "Revenue", value: ai.beat_probability.revenue },
                ].map(({ label, value }) => {
                  const prob = value?.toLowerCase().startsWith("high") ? "high"
                             : value?.toLowerCase().startsWith("medium") ? "medium" : "low";
                  const color = prob === "high" ? "text-[#00c805]" : prob === "medium" ? "text-[#f7c44f]" : "text-[#ff5000]";
                  const bg    = prob === "high" ? "bg-[#061a06] border-[#1a3a1a]" : prob === "medium" ? "bg-[#1a1400] border-[#3a2a00]" : "bg-[#1a0606] border-[#3a1010]";
                  return (
                    <div key={label} className={`rounded-xl p-3 border ${bg}`}>
                      <div className={`text-[9px] uppercase tracking-widest mb-1 ${color}`}>{label}</div>
                      <p className="text-[#7a7a7a] text-[11px] leading-snug">{value}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Confidence ── */}
          <div className="flex items-center justify-between">
            <span className="text-[#555] text-[10px] uppercase tracking-widest">AI Confidence</span>
            <ConfidenceBar value={ai.confidence} />
          </div>

          {/* ── Reasoning (bridges last call → this call) ── */}
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-widest mb-1.5">Analysis</div>
            <p className="text-[#8a8a8a] text-xs leading-relaxed">{ai.reasoning}</p>
          </div>

          {/* ── What to watch ── */}
          {ai.what_to_watch?.length > 0 && (
            <div className="bg-[#07101a] border border-[#1a2a3a] rounded-xl p-3.5">
              <div className="text-[#4f8ef7] text-[9px] uppercase tracking-widest mb-2">What to Watch This Call</div>
              <div className="space-y-2">
                {ai.what_to_watch.map((w, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[#4f8ef7] text-[10px] mt-0.5 shrink-0 font-bold">{i + 1}.</span>
                    <span className="text-[#8aabcc] text-xs leading-snug">{w}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Risk / Catalyst row ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#1a0808] border border-[#3a1a1a] rounded-xl p-3">
              <div className="text-[#ff5000] text-[9px] uppercase tracking-widest mb-1">⚠ Key Risk</div>
              <p className="text-[#cc4444] text-[10px] leading-relaxed">{ai.key_risk}</p>
            </div>
            <div className="bg-[#081a08] border border-[#1a3a1a] rounded-xl p-3">
              <div className="text-[#00c805] text-[9px] uppercase tracking-widest mb-1">✦ Key Catalyst</div>
              <p className="text-[#44aa44] text-[10px] leading-relaxed">{ai.key_catalyst}</p>
            </div>
          </div>

          {/* ── Re-analyze button ── */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[#333] text-[9px]">
              {item.last_analyzed ? `Analyzed ${new Date(item.last_analyzed).toLocaleDateString()}` : ""}
            </span>
            <button
              onClick={() => handleAnalyze()}
              disabled={analyzing}
              className="flex items-center gap-1 text-[#333] hover:text-[#555] text-[10px] transition-colors disabled:opacity-40"
            >
              <RefreshCw size={9} className={analyzing ? "animate-spin" : ""} /> Refresh analysis
            </button>
          </div>
        </div>
      )}

      {/* ── Upcoming earnings: Last Call Summary as secondary collapsible ── */}
      {!isPast && hasSummaryHistory && (
        <div className="border-t border-[#1e1e1e]">
          <button
            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-[#111] transition-colors group"
            onClick={() => setSummaryOpen(v => !v)}
          >
            <div className="flex items-center gap-2">
              <Zap size={11} className="text-[#a78bfa]" />
              <span className="text-[#555] text-[10px] font-medium group-hover:text-[#8a8a8a] transition-colors">
                Last Earnings Call Summary
              </span>
              <span className="text-[#2a2a2a] text-[9px]">
                {formatDate(item.surprise_history[0].date)}
              </span>
            </div>
            {summaryOpen
              ? <ChevronUp size={12} className="text-[#444]" />
              : <ChevronDown size={12} className="text-[#333]" />
            }
          </button>
          {summaryOpen && (
            <div className="px-4 pb-4 bg-[#080808]">
              <CallSummaryPanel symbol={item.symbol} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main EarningsTab ──────────────────────────────────────────────────────────
export default function EarningsTab({ portfolios }: { portfolios: PortfolioType[] }) {
  const [items,      setItems]      = useState<(EarningsItem & { ai_analysis: EarningsAI | null })[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter,     setFilter]     = useState<"all" | "portfolio" | "watchlist">("all");
  const [search,     setSearch]     = useState("");

  useEffect(() => {
    getEarnings()
      .then(data => setItems(data as any))
      .finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshEarnings();
      const data = await getEarnings();
      setItems(data as any);
    } finally {
      setRefreshing(false);
    }
  }

  // Build position lookup from real portfolios
  const positionMap = useMemo(() => {
    const map: Record<string, { quantity: number; avg_cost: number; gain_loss: number; gain_loss_pct: number }> = {};
    for (const p of portfolios) {
      for (const h of p.holdings) {
        if (!h.symbol || h.asset_type === "cash") continue;
        // Accumulate across portfolios (user may hold the same symbol in multiple accounts)
        if (!map[h.symbol]) {
          map[h.symbol] = {
            quantity:      h.total_quantity,
            avg_cost:      h.avg_cost,
            gain_loss:     h.gain_loss,
            gain_loss_pct: h.gain_loss_pct,
          };
        } else {
          // Merge: add quantities and costs, recompute avg_cost and gain/loss
          const prev = map[h.symbol];
          const totalQty  = prev.quantity + h.total_quantity;
          const totalCost = prev.quantity * prev.avg_cost + h.total_quantity * h.avg_cost;
          const totalGl   = prev.gain_loss + h.gain_loss;
          const totalCostBasis = totalQty > 0 ? totalCost : 1;
          map[h.symbol] = {
            quantity:      totalQty,
            avg_cost:      totalQty > 0 ? totalCost / totalQty : 0,
            gain_loss:     totalGl,
            gain_loss_pct: totalCostBasis > 0 ? (totalGl / (totalQty * (totalQty > 0 ? totalCost / totalQty : 1))) * 100 : 0,
          };
        }
      }
    }
    return map;
  }, [portfolios]);

  // Filter + search
  const filtered = useMemo(() => {
    let list = items;
    if (filter !== "all") list = list.filter(i => i.source === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.symbol.toLowerCase().includes(q) ||
        i.long_name.toLowerCase().includes(q) ||
        (i.sector || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, filter, search]);

  // Group by time period
  const groups = useMemo(() => {
    const map: Record<string, typeof filtered> = {};
    for (const item of filtered) {
      const key = groupKey(item.next_earnings_date);
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    // Sort within each group by date
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        if (!a.next_earnings_date) return 1;
        if (!b.next_earnings_date) return -1;
        return a.next_earnings_date.localeCompare(b.next_earnings_date);
      });
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Handler: run AI analysis for one item and merge result back
  function makeAnalyzeHandler(item: EarningsItem) {
    return async () => {
      const pos = positionMap[item.symbol];
      const result = await analyzeEarnings(item.symbol, pos ?? undefined);
      setItems(prev => prev.map(i =>
        i.symbol === item.symbol ? { ...i, ai_analysis: result as EarningsAI } : i
      ));
    };
  }

  // Summary counts
  const upcoming   = items.filter(i => { const d = daysUntil(i.next_earnings_date); return d !== null && d >= 0; });
  const thisWeek   = upcoming.filter(i => { const d = daysUntil(i.next_earnings_date); return d !== null && d <= 7; });
  const analyzed   = items.filter(i => i.ai_analysis && !i.ai_analysis.error);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={20} className="text-[#555] animate-spin" />
          <div className="text-[#555] text-sm">Loading earnings calendar…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">

      {/* ── Header ── */}
      <div className="bg-[#141414] border-b border-[#2a2a2a] px-6 py-5">
        <div className="max-w-[1200px] mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#1a1a2a] flex items-center justify-center">
                <Calendar size={16} className="text-[#a78bfa]" />
              </div>
              <div>
                <div className="text-white font-bold text-lg">Earnings Intelligence</div>
                <div className="text-[#555] text-xs">AI-powered earnings analysis for your portfolio &amp; watchlist</div>
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#2a2a2a] text-[#555] text-xs hover:text-[#8a8a8a] hover:border-[#444] transition-colors disabled:opacity-40"
            >
              <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {/* Summary strip */}
          <div className="flex items-center gap-6">
            <div>
              <div className="text-[#555] text-[10px] uppercase tracking-widest">Upcoming</div>
              <div className="text-white font-bold text-xl">{upcoming.length}</div>
            </div>
            <div className="w-px h-8 bg-[#2a2a2a]" />
            <div>
              <div className="text-[#555] text-[10px] uppercase tracking-widest">This Week</div>
              <div className={`font-bold text-xl ${thisWeek.length > 0 ? "text-[#f7c44f]" : "text-white"}`}>
                {thisWeek.length}
              </div>
            </div>
            <div className="w-px h-8 bg-[#2a2a2a]" />
            <div>
              <div className="text-[#555] text-[10px] uppercase tracking-widest">Tracked</div>
              <div className="text-white font-bold text-xl">{items.length}</div>
            </div>
            <div className="w-px h-8 bg-[#2a2a2a]" />
            <div>
              <div className="text-[#555] text-[10px] uppercase tracking-widest">Analyzed</div>
              <div className="text-[#a78bfa] font-bold text-xl">{analyzed.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Filter / search bar ── */}
      <div className="border-b border-[#1a1a1a] px-6 py-3 bg-[#0d0d0d]">
        <div className="max-w-[1200px] mx-auto flex items-center gap-3">
          {/* Filter tabs */}
          <div className="flex rounded-xl overflow-hidden border border-[#2a2a2a]">
            {(["all", "portfolio", "watchlist"] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-[10px] font-medium capitalize transition-colors ${
                  filter === f
                    ? "bg-[#222] text-white"
                    : "bg-[#0d0d0d] text-[#555] hover:text-[#8a8a8a]"
                }`}
              >
                {f === "portfolio" ? "📈 Portfolio" : f === "watchlist" ? "👁 Watchlist" : "All"}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#333]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search symbol or sector…"
              className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl pl-8 pr-3 py-1.5 text-white text-xs focus:outline-none focus:border-[#444] placeholder-[#333]"
            />
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 ml-auto text-[10px] text-[#444]">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[#00c805] inline-block" /> Beat</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[#ff5000] inline-block" /> Miss</span>
            <span className="flex items-center gap-1"><Zap size={10} className="text-[#a78bfa]" /> AI Analyzed</span>
          </div>
        </div>
      </div>

      {/* ── Calendar groups ── */}
      <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-8">
        {groups.length === 0 && (
          <div className="text-center py-20">
            <Calendar size={32} className="text-[#2a2a2a] mx-auto mb-3" />
            <div className="text-[#555] text-sm">No earnings found</div>
            <div className="text-[#333] text-xs mt-1">
              {search ? "Try a different search" : "Add stocks to your portfolio or watchlist"}
            </div>
          </div>
        )}

        {groups.map(([key, groupItems]) => {
          const label = GROUP_LABELS[key] ?? key;
          const isHighlight = key === "b_today" || key === "c_week";

          return (
            <div key={key}>
              {/* Group header */}
              <div className="flex items-center gap-3 mb-4">
                <div className={`text-xs font-bold uppercase tracking-widest ${
                  key === "b_today" ? "text-[#f7c44f]" :
                  key === "c_week"  ? "text-[#ff8c00]" :
                  key === "a_past"  ? "text-[#333]" :
                                      "text-[#555]"
                }`}>
                  {label}
                </div>
                <div className={`flex-1 h-px ${isHighlight ? "bg-[#2a2a2a]" : "bg-[#1a1a1a]"}`} />
                <div className="text-[#333] text-[10px]">{groupItems.length} {groupItems.length === 1 ? "company" : "companies"}</div>
              </div>

              {/* Cards grid */}
              <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
                {groupItems.map(item => (
                  <EarningsCard
                    key={item.symbol}
                    item={item}
                    position={positionMap[item.symbol] ?? null}
                    onAnalyze={makeAnalyzeHandler(item)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer note ── */}
      <div className="max-w-[1200px] mx-auto px-6 pb-10">
        <div className="flex items-start gap-2 bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-3">
          <AlertTriangle size={13} className="text-[#333] shrink-0 mt-0.5" />
          <p className="text-[#333] text-[10px] leading-relaxed">
            Earnings dates and estimates are sourced from Yahoo Finance and may be approximate. AI analysis is for informational purposes only and does not constitute financial advice. Past surprise patterns do not guarantee future results.
          </p>
        </div>
      </div>
    </div>
  );
}
