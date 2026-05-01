import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { STRATEGY_TAGS, TAG_META } from "../hooks/useHoldingTags";
import type { StrategyTag } from "../hooks/useHoldingTags";

interface Holding {
  symbol: string;
  current_value: number;
}

interface Props {
  holdings: Holding[];
  tags: Record<string, StrategyTag>;
}

function fmt(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const { label, value, pct } = payload[0].payload;
  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs">
      <div className="text-white font-semibold mb-0.5">{label}</div>
      <div className="text-[#8a8a8a]">{fmt(value)} · {pct.toFixed(1)}%</div>
    </div>
  );
};

export default function StrategyPieChart({ holdings, tags }: Props) {
  if (!holdings.length) return null;

  // Aggregate value by tag (untagged → "none")
  const totals: Record<StrategyTag, number> = {
    none: 0, growth_value: 0, hyper_growth: 0, speculative: 0, etf_fund: 0, crypto: 0,
  };
  for (const h of holdings) {
    const tag = tags[h.symbol] ?? "none";
    totals[tag] += h.current_value;
  }

  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  const data = STRATEGY_TAGS
    .filter((t) => totals[t.id] > 0)
    .map((t) => ({
      id: t.id,
      label: t.label,
      color: t.color,
      value: totals[t.id],
      pct: (totals[t.id] / total) * 100,
    }))
    .sort((a, b) => b.value - a.value);

  if (data.length < 2 && data[0]?.id === "none") return null;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4 mt-4">
      <div className="text-white font-semibold text-sm mb-3">Strategy Breakdown</div>

      <ResponsiveContainer width="100%" height={170}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={76}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((entry) => (
              <Cell key={entry.id} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>

      <div className="space-y-1.5 mt-1">
        {data.map((d) => (
          <div key={d.id} className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
              <span className="text-[#8a8a8a] text-xs truncate">{d.label}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <span className="text-[#555] text-xs">{fmt(d.value)}</span>
              <span className="text-white text-xs font-medium w-10 text-right">{d.pct.toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
