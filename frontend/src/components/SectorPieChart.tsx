import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { getSectorColor } from "../utils/sectors";

interface Props {
  data: { sector: string; value: number }[];
}

function fmt(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const { sector, value, pct } = payload[0].payload;
  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs">
      <div className="text-white font-semibold mb-0.5">{sector}</div>
      <div className="text-[#8a8a8a]">{fmt(value)} · {pct.toFixed(1)}%</div>
    </div>
  );
};

export default function SectorPieChart({ data }: Props) {
  if (!data.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);
  const enriched = data
    .map((d) => ({ ...d, pct: total > 0 ? (d.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
      <div className="text-white font-semibold text-sm mb-3">Sector Breakdown</div>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={enriched}
            dataKey="value"
            nameKey="sector"
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            strokeWidth={0}
          >
            {enriched.map((entry) => (
              <Cell key={entry.sector} fill={getSectorColor(entry.sector)} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="space-y-1.5 mt-1">
        {enriched.map((d) => (
          <div key={d.sector} className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: getSectorColor(d.sector) }} />
              <span className="text-[#8a8a8a] text-xs truncate">{d.sector}</span>
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
