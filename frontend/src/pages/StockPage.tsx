import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, ExternalLink, RefreshCw, ChevronDown, ChevronUp, Zap } from "lucide-react";
import {
  ComposedChart, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine, CartesianGrid,
} from "recharts";
import type { Portfolio } from "../types";
import { getStockData, getStockPriceHistory, getSignals } from "../api";
import type { SignalsResponse, TechnicalSignal } from "../api";
import { useBuyTargets } from "../hooks/useBuyTargets";
import Popi from "../components/Popi";
import TechnicalChart from "../components/TechnicalChart";
import FinancialSnapshot from "../components/FinancialSnapshot";
import DCFCalculator from "../components/DCFCalculator";

interface Props {
  symbol: string;
  onBack: () => void;
  portfolios: Portfolio[];
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmtPrice(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}
function fmtBig(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
function fmtX(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(1)}x`;
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function yoy(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0 || (prev < 0 && cur > 0) || (prev > 0 && cur < 0)) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// ── Stat card ──────────────────────────────────────────────────────────────────
function Stat({ label, value, sub, green }: { label: string; value: string; sub?: string; green?: boolean }) {
  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3">
      <div className="text-[#8a8a8a] text-xs mb-1">{label}</div>
      <div className={`font-semibold text-sm ${green != null ? (green ? "text-[#00c805]" : "text-[#ff5000]") : "text-white"}`}>
        {value}
      </div>
      {sub && <div className="text-[#555] text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-5">
      <h3 className="text-white font-semibold text-sm mb-4">{title}</h3>
      {children}
    </div>
  );
}

// ── Financial bar chart ────────────────────────────────────────────────────────
function FinChart({
  rows, valueKey, label, color = "#4f8ef7", pctKey,
}: {
  rows: any[];
  valueKey: string;
  label: string;
  color?: string;
  pctKey?: string;
}) {
  if (!rows || rows.length === 0) return <div className="h-36 flex items-center justify-center text-[#444] text-xs">No data</div>;

  const data = [...rows].reverse().map((r, i, arr) => {
    const val = r[valueKey] as number | null;
    const prev = i > 0 ? (arr[i - 1][valueKey] as number | null) : null;
    const growth = pctKey ? r[pctKey] : yoy(val, prev);
    return { label: (r.date || r.calendarYear || "").slice(0, 4), value: val, growth };
  });

  const hasGrowth = data.some(d => d.growth != null);

  const CustomTooltip = ({ active, payload, label: lbl }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs space-y-0.5">
        <div className="text-[#8a8a8a] mb-1">{lbl}</div>
        <div className="text-white font-semibold">{fmtBig(d.value)}</div>
        {d.growth != null && (
          <div className={d.growth >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}>
            {d.growth >= 0 ? "+" : ""}{fmtPct(d.growth)} YoY growth
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[#8a8a8a] text-xs">{label}</div>
        {hasGrowth && (
          <div className="flex items-center gap-3 text-[10px] text-[#555]">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />Value</span>
            <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed border-[#f7c44f]" />Growth %</span>
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={data} barCategoryGap="20%">
          <XAxis dataKey="label" tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="val" hide />
          {hasGrowth && (
            <YAxis
              yAxisId="pct"
              orientation="right"
              tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
              tick={{ fill: "#555", fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
          )}
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
          <ReferenceLine yAxisId="val" y={0} stroke="#2a2a2a" />
          {hasGrowth && <ReferenceLine yAxisId="pct" y={0} stroke="#2a2a2a" strokeDasharray="3 3" />}
          <Bar yAxisId="val" dataKey="value" fill={color} radius={[3, 3, 0, 0]}
            label={{ position: "top", fill: "#8a8a8a", fontSize: 9, formatter: (v: number) => fmtBig(v) }}
          />
          {hasGrowth && (
            <Line
              yAxisId="pct"
              dataKey="growth"
              stroke="#f7c44f"
              strokeWidth={1.5}
              dot={{ fill: "#f7c44f", r: 2.5, strokeWidth: 0 }}
              activeDot={{ r: 4, fill: "#f7c44f" }}
              strokeDasharray="4 2"
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Margin trend chart ─────────────────────────────────────────────────────────
function MarginChart({ rows }: { rows: any[] }) {
  if (!rows || rows.length === 0) return <div className="h-36 flex items-center justify-center text-[#444] text-xs">No data</div>;

  const data = [...rows].reverse().map((r) => ({
    label: (r.date || "").slice(0, 4),
    gross: r.grossProfitRatio != null ? +(r.grossProfitRatio * 100).toFixed(1) : null,
    operating: r.operatingIncomeRatio != null ? +(r.operatingIncomeRatio * 100).toFixed(1) : null,
    net: r.netIncomeRatio != null ? +(r.netIncomeRatio * 100).toFixed(1) : null,
  }));

  const CustomTooltip = ({ active, payload, label: lbl }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs space-y-0.5">
        <div className="text-[#8a8a8a] mb-1">{lbl}</div>
        {payload.map((p: any) => (
          <div key={p.name} style={{ color: p.color }}>{p.name}: {p.value?.toFixed(1)}%</div>
        ))}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data}>
        <XAxis dataKey="label" tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: "#555", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
        <Tooltip content={<CustomTooltip />} />
        <Line type="monotone" dataKey="gross" name="Gross" stroke="#4f8ef7" dot={false} strokeWidth={1.5} />
        <Line type="monotone" dataKey="operating" name="Operating" stroke="#a78bfa" dot={false} strokeWidth={1.5} />
        <Line type="monotone" dataKey="net" name="Net" stroke="#00c805" dot={false} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Price chart ────────────────────────────────────────────────────────────────
const PERIODS = ["1M", "3M", "6M", "1Y", "3Y", "5Y"] as const;

function PriceChart({ symbol, currentPrice }: { symbol: string; currentPrice?: number }) {
  const [period, setPeriod] = useState("1Y");
  const [history, setHistory] = useState<{ date: string; close: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setHoverPrice(null);
    getStockPriceHistory(symbol, period)
      .then(setHistory)
      .finally(() => setLoading(false));
  }, [symbol, period]);

  const startPrice = history.length > 0 ? history[0].close : null;
  const endPrice = hoverPrice ?? (history.length > 0 ? history[history.length - 1].close : null);
  const livePrice = currentPrice && currentPrice > 0 ? currentPrice : null;
  // When not hovering, use the live price for the "current" side if available
  const displayEnd = hoverPrice ?? livePrice ?? endPrice;

  const change = startPrice && displayEnd ? displayEnd - startPrice : null;
  const changePct = startPrice && change != null ? (change / startPrice) * 100 : null;
  const isUp = change == null ? true : change >= 0;
  const color = isUp ? "#00c805" : "#ff5000";

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) { setHoverPrice(null); return null; }
    const d = payload[0]?.payload;
    if (d?.close) setHoverPrice(d.close);
    const hChange = startPrice ? d.close - startPrice : null;
    const hPct = startPrice && hChange != null ? (hChange / startPrice) * 100 : null;
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-xs space-y-0.5">
        <div className="text-[#8a8a8a]">{d.date}</div>
        <div className="text-white font-semibold">{fmtPrice(d.close)}</div>
        {hChange != null && (
          <div className={hChange >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}>
            {hChange >= 0 ? "+" : ""}{fmtPrice(hChange)} ({hChange >= 0 ? "+" : ""}{hPct!.toFixed(2)}%)
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Period selector + return summary */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                period === p ? "bg-[#222] text-white" : "text-[#555] hover:text-[#8a8a8a]"
              }`}>
              {p}
            </button>
          ))}
        </div>

        {/* Period return pill */}
        {!loading && change != null && (
          <div className="flex items-center gap-2">
            {displayEnd && (
              <span className="text-white font-semibold text-sm">{fmtPrice(displayEnd)}</span>
            )}
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${
              isUp ? "bg-[#0a2a0a] text-[#00c805]" : "bg-[#2a0a0a] text-[#ff5000]"
            }`}>
              {isUp ? "+" : ""}{fmtPrice(change)} ({isUp ? "+" : ""}{changePct!.toFixed(2)}%)
            </span>
            <span className="text-[#444] text-[10px]">{period}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center text-[#444] text-sm">Loading…</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={history} onMouseLeave={() => setHoverPrice(null)}>
            <XAxis dataKey="date" tick={{ fill: "#555", fontSize: 9 }}
              axisLine={false} tickLine={false}
              tickFormatter={(v) => v.slice(5)}
              interval={Math.floor(history.length / 6)}
            />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "#555", fontSize: 9 }}
              axisLine={false} tickLine={false}
              tickFormatter={(v) => `$${v}`}
              width={55}
            />
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="close" stroke={color} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Analyst bar ────────────────────────────────────────────────────────────────
function AnalystTargetBar({ low, mean, high, current }: { low: number; mean: number; high: number; current: number }) {
  const min = Math.min(low, current) * 0.95;
  const max = Math.max(high, current) * 1.05;
  const range = max - min;
  const pct = (v: number) => `${((v - min) / range) * 100}%`;

  return (
    <div className="relative h-8 mt-2">
      <div className="absolute top-3 left-0 right-0 h-1 bg-[#222] rounded-full" />
      <div className="absolute top-3 h-1 bg-[#4f8ef7] rounded-full"
        style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
      {/* current price marker */}
      <div className="absolute top-1.5 w-0.5 h-4 bg-white rounded-full" style={{ left: pct(current) }} />
      <div className="absolute -top-1 text-[9px] text-[#555]" style={{ left: pct(low) }}>Low</div>
      <div className="absolute -top-1 text-[9px] text-[#555] -translate-x-1/2" style={{ left: pct(mean) }}>Mean</div>
      <div className="absolute -top-1 text-[9px] text-[#555] -translate-x-full" style={{ left: pct(high) }}>High</div>
      <div className="absolute top-5 text-[9px] text-white font-semibold -translate-x-1/2" style={{ left: pct(current) }}>Now</div>
    </div>
  );
}

// ── Signal badge ───────────────────────────────────────────────────────────────
const SIGNAL: Record<string, { bg: string; text: string; label: string }> = {
  strong_buy:   { bg: "bg-[#0a2a0a]", text: "text-[#00c805]", label: "Strong Buy" },
  buy:          { bg: "bg-[#0d1f0d]", text: "text-[#4dbb50]", label: "Buy" },
  near_target:  { bg: "bg-[#261f00]", text: "text-[#f7c44f]", label: "Near Target" },
  above_target: { bg: "bg-[#2a0a0a]", text: "text-[#ff5000]", label: "Above Target" },
};

// ── Revenue segments ───────────────────────────────────────────────────────────
function SegmentsSection({ segments }: { segments: any[] }) {
  if (!segments || segments.length === 0) return null;
  const latest = segments[0];
  if (!latest) return null;

  const entries = Object.entries(latest)
    .filter(([k]) => k !== "date" && k !== "symbol")
    .map(([k, v]) => ({ name: k, value: v as number }))
    .filter((e) => typeof e.value === "number")
    .sort((a, b) => b.value - a.value);

  const total = entries.reduce((s, e) => s + Math.abs(e.value), 0);
  const COLORS = ["#4f8ef7", "#a78bfa", "#00c805", "#f7c44f", "#ff8800", "#ff5000", "#4dbb50", "#cc44ff"];

  return (
    <Section title={`Revenue Segments · ${(latest.date || "").slice(0, 4)}`}>
      <div className="space-y-2">
        {entries.slice(0, 8).map((e, i) => (
          <div key={e.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[#8a8a8a] text-xs truncate">{e.name}</span>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-[#555] text-xs">{total > 0 ? ((Math.abs(e.value) / total) * 100).toFixed(1) : 0}%</span>
                <span className="text-white text-xs font-medium">{fmtBig(e.value)}</span>
              </div>
            </div>
            <div className="h-1 bg-[#222] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{
                width: `${total > 0 ? (Math.abs(e.value) / total) * 100 : 0}%`,
                backgroundColor: COLORS[i % COLORS.length],
              }} />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Signal Score Badge ─────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  const abs = Math.abs(score);
  const bull = score > 0;
  const color = abs >= 5
    ? (bull ? "#00c805" : "#ff5000")
    : abs >= 2
      ? (bull ? "#4dbb50" : "#ff8800")
      : "#8a8a8a";
  const label = abs >= 5
    ? (bull ? "Strong Bull" : "Strong Bear")
    : abs >= 2
      ? (bull ? "Mild Bull" : "Mild Bear")
      : "Neutral";
  return (
    <div className="flex items-center gap-2">
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>
        {score > 0 ? "+" : ""}{score}
      </div>
      <div>
        <div className="text-[10px] text-[#555] uppercase tracking-wide">Signal Score</div>
        <div className="text-xs font-semibold" style={{ color }}>{label}</div>
      </div>
    </div>
  );
}

// ── Signal Card ────────────────────────────────────────────────────────────────
function SignalCard({ signal }: { signal: TechnicalSignal }) {
  const [open, setOpen] = useState(false);
  const bull = signal.direction === "bullish";
  const bear = signal.direction === "bearish";
  const scoreAbs = Math.abs(signal.score);
  const dotColor = bull ? "#00c805" : bear ? "#ff5000" : "#555";
  const bgColor  = bull ? "bg-[#0a1a0a] border-[#1a3a1a]" : bear ? "bg-[#1a0a0a] border-[#3a1a1a]" : "bg-[#141414] border-[#2a2a2a]";

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${bgColor}`}>
      <button className="w-full p-3 text-left flex items-start gap-2.5" onClick={() => setOpen(v => !v)}>
        <div className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: dotColor }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-white text-xs font-semibold truncate">{signal.name}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {signal.score !== 0 && (
                <span className="text-[10px] font-bold tabular-nums" style={{ color: dotColor }}>
                  {signal.score > 0 ? "+" : ""}{signal.score}
                </span>
              )}
              <span className="text-[#444]">{open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</span>
            </div>
          </div>
          <div className="text-[#8a8a8a] text-[11px] mt-0.5 leading-snug">{signal.title}</div>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 ml-4.5 space-y-2.5 text-xs border-t border-[#ffffff08] pt-2.5">
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-wide mb-1">What it is</div>
            <div className="text-[#8a8a8a] leading-relaxed">{signal.what_it_is}</div>
          </div>
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-wide mb-1">Threshold used</div>
            <div className="text-[#666] leading-relaxed font-mono text-[10px]">{signal.threshold}</div>
          </div>
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-wide mb-1">Right now</div>
            <div className="text-[#aaa] leading-relaxed">{signal.what_it_means_now}</div>
          </div>
          {signal.score !== 0 && (
            <div className={`rounded-lg p-2.5 ${bull ? "bg-[#0d2a0d]" : "bg-[#2a0d0d]"}`}>
              <div className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: dotColor }}>Action</div>
              <div className="leading-relaxed font-medium" style={{ color: dotColor }}>{signal.action}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function StockPage({ symbol, onBack, portfolios }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [signals, setSignals] = useState<SignalsResponse | null>(null);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const [signalInsightLoading, setSignalInsightLoading] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);

  useEffect(() => {
    setLoading(true);
    getStockData(symbol)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [symbol]);

  // Fetch signals (no AI insight initially — fast)
  useEffect(() => {
    setSignalsLoading(true);
    setSignals(null);
    getSignals(symbol, false)
      .then(setSignals)
      .catch(() => setSignals(null))
      .finally(() => setSignalsLoading(false));
  }, [symbol]);

  const handleFetchInsight = () => {
    setSignalInsightLoading(true);
    getSignals(symbol, true)
      .then(setSignals)
      .finally(() => setSignalInsightLoading(false));
  };

  const handleRefresh = () => {
    setRefreshing(true);
    getStockData(symbol, true)
      .then(setData)
      .finally(() => setRefreshing(false));
  };

  const buyTargets = useBuyTargets([symbol]);
  const bt = buyTargets.get(symbol);

  // My position across all portfolios
  const myPosition = useMemo(() => {
    let totalQty = 0, totalCost = 0, currentValue = 0;
    for (const p of portfolios) {
      for (const h of p.holdings) {
        if (h.symbol === symbol) {
          totalQty += h.total_quantity;
          totalCost += h.total_cost;
          currentValue += h.current_value;
        }
      }
    }
    if (totalQty <= 0) return null;
    const gainLoss = currentValue - totalCost;
    const gainLossPct = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
    return { totalQty, totalCost, currentValue, gainLoss, gainLossPct };
  }, [portfolios, symbol]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-[#555] text-sm">Loading {symbol}…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="text-white mb-2">Could not load data for {symbol}</div>
          <button onClick={onBack} className="text-[#555] hover:text-white text-sm">← Go back</button>
        </div>
      </div>
    );
  }

  const info = data.yf_info || {};
  const profile = data.profile || {};
  const income = data.income_statement || [];
  const cashflow = data.cash_flow || [];
  const keyMetrics = data.key_metrics || [];
  const segments = data.revenue_segments || [];
  const analystRecs = data.analyst_recommendations || [];
  const priceTargets = data.price_targets || [];

  const currentPrice = data.current_price || info.marketCap ? data.current_price : 0;
  const prevClose = data.previous_close;
  const dayChange = prevClose && currentPrice ? currentPrice - prevClose : 0;
  const dayChangePct = prevClose && prevClose > 0 ? (dayChange / prevClose) * 100 : 0;
  const isUp = dayChange >= 0;

  const name = profile.companyName || info.longName || symbol;
  const sector = profile.sector || info.sector || "";
  const mktCap = profile.mktCap || info.marketCap;
  const w52hi = profile.range ? parseFloat(profile.range.split("-")[1]) : info.fiftyTwoWeekHigh;
  const w52lo = profile.range ? parseFloat(profile.range.split("-")[0]) : info.fiftyTwoWeekLow;
  const desc = profile.description || info.longBusinessSummary || "";
  const website = profile.website || info.website || "";
  const employees = profile.fullTimeEmployees || info.fullTimeEmployees;

  const fwdPE = profile.pe || info.forwardPE;
  const trailPE = info.trailingPE;
  const evEbitda = keyMetrics[0]?.evToEbitda ?? info.enterpriseToEbitda;
  const ps = keyMetrics[0]?.priceToSalesRatio ?? info.enterpriseToRevenue;
  const beta = profile.beta ?? info.beta;
  const divYield = profile.lastDiv ? null : info.dividendYield;

  const targetMean = priceTargets[0]?.priceTarget ?? info.targetMeanPrice;
  const targetLow = info.targetLowPrice;
  const targetHigh = info.targetHighPrice;
  const recKey = profile.recommendation || info.recommendationKey || "";

  // Analyst recommendation count breakdown
  const recCounts = analystRecs.reduce((acc: Record<string, number>, r: any) => {
    const k = r.analystRatingsbuy != null ? "buy" : "hold";
    (["strongBuy", "buy", "hold", "sell", "strongSell"] as const).forEach((f: any) => {
      if (r[`analystRatings${f.charAt(0).toUpperCase()}${f.slice(1)}`] != null) acc[f] = (acc[f] || 0) + 1;
    });
    return acc;
  }, {});

  const latestIncome = income[0] || {};
  const latestCF = cashflow[0] || {};

  const grossMarginPct = latestIncome.grossProfitRatio != null
    ? latestIncome.grossProfitRatio * 100
    : info.grossMargins != null ? info.grossMargins * 100 : null;
  const opMarginPct = latestIncome.operatingIncomeRatio != null
    ? latestIncome.operatingIncomeRatio * 100
    : info.operatingMargins != null ? info.operatingMargins * 100 : null;
  const netMarginPct = latestIncome.netIncomeRatio != null
    ? latestIncome.netIncomeRatio * 100
    : info.profitMargins != null ? info.profitMargins * 100 : null;

  const roic = keyMetrics[0]?.returnOnInvestedCapital != null
    ? keyMetrics[0].returnOnInvestedCapital * 100 : null;
  const roe = keyMetrics[0]?.roe != null
    ? keyMetrics[0].roe * 100
    : info.returnOnEquity != null ? info.returnOnEquity * 100 : null;
  const fcfYield = keyMetrics[0]?.freeCashFlowYield != null
    ? keyMetrics[0].freeCashFlowYield * 100 : null;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* ── Hero header ── */}
      <div className="bg-[#141414] border-b border-[#2a2a2a] px-6 py-5">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <button onClick={onBack} className="text-[#555] hover:text-white mt-1 transition-colors">
                <ArrowLeft size={18} />
              </button>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-white text-2xl font-bold">{symbol}</span>
                  {sector && (
                    <span className="text-[10px] text-[#555] bg-[#1a1a1a] border border-[#2a2a2a] px-2 py-0.5 rounded">
                      {sector}
                    </span>
                  )}
                  {website && (
                    <a href={website} target="_blank" rel="noopener noreferrer"
                      className="text-[#555] hover:text-[#8a8a8a] transition-colors">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <div className="text-[#8a8a8a] text-sm">{name}</div>
              </div>
            </div>

            <div className="flex items-start gap-6">
              {currentPrice > 0 && (
                <div className="text-right">
                  <div className="text-white text-2xl font-bold">{fmtPrice(currentPrice)}</div>
                  <div className={`text-sm font-medium ${isUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                    {isUp ? "+" : ""}{fmtPrice(dayChange)} ({isUp ? "+" : ""}{dayChangePct.toFixed(2)}%)
                  </div>
                </div>
              )}
              <button onClick={handleRefresh} disabled={refreshing}
                className="text-[#555] hover:text-white transition-colors mt-1 disabled:opacity-40">
                <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {/* Quick stats strip */}
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mt-4">
            <Stat label="Market Cap" value={fmtBig(mktCap)} />
            <Stat label="52W High" value={w52hi ? fmtPrice(w52hi) : "—"} />
            <Stat label="52W Low" value={w52lo ? fmtPrice(w52lo) : "—"} />
            <Stat label="P/E (Fwd)" value={fwdPE ? fmtX(fwdPE) : "—"} />
            <Stat label="P/E (Trail)" value={trailPE ? fmtX(trailPE) : "—"} />
            <Stat label="EV/EBITDA" value={evEbitda ? fmtX(evEbitda) : "—"} />
            <Stat label="Beta" value={beta ? fmtNum(beta) : "—"} />
            <Stat label="Dividend" value={divYield ? `${(divYield * 100).toFixed(2)}%` : "—"} />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex gap-5 items-start">

          {/* ── Left column ── */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* Company description */}
            {desc && (
              <Section title="About">
                <p className={`text-[#8a8a8a] text-sm leading-relaxed ${aboutExpanded ? "" : "line-clamp-4"}`}>
                  {desc}
                </p>
                <button
                  onClick={() => setAboutExpanded((v) => !v)}
                  className="mt-2 text-xs text-[#4f8ef7] hover:text-[#7aabff] transition-colors"
                >
                  {aboutExpanded ? "Show less ↑" : "Show more ↓"}
                </button>
              </Section>
            )}

            {/* Price + Technical Chart */}
            <Section title="Price & Technical Chart">
              {signals?.chart_data && signals.chart_data.length > 0 ? (
                <TechnicalChart data={signals.chart_data} currentPrice={currentPrice} />
              ) : (
                <PriceChart symbol={symbol} currentPrice={currentPrice} />
              )}
            </Section>

            {/* Financial Snapshot */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#2a2a2a]">
                <h3 className="text-white font-semibold text-sm">Financial Snapshot</h3>
                <div className="text-[#555] text-xs mt-0.5">Last 5 quarters · QoQ & YoY growth</div>
              </div>
              <div className="py-3">
                <FinancialSnapshot symbol={symbol} />
              </div>
            </div>

            {/* DCF Calculator */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[#2a2a2a]">
                <h3 className="text-white font-semibold text-sm">DCF Calculator</h3>
                <div className="text-[#555] text-xs mt-0.5">Intrinsic value based on discounted future cash flows</div>
              </div>
              <div className="p-5">
                <DCFCalculator symbol={symbol} currentPrice={currentPrice > 0 ? currentPrice : undefined} />
              </div>
            </div>

            {/* Technical Signals */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Zap size={14} className="text-[#f7c44f]" />
                  <h3 className="text-white font-semibold text-sm">Technical Signals</h3>
                  {!signalsLoading && signals && !signals.error && (
                    <ScoreBadge score={signals.score} />
                  )}
                </div>
                {!signalsLoading && signals && !signals.error && !signals.ai_insight && (
                  <button
                    onClick={handleFetchInsight}
                    disabled={signalInsightLoading}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#8a8a8a] hover:text-white hover:border-[#444] transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {signalInsightLoading ? (
                      <><RefreshCw size={10} className="animate-spin" />Analyzing…</>
                    ) : (
                      <><Zap size={10} />Get AI Insight</>
                    )}
                  </button>
                )}
              </div>

              {signalsLoading ? (
                <div className="text-[#444] text-sm py-4 text-center">Computing signals…</div>
              ) : !signals || signals.error ? (
                <div className="text-[#444] text-sm py-4 text-center">Could not load signals</div>
              ) : (
                <div className="space-y-4">
                  {/* AI Insight card */}
                  {signals.ai_insight && (
                    <div className={`rounded-xl p-4 border ${
                      signals.ai_insight.verdict === "bullish" ? "bg-[#071a07] border-[#1a3a1a]" :
                      signals.ai_insight.verdict === "bearish" ? "bg-[#1a0707] border-[#3a1a1a]" :
                      "bg-[#0d0d0d] border-[#222]"
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        <Zap size={12} className="text-[#f7c44f]" />
                        <span className="text-[#f7c44f] text-xs font-semibold uppercase tracking-wide">AI Signal Insight</span>
                        <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          signals.ai_insight.verdict === "bullish" ? "bg-[#0a2a0a] text-[#00c805]" :
                          signals.ai_insight.verdict === "bearish" ? "bg-[#2a0a0a] text-[#ff5000]" :
                          signals.ai_insight.verdict === "mixed"   ? "bg-[#261f00] text-[#f7c44f]" :
                          "bg-[#222] text-[#8a8a8a]"
                        }`}>
                          {signals.ai_insight.verdict.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-white font-semibold text-sm mb-2">{signals.ai_insight.headline}</div>
                      <div className="text-[#aaa] text-xs leading-relaxed mb-3">{signals.ai_insight.insight}</div>
                      <div className="grid grid-cols-1 gap-2">
                        <div className="bg-[#ffffff08] rounded-lg p-2.5">
                          <div className="text-[10px] text-[#555] uppercase tracking-wide mb-0.5">Action</div>
                          <div className="text-xs text-[#00c805] font-medium">{signals.ai_insight.key_action}</div>
                        </div>
                        <div className="bg-[#ffffff08] rounded-lg p-2.5">
                          <div className="text-[10px] text-[#555] uppercase tracking-wide mb-0.5">Key Risk</div>
                          <div className="text-xs text-[#ff8800]">{signals.ai_insight.main_risk}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Signal cards grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {signals.signals.map(sig => (
                      <SignalCard key={sig.id} signal={sig} />
                    ))}
                  </div>

                  {/* Score legend */}
                  <div className="flex flex-wrap gap-3 text-[10px] text-[#444] pt-1 border-t border-[#1a1a1a]">
                    <span>Score key:</span>
                    <span className="text-[#00c805]">+5 to +10 Strong Bull</span>
                    <span className="text-[#4dbb50]">+2 to +4 Mild Bull</span>
                    <span className="text-[#555]">-1 to +1 Neutral</span>
                    <span className="text-[#ff8800]">-2 to -4 Mild Bear</span>
                    <span className="text-[#ff5000]">-5 to -10 Strong Bear</span>
                  </div>
                </div>
              )}
            </div>

            {/* Revenue */}
            {income.length > 0 ? (
              <Section title="Revenue">
                <FinChart rows={income} valueKey="revenue" label="Annual Revenue" color="#4f8ef7" />
              </Section>
            ) : info.totalRevenue && (
              <Section title="Revenue">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="TTM Revenue" value={fmtBig(info.totalRevenue)} />
                  <Stat label="Revenue Growth (TTM)" value={info.revenueGrowth != null ? fmtPct(info.revenueGrowth * 100) : "—"}
                    green={info.revenueGrowth != null ? info.revenueGrowth >= 0 : undefined} />
                </div>
              </Section>
            )}

            {/* Net Income + FCF side by side */}
            {income.length > 0 && (
              <div className="grid grid-cols-2 gap-5">
                <Section title="Net Income">
                  <FinChart rows={income} valueKey="netIncome" label="Annual Net Income" color="#00c805" />
                </Section>
                <Section title="Free Cash Flow">
                  <FinChart rows={cashflow} valueKey="freeCashFlow" label="Annual FCF" color="#a78bfa" />
                </Section>
              </div>
            )}

            {/* EBITDA + EPS */}
            {income.length > 0 && (
              <div className="grid grid-cols-2 gap-5">
                <Section title="EBITDA">
                  <FinChart rows={income} valueKey="ebitda" label="Annual EBITDA" color="#f7c44f" />
                </Section>
                <Section title="EPS (Diluted)">
                  <FinChart rows={income} valueKey="epsDiluted" label="Annual EPS" color="#4dbb50" />
                </Section>
              </div>
            )}

            {/* Operating Cash Flow */}
            {cashflow.length > 0 && (
              <Section title="Operating Cash Flow">
                <FinChart rows={cashflow} valueKey="operatingCashFlow" label="Annual Operating Cash Flow" color="#4f8ef7" />
              </Section>
            )}

            {/* Margins */}
            {income.length > 0 && (
              <Section title="Profit Margins">
                <div className="flex items-center gap-4 mb-3">
                  <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-[#4f8ef7]" /><span className="text-[#555] text-xs">Gross</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-[#a78bfa]" /><span className="text-[#555] text-xs">Operating</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-[#00c805]" /><span className="text-[#555] text-xs">Net</span></div>
                </div>
                <MarginChart rows={income} />
              </Section>
            )}

            {/* Revenue segments */}
            <SegmentsSection segments={segments} />

            {/* Key metrics table */}
            <Section title="Key Metrics">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {grossMarginPct != null && <Stat label="Gross Margin" value={`${grossMarginPct.toFixed(1)}%`} green={grossMarginPct > 30} />}
                {opMarginPct != null && <Stat label="Operating Margin" value={`${opMarginPct.toFixed(1)}%`} green={opMarginPct > 15} />}
                {netMarginPct != null && <Stat label="Net Margin" value={`${netMarginPct.toFixed(1)}%`} green={netMarginPct > 10} />}
                {roe != null && <Stat label="Return on Equity" value={`${roe.toFixed(1)}%`} green={roe > 15} />}
                {roic != null && <Stat label="ROIC" value={`${roic.toFixed(1)}%`} green={roic > 10} />}
                {fcfYield != null && <Stat label="FCF Yield" value={`${fcfYield.toFixed(1)}%`} green={fcfYield > 3} />}
                {ps != null && <Stat label="Price / Sales" value={fmtX(ps)} />}
                {info.priceToBook != null && <Stat label="Price / Book" value={fmtX(info.priceToBook)} />}
                {info.pegRatio != null && <Stat label="PEG Ratio" value={fmtNum(info.pegRatio)} />}
                {info.totalDebt != null && <Stat label="Total Debt" value={fmtBig(info.totalDebt)} />}
                {info.totalCash != null && <Stat label="Cash" value={fmtBig(info.totalCash)} />}
                {employees != null && <Stat label="Employees" value={employees.toLocaleString()} />}
              </div>
            </Section>

            {/* Historical key metrics table */}
            {keyMetrics.length > 1 && (
              <Section title="Valuation History">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[#555] border-b border-[#1a1a1a]">
                        <th className="text-left pb-2 font-medium">Year</th>
                        <th className="text-right pb-2 font-medium">P/E</th>
                        <th className="text-right pb-2 font-medium">EV/EBITDA</th>
                        <th className="text-right pb-2 font-medium">P/S</th>
                        <th className="text-right pb-2 font-medium">ROE</th>
                        <th className="text-right pb-2 font-medium">ROIC</th>
                        <th className="text-right pb-2 font-medium">FCF Yield</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...keyMetrics].slice(0, 8).map((km: any) => (
                        <tr key={km.date} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors">
                          <td className="py-2 text-[#8a8a8a]">{(km.date || "").slice(0, 4)}</td>
                          <td className="py-2 text-right text-white">{km.peRatio != null ? fmtX(km.peRatio) : "—"}</td>
                          <td className="py-2 text-right text-white">{km.evToEbitda != null ? fmtX(km.evToEbitda) : "—"}</td>
                          <td className="py-2 text-right text-white">{km.priceToSalesRatio != null ? fmtX(km.priceToSalesRatio) : "—"}</td>
                          <td className="py-2 text-right text-white">{km.roe != null ? `${(km.roe * 100).toFixed(1)}%` : "—"}</td>
                          <td className="py-2 text-right text-white">{km.returnOnInvestedCapital != null ? `${(km.returnOnInvestedCapital * 100).toFixed(1)}%` : "—"}</td>
                          <td className="py-2 text-right text-white">{km.freeCashFlowYield != null ? `${(km.freeCashFlowYield * 100).toFixed(1)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

          </div>

          {/* ── Right sidebar ── */}
          <div className="w-[360px] shrink-0 sticky top-6 space-y-4">

            {/* Technical signal score compact card */}
            {!signalsLoading && signals && !signals.error && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <Zap size={12} className="text-[#f7c44f]" />
                    <span className="text-[#8a8a8a] text-xs uppercase tracking-wide">Signal Score</span>
                  </div>
                  <ScoreBadge score={signals.score} />
                </div>
                {/* Top 2 signals */}
                <div className="space-y-1.5">
                  {signals.signals
                    .filter(s => s.score !== 0)
                    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
                    .slice(0, 3)
                    .map(s => (
                      <div key={s.id} className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                          style={{ backgroundColor: s.direction === "bullish" ? "#00c805" : s.direction === "bearish" ? "#ff5000" : "#555" }} />
                        <div className="text-[11px] text-[#777] leading-snug">{s.title}</div>
                      </div>
                    ))}
                </div>
                {!signals.ai_insight && (
                  <button onClick={handleFetchInsight} disabled={signalInsightLoading}
                    className="mt-3 w-full text-xs py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#555] hover:text-white hover:border-[#444] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                    {signalInsightLoading ? <><RefreshCw size={10} className="animate-spin" />Analyzing…</> : <><Zap size={10} />Get AI Insight</>}
                  </button>
                )}
              </div>
            )}

            {/* My position */}
            {myPosition && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
                <div className="text-[#8a8a8a] text-xs uppercase tracking-wide mb-3">My Position</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[#555] text-xs">Shares</div>
                    <div className="text-white font-semibold">{myPosition.totalQty.toFixed(4)}</div>
                  </div>
                  <div>
                    <div className="text-[#555] text-xs">Avg Cost</div>
                    <div className="text-white font-semibold">{fmtPrice(myPosition.totalCost / myPosition.totalQty)}</div>
                  </div>
                  <div>
                    <div className="text-[#555] text-xs">Market Value</div>
                    <div className="text-white font-semibold">{fmtPrice(myPosition.currentValue)}</div>
                  </div>
                  <div>
                    <div className="text-[#555] text-xs">Total Return</div>
                    <div className={`font-semibold ${myPosition.gainLoss >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                      {myPosition.gainLoss >= 0 ? "+" : ""}{fmtPrice(myPosition.gainLoss)}
                    </div>
                    <div className={`text-xs ${myPosition.gainLoss >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                      {myPosition.gainLossPct >= 0 ? "+" : ""}{myPosition.gainLossPct.toFixed(2)}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Buy target */}
            {bt && bt.base_buy_price && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
                <div className="text-[#8a8a8a] text-xs uppercase tracking-wide mb-3">20% CAGR Buy Target</div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-white text-xl font-bold">{fmtPrice(bt.base_buy_price)}</div>
                  {bt.signal && SIGNAL[bt.signal] && (
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${SIGNAL[bt.signal].bg} ${SIGNAL[bt.signal].text}`}>
                      {SIGNAL[bt.signal].label}
                    </span>
                  )}
                </div>
                {currentPrice > 0 && bt.base_buy_price && (
                  <div className={`text-sm ${currentPrice < bt.base_buy_price ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                    {currentPrice < bt.base_buy_price ? "▼" : "▲"}{" "}
                    {Math.abs(((currentPrice - bt.base_buy_price) / bt.base_buy_price) * 100).toFixed(1)}%
                    {" "}{currentPrice < bt.base_buy_price ? "below" : "above"} target
                  </div>
                )}
                <div className="text-[#444] text-xs mt-2">Based on analyst consensus ÷ 1.20</div>
              </div>
            )}

            {/* Analyst targets */}
            {(targetMean || targetLow || targetHigh) && currentPrice > 0 && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
                <div className="text-[#8a8a8a] text-xs uppercase tracking-wide mb-3">
                  Analyst Targets {info.numberOfAnalystOpinions ? `· ${info.numberOfAnalystOpinions} analysts` : ""}
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="text-center">
                    <div className="text-[#555] text-xs">Low</div>
                    <div className="text-white font-semibold text-sm">{targetLow ? fmtPrice(targetLow) : "—"}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[#555] text-xs">Mean</div>
                    <div className="text-white font-bold">{targetMean ? fmtPrice(targetMean) : "—"}</div>
                    {targetMean && currentPrice && (
                      <div className={`text-xs ${targetMean > currentPrice ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                        {targetMean > currentPrice ? "+" : ""}{(((targetMean - currentPrice) / currentPrice) * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                  <div className="text-center">
                    <div className="text-[#555] text-xs">High</div>
                    <div className="text-white font-semibold text-sm">{targetHigh ? fmtPrice(targetHigh) : "—"}</div>
                  </div>
                </div>
                {targetLow && targetMean && targetHigh && (
                  <AnalystTargetBar low={targetLow} mean={targetMean} high={targetHigh} current={currentPrice} />
                )}
                {recKey && (
                  <div className="mt-4 text-center">
                    <span className={`text-xs font-semibold px-3 py-1 rounded-lg ${
                      recKey.includes("buy") ? "bg-[#0a2a0a] text-[#00c805]" :
                      recKey.includes("sell") ? "bg-[#2a0a0a] text-[#ff5000]" :
                      "bg-[#222] text-[#8a8a8a]"
                    }`}>
                      {recKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Analyst recommendation history */}
            {priceTargets.length > 0 && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
                <div className="text-[#8a8a8a] text-xs uppercase tracking-wide mb-3">Recent Analyst Calls</div>
                <div className="space-y-2">
                  {priceTargets.slice(0, 6).map((pt: any, i: number) => (
                    <div key={i} className="flex items-center justify-between">
                      <div>
                        <div className="text-white text-xs font-medium">{pt.analystCompany || pt.analyst || "Analyst"}</div>
                        <div className="text-[#555] text-[10px]">{(pt.publishedDate || pt.date || "").slice(0, 10)}</div>
                      </div>
                      <div className="text-right">
                        {pt.priceTarget && <div className="text-white text-xs font-semibold">{fmtPrice(pt.priceTarget)}</div>}
                        {pt.rating && (
                          <div className={`text-[9px] font-medium ${
                            pt.rating?.toLowerCase().includes("buy") ? "text-[#00c805]" :
                            pt.rating?.toLowerCase().includes("sell") ? "text-[#ff5000]" :
                            "text-[#8a8a8a]"
                          }`}>{pt.rating}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Popi seeded with this stock */}
            <Popi seedSymbol={symbol} />

          </div>
        </div>
      </div>
    </div>
  );
}
