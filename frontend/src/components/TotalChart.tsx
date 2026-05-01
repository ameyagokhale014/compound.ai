import { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";
import { getTotalHistory } from "../api";
import type { ChartPoint, Period, Portfolio } from "../types";

const PERIODS: Period[] = ["1D", "1M", "3M", "6M", "1Y", "ALL"];

function formatDate(ts: string, period: Period) {
  const d = parseISO(ts);
  if (period === "1D") return format(d, "h:mm a");
  if (period === "1M" || period === "3M") return format(d, "MMM d");
  return format(d, "MMM ''yy");
}

function fmtVal(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}
function fmtFull(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

interface Props {
  portfolios: Portfolio[];
  totalValue: number;
  totalTodayValue: number;
  totalGainLoss: number;
  totalGainLossPct: number;
}

export default function TotalChart({ portfolios, totalValue, totalTodayValue, totalGainLoss, totalGainLossPct }: Props) {
  const [period, setPeriod] = useState<Period>("1M");
  const [data, setData] = useState<ChartPoint[]>([]);
  const [hovered, setHovered] = useState<ChartPoint | null>(null);

  const prevCloseTotal = totalValue - totalTodayValue;

  useEffect(() => {
    if (portfolios.length === 0) return;
    getTotalHistory(period).then((pts) => {
      if (pts.length === 0) {
        setData([{ timestamp: new Date().toISOString(), value: totalValue }]);
        return;
      }
      if (period === "1D") {
        const todayOpen = new Date();
        todayOpen.setHours(9, 30, 0, 0);
        const syntheticStart: ChartPoint = { timestamp: todayOpen.toISOString(), value: prevCloseTotal };
        const firstReal = new Date(pts[0].timestamp);
        setData(firstReal > todayOpen ? [syntheticStart, ...pts] : pts);
      } else {
        setData(pts);
      }
    });
  }, [period, portfolios.length, totalValue]);

  // Reference line: first snapshot in range (visual baseline for chart)
  const periodStartValue = period === "1D" ? prevCloseTotal : (data[0]?.value ?? totalValue);

  const dataMin = data.length ? Math.min(...data.map((d) => d.value)) : 0;
  const dataMax = data.length ? Math.max(...data.map((d) => d.value)) : totalValue;
  const yPad = (dataMax - dataMin) * 0.2 || dataMax * 0.005;
  const yDomain: [number, number] = [Math.max(0, dataMin - yPad), dataMax + yPad];

  const displayValue = hovered?.value ?? totalValue;
  const allTimeUp = totalGainLoss >= 0;
  const color = allTimeUp ? "#00c805" : "#ff5000";

  if (portfolios.length === 0) return null;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 mb-6">
      <div className="mb-4">
        <div className="text-[#8a8a8a] text-xs uppercase tracking-widest mb-1">Total Portfolio Value</div>
        <div className="text-3xl font-semibold text-white">{fmtVal(displayValue)}</div>
        <div className="flex items-center gap-4 mt-1 flex-wrap">
          {/* All-time return from cost basis — always accurate */}
          <div className={`text-sm font-medium ${allTimeUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
            {allTimeUp ? "+" : ""}{fmtFull(totalGainLoss)} ({allTimeUp ? "+" : ""}{totalGainLossPct.toFixed(2)}%)
            <span className="text-[#555] font-normal ml-1.5">all-time return</span>
          </div>
          {/* Today's change */}
          {totalTodayValue !== 0 && (
            <div className={`text-xs ${totalTodayValue >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}`}>
              {totalTodayValue >= 0 ? "+" : ""}{fmtFull(totalTodayValue)} today
            </div>
          )}
        </div>
      </div>

      <div className="h-44">
        {data.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              onMouseMove={(e: any) => {
                if (e?.activePayload?.[0]) setHovered(e.activePayload[0].payload);
              }}
              onMouseLeave={() => setHovered(null)}
              margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="total-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="timestamp" hide />
              <YAxis domain={yDomain} hide />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const pt = payload[0].payload as ChartPoint;
                  const delta = pt.value - periodStartValue;
                  const deltaPct = periodStartValue ? (delta / periodStartValue) * 100 : 0;
                  const up = delta >= 0;
                  return (
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs shadow-xl">
                      <div className="text-white font-semibold text-sm">{fmtVal(pt.value)}</div>
                      <div className={`mt-0.5 ${up ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                        {up ? "+" : ""}{fmtFull(delta)} ({up ? "+" : ""}{deltaPct.toFixed(2)}%)
                      </div>
                      <div className="text-[#555] mt-1">{formatDate(pt.timestamp, period)}</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={periodStartValue} stroke="#333" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill="url(#total-grad)"
                dot={false}
                activeDot={{ r: 4, fill: color, stroke: color }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[#555] text-sm">
            Chart data will appear as snapshots are recorded
          </div>
        )}
      </div>

      <div className="flex gap-1 mt-4">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              period === p ? "bg-[#222] text-white" : "text-[#8a8a8a] hover:text-white"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
