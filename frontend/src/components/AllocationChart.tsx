import { useState } from "react";
import type { Portfolio } from "../types";

interface SliceData {
  symbol: string;
  name: string;
  value: number;
  pct: number;
  color: string;
}

const COLORS = [
  "#4f8ef7", "#00c805", "#f7a44f", "#c084fc", "#f75c5c",
  "#4fd1c5", "#f6e05e", "#68d391", "#76e4f7", "#b794f4",
  "#fc8181", "#ed8936", "#38b2ac", "#667eea", "#f6ad55",
];

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n);
}

function buildSlices(portfolios: Portfolio[]): { slices: SliceData[]; total: number } {
  const map = new Map<string, { name: string; value: number }>();
  let total = 0;
  for (const p of portfolios) {
    for (const h of p.holdings) {
      if (h.current_value <= 0) continue;
      const prev = map.get(h.symbol) ?? { name: h.name, value: 0 };
      map.set(h.symbol, { name: h.name, value: prev.value + h.current_value });
      total += h.current_value;
    }
  }
  const sorted = [...map.entries()].sort((a, b) => b[1].value - a[1].value);
  const TOP = 11;
  const top = sorted.slice(0, TOP);
  const rest = sorted.slice(TOP);
  const othersValue = rest.reduce((s, [, d]) => s + d.value, 0);
  const slices: SliceData[] = top.map(([symbol, d], i) => ({
    symbol, name: d.name, value: d.value,
    pct: total > 0 ? (d.value / total) * 100 : 0,
    color: COLORS[i % COLORS.length],
  }));
  if (othersValue > 0) {
    slices.push({ symbol: "OTHER", name: "Others", value: othersValue,
      pct: total > 0 ? (othersValue / total) * 100 : 0, color: "#3a3a3a" });
  }
  return { slices, total };
}

// SVG donut arc helper
function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToXY(cx, cy, r, startAngle);
  const end = polarToXY(cx, cy, r, endAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
}

interface Props {
  portfolios: Portfolio[];
  onViewStock?: (symbol: string) => void;
}

export default function AllocationChart({ portfolios, onViewStock }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { slices, total } = buildSlices(portfolios);

  if (slices.length === 0) return null;

  // Build arc angles
  const GAP = 2; // degrees gap between slices
  const angles: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const s of slices) {
    const sweep = (s.pct / 100) * 360 - GAP;
    angles.push({ start: cursor, end: cursor + sweep });
    cursor += sweep + GAP;
  }

  const CX = 100, CY = 100, R_OUT = 90, R_IN = 62;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 mb-4">
      <h2 className="text-white font-semibold mb-5">Holdings Allocation</h2>

      <div className="flex gap-8 items-center">
        {/* SVG Donut */}
        <div className="shrink-0 relative" style={{ width: 200, height: 200 }}>
          <svg width={200} height={200}>
            {slices.map((s, i) => {
              const { start, end } = angles[i];
              const isHovered = hovered === i;
              const inactive = hovered !== null && !isHovered;
              const rOut = isHovered ? R_OUT + 5 : R_OUT;
              const outerPath = arcPath(CX, CY, rOut, start, end);
              const d = `${outerPath} L ${polarToXY(CX, CY, R_IN, end).x} ${polarToXY(CX, CY, R_IN, end).y} A ${R_IN} ${R_IN} 0 ${end - start > 180 ? 1 : 0} 0 ${polarToXY(CX, CY, R_IN, start).x} ${polarToXY(CX, CY, R_IN, start).y} Z`;
              return (
                <path
                  key={s.symbol}
                  d={d}
                  fill={s.color}
                  opacity={inactive ? 0.25 : 1}
                  style={{ cursor: "pointer", transition: "opacity 0.15s, d 0.15s" }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}
          </svg>
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ pointerEvents: hovered !== null && onViewStock ? "auto" : "none" }}>
            {hovered !== null ? (
              <>
                <div
                  className={`text-white font-bold text-sm ${onViewStock && slices[hovered].symbol !== "OTHER" ? "cursor-pointer hover:text-[#4f8ef7] transition-colors" : ""}`}
                  onClick={() => slices[hovered].symbol !== "OTHER" && onViewStock?.(slices[hovered].symbol)}
                >{slices[hovered].symbol}</div>
                <div className="text-[#8a8a8a] text-xs">{slices[hovered].pct.toFixed(1)}%</div>
                <div className="text-white text-xs mt-0.5">{fmt(slices[hovered].value)}</div>
              </>
            ) : (
              <>
                <div className="text-[#8a8a8a] text-xs">Total</div>
                <div className="text-white font-bold text-sm">{fmt(total)}</div>
              </>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-2.5 min-w-0">
          {slices.map((s, i) => (
            <div
              key={s.symbol}
              className="flex items-center gap-2 cursor-default"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{
                  backgroundColor: s.color,
                  opacity: hovered !== null && hovered !== i ? 0.3 : 1,
                  transform: hovered === i ? "scale(1.3)" : "scale(1)",
                  transition: "transform 0.15s, opacity 0.15s",
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={`text-xs font-medium truncate transition-colors ${onViewStock && s.symbol !== "OTHER" ? "cursor-pointer hover:text-[#4f8ef7]" : ""}`}
                    style={{ color: hovered === i ? "#fff" : hovered !== null ? "#444" : "#e0e0e0" }}
                    onClick={() => s.symbol !== "OTHER" && onViewStock?.(s.symbol)}
                  >
                    {s.symbol}
                  </span>
                  <span
                    className="text-xs shrink-0 tabular-nums transition-colors"
                    style={{ color: hovered === i ? s.color : hovered !== null ? "#333" : "#8a8a8a" }}
                  >
                    {s.pct.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-[#222] rounded-full h-0.5 mt-0.5">
                  <div
                    className="h-0.5 rounded-full transition-all duration-300"
                    style={{
                      width: `${s.pct}%`,
                      backgroundColor: s.color,
                      opacity: hovered !== null && hovered !== i ? 0.2 : 1,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
