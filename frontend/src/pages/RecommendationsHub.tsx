import { useState, useEffect, useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, ExternalLink, Clock, Sparkles, Info, ChevronDown, ChevronUp, Zap } from "lucide-react";
import type { Portfolio, RealEstateProperty, CachedBuyTarget, NewsItem } from "../types";
import { useBuyTargets } from "../hooks/useBuyTargets";
import { computeWealthScore, type PillarScore, type Recommendation } from "../utils/wealthScore";
import { getNews, getNewsLastRefresh, getSignalAlerts, getOversoldScan } from "../api";
import type { SignalAlert, OversoldSignal } from "../api";

interface Props {
  portfolios: Portfolio[];
  properties: RealEstateProperty[];
  sectors: Record<string, string>;
  onViewStock?: (symbol: string) => void;
}

// ─── Gauge ring ───────────────────────────────────────────────────────────────
const CX = 70, CY = 70, R = 58, STROKE = 10;
const GAUGE_START = 135, GAUGE_ARC = 270;

function toRad(deg: number) { return ((deg - 90) * Math.PI) / 180; }
function pt(deg: number) {
  return { x: CX + R * Math.cos(toRad(deg)), y: CY + R * Math.sin(toRad(deg)) };
}
function arcPath(start: number, end: number) {
  const s = pt(start), e = pt(end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${s.x.toFixed(3)} ${s.y.toFixed(3)} A ${R} ${R} 0 ${large} 1 ${e.x.toFixed(3)} ${e.y.toFixed(3)}`;
}

function GaugeRing({ score, color }: { score: number; color: string }) {
  const fillAngle = (Math.min(score, 100) / 100) * GAUGE_ARC;
  return (
    <svg width={140} height={140} className="shrink-0">
      <path d={arcPath(GAUGE_START, GAUGE_START + GAUGE_ARC)} fill="none" stroke="#222" strokeWidth={STROKE} strokeLinecap="round" />
      {fillAngle > 0 && (
        <path d={arcPath(GAUGE_START, GAUGE_START + fillAngle)} fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color}88)` }} />
      )}
      <text x={CX} y={CY - 4} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={28} fontWeight={700} fontFamily="inherit">{score}</text>
      <text x={CX} y={CY + 20} textAnchor="middle" dominantBaseline="middle" fill="#666" fontSize={11} fontFamily="inherit">out of 100</text>
    </svg>
  );
}

