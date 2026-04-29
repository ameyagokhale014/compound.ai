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
import { getPortfolioHistory } from "../api";
import type { ChartPoint, Period, Portfolio } from "../types";

const PERIODS: Period[] = ["1D", "1M", "3M", "6M", "1Y", "ALL"];

function formatDate(ts: string, period: Period) {
  const d = parseISO(ts);
  if (period === "1D") return format(d, "h:mm a");
  if (period === "1M" || period === "3M") return format(d, "MMM d");
  return format(d, "MMM ''yy");
}

function formatValue(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
}

interface Props {
  portfolio: Portfolio;
}

export default function PortfolioChart({ portfolio }: Props) {
  const [period, setPeriod] = useState<Period>("1M");
  const [data, setData] = useState<ChartPoint[]>([]);
  const [hovered, setHovered] = useState<ChartPoint | null>(null);

  // Portfolio value at previous close, derived from day_change_value per holding
  const prevCloseTotal = portfolio.total_value - portfolio.holdings.reduce((s, h) => s + h.day_change_value, 0);

  useEffect(() => {
    getPortfolioHistory(portfolio.id, period).then((pts) => {
      if (pts.length === 0) {
        setData([{ timestamp: new Date().toISOString(), value: portfolio.total_value }]);
      } else if (period === "1D") {
        // Prepend a synthetic yesterday-close point so the chart baseline matches Today's Return
        const todayOpen = new Date();
        todayOpen.setHours(9, 30, 0, 0);
        const syntheticStart: ChartPoint = { timestamp: todayOpen.toISOString(), value: prevCloseTotal };
        // Only prepend if first real snapshot is after market open
        const firstReal = new Date(pts[0].timestamp);
        setData(firstReal > todayOpen ? [syntheticStart, ...pts] : pts);
      } else {
        setData(pts);
      }
    });
  }, [portfolio.id, period, portfolio.total_value]);

  // For 1D use previous-close baseline so chart gain matches Today's Return card
  const startValue = period === "1D" ? prevCloseTotal : (data[0]?.value ?? portfolio.total_value);

  const dataMin = data.length ? Math.min(...data.map((d) => d.value)) : 0;
  const dataMax = data.length ? Math.max(...data.map((d) => d.value)) : portfolio.total_value;
  const yPad = (dataMax - dataMin) * 0.2 || dataMax * 0.005;
  const yDomain: [number, number] = [Math.max(0, dataMin - yPad), dataMax + yPad];
  const endValue = hovered?.value ?? portfolio.total_value;
  const gain = endValue - startValue;
  const gainPct = startValue ? (gain / startValue) * 100 : 0;
  const isPositive = gain >= 0;
  const color = isPositive ? "#00c805" : "#ff5000";

  const displayValue = hovered?.value ?? portfolio.total_value;

  return (
    <div>
      <div className="mb-6">
        <div className="text-4xl font-semibold text-white">{formatValue(displayValue)}</div>
        <div className={`text-sm mt-1 ${isPositive ? "text-[#00c805]" : "text-[#ff5000]"}`}>
          {isPositive ? "+" : ""}
          {formatValue(gain)} ({isPositive ? "+" : ""}
          {gainPct.toFixed(2)}%)
          {period !== "ALL" && <span className="text-[#8a8a8a] ml-1">Past {period}</span>}
        </div>
      </div>

      <div className="h-40">
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
                <linearGradient id={`grad-${portfolio.id}`} x1="0" y1="0" x2="0" y2="1">
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
                  const delta = pt.value - startValue;
                  const deltaPct = startValue ? (delta / startValue) * 100 : 0;
                  const up = delta >= 0;
                  return (
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs shadow-xl">
                      <div className="text-white font-semibold text-sm">{formatValue(pt.value)}</div>
                      <div className={`mt-0.5 ${up ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                        {up ? "+" : ""}{formatValue(delta)} ({up ? "+" : ""}{deltaPct.toFixed(2)}%)
                      </div>
                      <div className="text-[#555] mt-1">{formatDate(pt.timestamp, period)}</div>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={startValue} stroke="#333" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#grad-${portfolio.id})`}
                dot={false}
                activeDot={{ r: 4, fill: color, stroke: color }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-[#555] text-sm">
            Add transactions to see performance history
          </div>
        )}
      </div>

      <div className="flex gap-1 mt-4">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              period === p
                ? "bg-[#222] text-white"
                : "text-[#8a8a8a] hover:text-white"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
