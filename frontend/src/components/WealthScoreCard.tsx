import { useMemo, useState } from "react";
import type { Portfolio, RealEstateProperty, CachedBuyTarget } from "../types";
import { computeWealthScore, type PillarScore, type Recommendation } from "../utils/wealthScore";
import { ChevronDown, ChevronUp, Info } from "lucide-react";

interface Props {
  portfolios: Portfolio[];
  properties: RealEstateProperty[];
  buyTargets: Map<string, CachedBuyTarget>;
  sectors: Record<string, string>;
}

// ─── SVG ring gauge ──────────────────────────────────────────────────────────
// 270° arc: starts at bottom-left (135°), sweeps clockwise to bottom-right (405°)
const CX = 70, CY = 70, R = 58, STROKE = 10;
const GAUGE_START = 135;
const GAUGE_ARC   = 270;

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
      {/* Track */}
      <path
        d={arcPath(GAUGE_START, GAUGE_START + GAUGE_ARC)}
        fill="none" stroke="#222" strokeWidth={STROKE} strokeLinecap="round"
      />
      {/* Fill */}
      {fillAngle > 0 && (
        <path
          d={arcPath(GAUGE_START, GAUGE_START + fillAngle)}
          fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
        />
      )}
      {/* Score number */}
      <text x={CX} y={CY - 4} textAnchor="middle" dominantBaseline="middle"
        fill="white" fontSize={28} fontWeight={700} fontFamily="inherit">
        {score}
      </text>
      <text x={CX} y={CY + 20} textAnchor="middle" dominantBaseline="middle"
        fill="#666" fontSize={11} fontFamily="inherit">
        out of 100
      </text>
    </svg>
  );
}