// ─── Pillar bar ───────────────────────────────────────────────────────────────
function PillarBar({ pillar }: { pillar: PillarScore }) {
  const [open, setOpen] = useState(false);
  const pct = pillar.maxScore > 0 ? (pillar.score / pillar.maxScore) * 100 : 0;
  const barColor = pct >= 80 ? "#00c805" : pct >= 60 ? "#4dbb50" : pct >= 40 ? "#f7c44f" : pct >= 20 ? "#ff8800" : "#ff4444";
  return (
    <div>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-3 group">
        <span className="text-base shrink-0">{pillar.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate pr-2">{pillar.name}</span>
            <span className="text-xs tabular-nums shrink-0" style={{ color: barColor }}>{pillar.score}<span className="text-[#444]">/{pillar.maxScore}</span></span>
          </div>
          <div className="h-1.5 bg-[#222] rounded-full overflow-hidden">
            <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: barColor }} />
          </div>
        </div>
        <span className="text-[#444] shrink-0">{open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</span>
      </button>
      {open && (
        <div className="ml-7 mt-2 space-y-1 pb-1">
          {pillar.details.map((d, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-[#4dbb50]"><span className="mt-0.5">✓</span><span>{d}</span></div>
          ))}
          {pillar.gaps.map((g, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-[#888]"><span className="mt-0.5">→</span><span>{g}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Rubric ───────────────────────────────────────────────────────────────────
const RUBRIC = [
  { name: "Diversification",      max: 25, desc: "Asset classes, sector spread, single-holding concentration" },
  { name: "Cash Management",      max: 20, desc: "Idle cash as % of net worth — ideal range is 3-8%" },
  { name: "Buy Discipline",       max: 20, desc: "Weighted % of portfolio value at/below buy targets" },
  { name: "Retirement Readiness", max: 20, desc: "Has accounts + retirement % of total investable assets" },
  { name: "Portfolio Health",     max: 15, desc: "Real estate equity, unrealized gains, account structure" },
];

// ─── Score recommendation card ────────────────────────────────────────────────
const PRIORITY_STYLE = {
  high:   { badge: "bg-[#2a0a0a] text-[#ff5000] border border-[#3a1a1a]", label: "High Impact" },
  medium: { badge: "bg-[#261f00] text-[#f7c44f] border border-[#362f10]", label: "Medium Impact" },
  low:    { badge: "bg-[#141414] text-[#666]    border border-[#2a2a2a]", label: "Low Impact" },
};

function ScoreRecCard({ rec }: { rec: Recommendation }) {
  const ps = PRIORITY_STYLE[rec.priority];
  return (
    <div className="bg-[#0d0d0d] border border-[#222] rounded-xl p-4 flex gap-3">
      <div className="text-xl shrink-0 mt-0.5">{rec.emoji}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="text-white text-sm font-semibold leading-snug">{rec.title}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {rec.potentialGain > 0 && (
              <span className="text-[10px] font-semibold text-[#4f8ef7] bg-[#0d1a2a] border border-[#1a2a3a] px-1.5 py-0.5 rounded tabular-nums whitespace-nowrap">
                +{rec.potentialGain} pts
              </span>
            )}
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${ps.badge}`}>{ps.label}</span>
          </div>
        </div>
        <p className="text-[#666] text-xs leading-relaxed">{rec.detail}</p>
        <div className="mt-1.5"><span className="text-[10px] text-[#444]">{rec.pillar}</span></div>
      </div>
    </div>
  );
}

// ─── News-driven recommendation card ─────────────────────────────────────────
const ACTION_CONFIG: Record<string, { label: string; color: string; Icon: typeof TrendingUp; urgency: string }> = {
  consider_buying:  { label: "Consider Buying",  color: "#00c805", Icon: TrendingUp,   urgency: "Opportunity" },
  consider_selling: { label: "Consider Selling", color: "#ff5000", Icon: TrendingDown, urgency: "Risk Alert"  },
  monitor:          { label: "Monitor",          color: "#f7c44f", Icon: Minus,        urgency: "Watch"       },
};

function NewsRecCard({ item, onViewStock }: { item: NewsItem; onViewStock?: (sym: string) => void }) {
  const cfg = item.action_required ? ACTION_CONFIG[item.action_required] : null;
  if (!cfg) return null;
  const { Icon } = cfg;

  function timeAgo(isoStr: string) {
    const diff = Date.now() - new Date(isoStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  return (
    <div className="bg-[#0d0d0d] border border-[#222] rounded-xl p-4 flex gap-3"
      style={{ borderLeftColor: cfg.color, borderLeftWidth: 3 }}>
      <div className="shrink-0 mt-0.5">
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${cfg.color}18` }}>
          <Icon size={14} style={{ color: cfg.color }} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${item.asset_type !== "real_estate" ? "cursor-pointer hover:opacity-80" : ""}`}
              style={{ backgroundColor: `${cfg.color}18`, color: cfg.color }}
              onClick={() => item.asset_type !== "real_estate" && onViewStock?.(item.symbol)}
            >
              {item.asset_type === "real_estate" ? "🏠 RE Market" : item.symbol}
            </span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border"
              style={{ color: cfg.color, borderColor: `${cfg.color}40`, backgroundColor: `${cfg.color}10` }}>
              {cfg.urgency}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-[#444] shrink-0">
            <Clock size={9} />{timeAgo(item.published_at)}
          </div>
        </div>

        <a href={item.url} target="_blank" rel="noopener noreferrer"
          className="text-white text-xs font-medium hover:text-[#4f8ef7] transition-colors flex items-start gap-1 group mb-1.5">
          <span className="flex-1 line-clamp-2">{item.title}</span>
          <ExternalLink size={10} className="shrink-0 opacity-0 group-hover:opacity-100 mt-0.5 transition-opacity" />
        </a>

        {item.impact_summary && (
          <p className="text-xs leading-relaxed" style={{ color: cfg.color, opacity: 0.8 }}>{item.impact_summary}</p>
        )}

        <div className="mt-1.5 text-[10px] text-[#444]">
          {item.publisher} · Impact score: <span style={{ color: cfg.color }} className="font-semibold">
            {item.impact_score != null ? (item.impact_score >= 0 ? `+${item.impact_score}` : item.impact_score) : "—"}/10
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Oversold Card ───────────────────────────────────────────────────────────
function OversoldCard({ sig, onViewStock }: { sig: OversoldSignal; onViewStock?: (sym: string) => void }) {
  const deeplyOversold = sig.pct_b < 5 || (sig.rsi !== null && sig.rsi < 30);
  const accent = deeplyOversold ? "#00c805" : "#4dbb50";

  return (
    <div
      className="bg-[#0d0d0d] border rounded-xl p-4 cursor-pointer hover:border-[#333] transition-colors"
      style={{ borderColor: `${accent}33`, borderLeftColor: accent, borderLeftWidth: 3 }}
      onClick={() => onViewStock?.(sig.symbol)}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm">{sig.symbol}</span>
          <span className="text-[#555] text-xs">${sig.price.toFixed(2)}</span>
          {sig.week_chg !== null && (
            <span className={`text-[10px] font-medium ${sig.week_chg < 0 ? "text-[#ff5000]" : "text-[#00c805]"}`}>
              {sig.week_chg > 0 ? "+" : ""}{sig.week_chg.toFixed(1)}% 1W
            </span>
          )}
        </div>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
          style={{ color: accent, backgroundColor: `${accent}18`, border: `1px solid ${accent}33` }}
        >
          {deeplyOversold ? "Deeply Oversold" : "Oversold"}
        </span>
      </div>

      {/* Indicator pills */}
      <div className="flex flex-wrap gap-2 mb-2">
        {sig.triggers.map((t) => (
          <div key={t.type} className="flex items-center gap-1.5 bg-[#111] rounded-lg px-2.5 py-1.5 border border-[#1e1e1e]">
            <span className="text-[10px] font-semibold text-[#8a8a8a]">{t.name}</span>
            <span className="text-[10px] text-[#555]">·</span>
            <span className="text-[10px] text-[#777]">{t.detail}</span>
          </div>
        ))}
      </div>

      {/* BB visual bar */}
      {(() => {
        const range = sig.bb_upper - sig.bb_lower;
        const pos = range > 0 ? Math.max(0, Math.min(100, ((sig.price - sig.bb_lower) / range) * 100)) : 50;
        return (
          <div className="mt-1">
            <div className="flex justify-between text-[9px] text-[#333] mb-0.5">
              <span>${sig.bb_lower.toFixed(2)}</span>
              {sig.bb_mid && <span className="text-[#2a2a2a]">${sig.bb_mid.toFixed(2)}</span>}
              <span>${sig.bb_upper.toFixed(2)}</span>
            </div>
            <div className="relative h-1.5 bg-[#1a1a1a] rounded-full">
              <div className="absolute left-1/2 top-0 w-px h-1.5 bg-[#2a2a2a]" />
              <div
                className="absolute top-0 w-2 h-1.5 rounded-full -translate-x-1/2 transition-all"
                style={{ left: `${pos}%`, backgroundColor: accent }}
              />
            </div>
            <div className="text-[9px] text-[#444] mt-0.5 text-center">Bollinger Band range</div>
          </div>
        );
      })()}

      <div className="mt-2 text-[10px] text-[#444] flex items-center gap-1">
        <TrendingUp size={8} style={{ color: accent }} />
        Click to view full technical analysis
      </div>
    </div>
  );
}

// ─── Signal Alert Card ────────────────────────────────────────────────────────
function SignalAlertCard({ alert, onViewStock }: { alert: SignalAlert; onViewStock?: (sym: string) => void }) {
  const bull  = alert.verdict === "bullish";
  const score = alert.score;
  const abs   = Math.abs(score);
  const color = abs >= 7 ? (bull ? "#00c805" : "#ff5000") : abs >= 5 ? (bull ? "#4dbb50" : "#ff8800") : (bull ? "#4dbb50" : "#ff8800");
  const strength = abs >= 7 ? "Very Strong" : abs >= 5 ? "Strong" : "Moderate";

  return (
    <div
      className="bg-[#0d0d0d] border rounded-xl p-4 flex gap-3 cursor-pointer hover:border-[#333] transition-colors"
      style={{ borderColor: `${color}40`, borderLeftColor: color, borderLeftWidth: 3 }}
      onClick={() => onViewStock?.(alert.symbol)}
    >
      <div className="shrink-0">
        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: `${color}18` }}>
          {bull ? <TrendingUp size={15} style={{ color }} /> : <TrendingDown size={15} style={{ color }} />}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-sm">{alert.symbol}</span>
            {alert.price && <span className="text-[#555] text-xs">${alert.price.toFixed(2)}</span>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ color, backgroundColor: `${color}18`, border: `1px solid ${color}33` }}>
              {strength} {bull ? "Bull" : "Bear"}
            </span>
            <span className="text-xs font-bold tabular-nums" style={{ color }}>
              {score > 0 ? "+" : ""}{score}
            </span>
          </div>
        </div>
        <div className="space-y-1">
          {alert.top_signals.slice(0, 2).map(s => (
            <div key={s.id} className="flex items-start gap-1.5">
              <div className="w-1 h-1 rounded-full shrink-0 mt-1.5" style={{ color }} />
              <span className="text-[11px] text-[#777] leading-snug">{s.title}</span>
            </div>
          ))}
        </div>
        <div className="mt-1.5 text-[10px] text-[#444] flex items-center gap-1">
          <Zap size={8} className="text-[#f7c44f]" />
          Click to view full analysis
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function RecommendationsHub({ portfolios, properties, sectors, onViewStock }: Props) {
  const [rubricOpen, setRubricOpen] = useState(false);
  const [newsRecs, setNewsRecs]     = useState<NewsItem[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [signalAlerts, setSignalAlerts] = useState<SignalAlert[]>([]);
  const [signalAlertsLoading, setSignalAlertsLoading] = useState(false);
  const [oversoldSignals, setOversoldSignals] = useState<OversoldSignal[]>([]);
  const [oversoldLoading, setOversoldLoading] = useState(false);

  const stockSymbols = useMemo(() => {
    const s = new Set<string>();
    for (const p of portfolios) {
      for (const h of p.holdings) {
        if (h.asset_type !== "cash") s.add(h.symbol);
      }
    }
    return Array.from(s);
  }, [portfolios]);

  const buyTargets = useBuyTargets(stockSymbols);

  const score = useMemo(
    () => computeWealthScore(portfolios, properties, buyTargets, sectors),
    [portfolios, properties, buyTargets, sectors],
  );

  const hasRE = properties.length > 0;

  useEffect(() => {
    if (!stockSymbols.length && !hasRE) return;
    Promise.all([
      getNews(stockSymbols, hasRE, 200),
      getNewsLastRefresh(),
    ]).then(([data, lr]) => {
      // Only news that warrants action
      const actionable = data.filter(n => n.action_required != null)
        .sort((a, b) => Math.abs(b.impact_score ?? 0) - Math.abs(a.impact_score ?? 0));
      setNewsRecs(actionable);
      setLastRefresh(lr.last_refresh);
    }).catch(() => {});
  }, [stockSymbols.join(","), hasRE]);

  // Fetch technical signal alerts (only when we have symbols)
  useEffect(() => {
    if (!stockSymbols.length) return;
    setSignalAlertsLoading(true);
    getSignalAlerts()
      .then(setSignalAlerts)
      .catch(() => setSignalAlerts([]))
      .finally(() => setSignalAlertsLoading(false));
  }, [stockSymbols.join(",")]);

  // Fetch oversold scan
  useEffect(() => {
    if (!stockSymbols.length) return;
    setOversoldLoading(true);
    getOversoldScan()
      .then(setOversoldSignals)
      .catch(() => setOversoldSignals([]))
      .finally(() => setOversoldLoading(false));
  }, [stockSymbols.join(",")]);

  const { total, grade, gradeLabel, gradeColor, pillars, recommendations, summary } = score;

  const potentialGain = Math.min(
    recommendations.reduce((s, r) => s + r.potentialGain, 0) +
    newsRecs.filter(n => n.action_required === "consider_buying").length * 2,
    100 - total,
  );

  if (portfolios.length === 0 && properties.length === 0) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-3">🎯</div>
          <div className="text-white font-semibold mb-1">No portfolio yet</div>
          <div className="text-[#555] text-sm">Add holdings on the Dashboard to get personalized recommendations.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-[900px] mx-auto px-4 py-8">

        {/* ── Page header ── */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-white">Recommendations Hub</h1>
          <p className="text-[#555] text-sm mt-0.5">
            Wealth optimization score + actionable insights from your portfolio and live news
          </p>
        </div>

        {/* ── Wealth Score Card ── */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 mb-4">
          <div className="flex items-start gap-6">
            {/* Gauge */}
            <div className="flex flex-col items-center shrink-0">
              <GaugeRing score={total} color={gradeColor} />
              <div className="mt-1 text-xs font-bold px-3 py-1 rounded-full border"
                style={{ color: gradeColor, borderColor: `${gradeColor}44`, backgroundColor: `${gradeColor}11` }}>
                {grade} — {gradeLabel}
              </div>
            </div>

            {/* Pillars */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h2 className="text-white font-semibold text-base">Wealth Optimization Score</h2>
                  <p className="text-[#555] text-xs mt-0.5">{summary}</p>
                </div>
                {/* Rubric toggle */}
                <button onClick={() => setRubricOpen(v => !v)}
                  className="flex items-center gap-1 text-[#444] hover:text-[#888] transition-colors text-xs shrink-0">
                  <Info size={12} /><span>Scoring rubric</span>
                </button>
              </div>

              {rubricOpen && (
                <div className="mb-3 bg-[#0d0d0d] border border-[#222] rounded-xl p-3">
                  <div className="text-white text-xs font-semibold mb-2">100-point rubric — consistent for all users</div>
                  <div className="space-y-1.5">
                    {RUBRIC.map(r => (
                      <div key={r.name} className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[#ccc] text-[11px]">{r.name}</div>
                          <div className="text-[#444] text-[10px]">{r.desc}</div>
                        </div>
                        <span className="text-[#555] text-[11px] shrink-0 tabular-nums">{r.max} pts</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-[#1a1a1a] text-[#333] text-[10px]">
                    A ≥85 · B ≥70 · C ≥55 · D ≥40 · F &lt;40
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {pillars.map(p => <PillarBar key={p.key} pillar={p} />)}
              </div>
            </div>
          </div>
        </div>

        {/* ── Potential gain banner ── */}
        {(recommendations.length > 0 || newsRecs.length > 0) && (
          <div className="bg-[#0a1a2a] border border-[#1a3a5a] rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
            <Sparkles size={15} className="text-[#4f8ef7] shrink-0" />
            <div className="flex-1 text-xs text-[#8a8a8a]">
              Acting on all recommendations below could add{" "}
              <span className="text-[#4f8ef7] font-bold text-sm">+{potentialGain} pts</span>{" "}
              to your score and strengthen your portfolio.
            </div>
          </div>
        )}

        {/* ── Oversold Opportunities ── */}
        {(oversoldLoading || oversoldSignals.length > 0) && (
          <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown size={14} className="text-[#00c805]" />
              <h3 className="text-white font-semibold text-sm">Oversold Opportunities</h3>
              {!oversoldLoading && (
                <span className="text-[#555] text-xs ml-1">
                  {oversoldSignals.length} stock{oversoldSignals.length !== 1 ? "s" : ""} showing oversold signals
                </span>
              )}
            </div>
            <div className="text-[#444] text-[10px] mb-4">
              Stocks near their lower Bollinger Band or with RSI below 40 — potential mean-reversion opportunities
            </div>
            {oversoldLoading ? (
              <div className="text-[#444] text-sm py-3 text-center">Scanning for oversold conditions…</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {oversoldSignals.map(s => (
                  <OversoldCard key={s.symbol} sig={s} onViewStock={onViewStock} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Technical Signal Alerts ── */}
        {(signalAlertsLoading || signalAlerts.length > 0) && (
          <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={14} className="text-[#f7c44f]" />
              <h3 className="text-white font-semibold text-sm">Technical Signal Alerts</h3>
              {!signalAlertsLoading && (
                <span className="text-[#555] text-xs ml-1">
                  {signalAlerts.length} strong signal{signalAlerts.length !== 1 ? "s" : ""} detected
                </span>
              )}
            </div>
            {signalAlertsLoading ? (
              <div className="text-[#444] text-sm py-3 text-center">Scanning technical signals…</div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {signalAlerts.slice(0, 6).map(a => (
                    <SignalAlertCard key={a.symbol} alert={a} onViewStock={onViewStock} />
                  ))}
                </div>
                <div className="mt-3 text-[10px] text-[#333] text-center">
                  Showing stocks with signal score |≥ 4|. Click any card to view full technical analysis.
                </div>
              </>
            )}
          </div>
        )}

        {/* ── News-Driven Recommendations ── */}
        {newsRecs.length > 0 && (
          <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-[#ff5000] animate-pulse" />
              <h3 className="text-white font-semibold text-sm">News-Driven Actions</h3>
              <span className="text-[#555] text-xs ml-1">
                {newsRecs.length} item{newsRecs.length !== 1 ? "s" : ""} need attention
              </span>
              {lastRefresh && (
                <span className="text-[#2a2a2a] text-[10px] ml-auto flex items-center gap-1">
                  <Clock size={9} /> Live news
                </span>
              )}
            </div>
            <div className="space-y-2.5">
              {newsRecs.slice(0, 8).map(item => (
                <NewsRecCard key={`${item.symbol}-${item.id}`} item={item} onViewStock={onViewStock} />
              ))}
            </div>
          </div>
        )}

        {/* ── Structural Recommendations ── */}
        {recommendations.length > 0 && (
          <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-white font-semibold text-sm">Portfolio Structure Recommendations</h3>
                <p className="text-[#555] text-xs mt-0.5">Based on your wealth score across 5 pillars</p>
              </div>
              <div className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
                style={{ color: gradeColor, backgroundColor: `${gradeColor}18`, border: `1px solid ${gradeColor}33` }}>
                {recommendations.length} action{recommendations.length !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="space-y-2.5">
              {recommendations.map(rec => <ScoreRecCard key={rec.id} rec={rec} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