// ─── Pillar bar ───────────────────────────────────────────────────────────────
function PillarBar({ pillar }: { pillar: PillarScore }) {
  const [open, setOpen] = useState(false);
  const pct = pillar.maxScore > 0 ? (pillar.score / pillar.maxScore) * 100 : 0;

  const barColor =
    pct >= 80 ? "#00c805" :
    pct >= 60 ? "#4dbb50" :
    pct >= 40 ? "#f7c44f" :
    pct >= 20 ? "#ff8800" : "#ff4444";

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 group"
      >
        <span className="text-base shrink-0">{pillar.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate pr-2">
              {pillar.name}
            </span>
            <span className="text-xs tabular-nums shrink-0" style={{ color: barColor }}>
              {pillar.score}<span className="text-[#444]">/{pillar.maxScore}</span>
            </span>
          </div>
          <div className="h-1.5 bg-[#222] rounded-full overflow-hidden">
            <div
              className="h-1.5 rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, backgroundColor: barColor }}
            />
          </div>
        </div>
        <span className="text-[#444] shrink-0">
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </button>

      {open && (
        <div className="ml-7 mt-2 space-y-1 pb-1">
          {pillar.details.map((d, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-[#4dbb50]">
              <span className="mt-0.5 shrink-0">✓</span>
              <span>{d}</span>
            </div>
          ))}
          {pillar.gaps.map((g, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-[#888]">
              <span className="mt-0.5 shrink-0">→</span>
              <span>{g}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Recommendation card ──────────────────────────────────────────────────────
const PRIORITY_STYLE = {
  high:   { badge: "bg-[#2a0a0a] text-[#ff5000] border border-[#3a1a1a]", label: "High Impact" },
  medium: { badge: "bg-[#261f00] text-[#f7c44f] border border-[#362f10]", label: "Medium Impact" },
  low:    { badge: "bg-[#141414] text-[#666]    border border-[#2a2a2a]", label: "Low Impact" },
};

function RecCard({ rec }: { rec: Recommendation }) {
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
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ${ps.badge}`}>
              {ps.label}
            </span>
          </div>
        </div>
        <p className="text-[#666] text-xs leading-relaxed">{rec.detail}</p>
        <div className="mt-1.5">
          <span className="text-[10px] text-[#444]">{rec.pillar}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Rubric tooltip ───────────────────────────────────────────────────────────
const RUBRIC = [
  { name: "Diversification",      max: 25, desc: "Asset classes, sector spread, single-holding concentration" },
  { name: "Cash Management",      max: 20, desc: "Idle cash as % of net worth — ideal range is 3-8%" },
  { name: "Buy Discipline",       max: 20, desc: "Weighted % of portfolio value at/below buy targets" },
  { name: "Retirement Readiness", max: 20, desc: "Has accounts + retirement as % of investable assets" },
  { name: "Portfolio Health",     max: 15, desc: "Real estate equity, unrealized gains, account structure" },
];

function RubricPopover({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-[#444] hover:text-[#888] transition-colors text-xs"
      >
        <Info size={12} />
        <span>How scores are calculated</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-[#1a1a1a] border border-[#333] rounded-xl p-4 z-50 shadow-2xl">
          <div className="text-white text-xs font-semibold mb-3">Scoring Rubric — 100 points total</div>
          <div className="space-y-2.5">
            {RUBRIC.map(r => (
              <div key={r.name}>
                <div className="flex items-center justify-between">
                  <span className="text-[#ccc] text-xs">{r.name}</span>
                  <span className="text-[#555] text-xs tabular-nums">{r.max} pts</span>
                </div>
                <div className="text-[#555] text-[10px] mt-0.5">{r.desc}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-[#2a2a2a] text-[#444] text-[10px] leading-relaxed">
            Grades: A ≥85 · B ≥70 · C ≥55 · D ≥40 · F &lt;40
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WealthScoreCard({ portfolios, properties, buyTargets, sectors }: Props) {
  const [rubricOpen, setRubricOpen] = useState(false);

  const result = useMemo(
    () => computeWealthScore(portfolios, properties, buyTargets, sectors),
    [portfolios, properties, buyTargets, sectors],
  );

  if (portfolios.length === 0 && properties.length === 0) return null;

  const { total, grade, gradeLabel, gradeColor, pillars, recommendations, summary } = result;

  return (
    <div className="mb-6 space-y-3">

      {/* ── Main score card ── */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6">
        <div className="flex items-start gap-6">

          {/* Left: gauge + grade */}
          <div className="flex flex-col items-center shrink-0">
            <GaugeRing score={total} color={gradeColor} />
            <div
              className="mt-1 text-xs font-bold px-3 py-1 rounded-full border"
              style={{
                color: gradeColor,
                borderColor: `${gradeColor}44`,
                backgroundColor: `${gradeColor}11`,
              }}
            >
              {grade} — {gradeLabel}
            </div>
          </div>

          {/* Right: header + pillars */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h2 className="text-white font-semibold text-base">Wealth Optimization Score</h2>
                <p className="text-[#555] text-xs mt-0.5">{summary}</p>
              </div>
              <RubricPopover open={rubricOpen} onToggle={() => setRubricOpen(v => !v)} />
            </div>

            <div className="mt-4 space-y-3">
              {pillars.map(p => <PillarBar key={p.key} pillar={p} />)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Recommendations ── */}
      {recommendations.length > 0 && (
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-white font-semibold text-sm">How to Improve Your Score</h3>
              <p className="text-[#555] text-xs mt-0.5">
                Completing all recommendations below could add{" "}
                <span className="text-[#4f8ef7] font-semibold">
                  +{Math.min(recommendations.reduce((s, r) => s + r.potentialGain, 0), 100 - total)} pts
                </span>{" "}
                to your score
              </p>
            </div>
            <div
              className="text-[10px] font-semibold px-2.5 py-1 rounded-full"
              style={{ color: gradeColor, backgroundColor: `${gradeColor}18`, border: `1px solid ${gradeColor}33` }}
            >
              {recommendations.length} action{recommendations.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="space-y-2.5">
            {recommendations.map(rec => <RecCard key={rec.id} rec={rec} />)}
          </div>
        </div>
      )}
    </div>
  );
}
