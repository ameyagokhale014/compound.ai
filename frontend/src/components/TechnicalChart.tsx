/**
 * TechnicalChart — 4-panel stacked chart for StockPage.
 * Panels: Price + overlays | Volume | RSI | MACD
 */
import { useState, useMemo } from "react";
import {
  ComposedChart, LineChart, BarChart,
  Line, Bar, Area, XAxis, YAxis, Tooltip,
  ReferenceLine, CartesianGrid, ResponsiveContainer, Cell,
} from "recharts";
import type { ChartRow } from "../api";

interface Props {
  data: ChartRow[];
  currentPrice?: number;
}

type Overlay = "sma20" | "sma50" | "sma200" | "ema9" | "ema21" | "bb";
type Period = "1M" | "3M" | "6M" | "1Y";

const PERIOD_DAYS: Record<Period, number> = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252 };

const OVERLAY_CFG: Record<Overlay, { label: string; color: string }> = {
  sma20:  { label: "SMA 20",  color: "#f7c44f" },
  sma50:  { label: "SMA 50",  color: "#4f8ef7" },
  sma200: { label: "SMA 200", color: "#a78bfa" },
  ema9:   { label: "EMA 9",   color: "#00c805" },
  ema21:  { label: "EMA 21",  color: "#ff8800" },
  bb:     { label: "Bands",   color: "#555" },
};

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtK(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

export default function TechnicalChart({ data, currentPrice }: Props) {
  const [period, setPeriod] = useState<Period>("6M");
  const [overlays, setOverlays] = useState<Set<Overlay>>(new Set(["sma20", "sma50"]));

  const toggleOverlay = (o: Overlay) =>
    setOverlays(prev => {
      const next = new Set(prev);
      next.has(o) ? next.delete(o) : next.add(o);
      return next;
    });

  const sliced = useMemo(() => {
    const days = PERIOD_DAYS[period];
    return data.slice(-days);
  }, [data, period]);

  const firstClose = sliced.length > 0 ? sliced[0].close : null;
  const lastClose  = sliced.length > 0 ? sliced[sliced.length - 1].close : null;
  const displayEnd = (currentPrice && currentPrice > 0) ? currentPrice : lastClose;
  const change     = (firstClose && displayEnd) ? displayEnd - firstClose : null;
  const changePct  = (firstClose && change != null) ? (change / firstClose) * 100 : null;
  const isUp       = change == null || change >= 0;
  const lineColor  = isUp ? "#00c805" : "#ff5000";

  // Tick interval so we don't crowd the x-axis
  const tickInterval = Math.max(1, Math.floor(sliced.length / 7));

  // Custom tooltip shared across panels
  const PriceTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d: ChartRow = payload[0]?.payload;
    const c = d.close;
    const chg = firstClose && c != null ? c - firstClose : null;
    const chgP = firstClose && chg != null ? (chg / firstClose) * 100 : null;
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-xl px-3 py-2.5 text-xs space-y-1 z-50 pointer-events-none min-w-[160px]">
        <div className="text-[#8a8a8a] font-medium">{label}</div>
        <div className="text-white font-bold text-sm">{fmt(c)}</div>
        {chg != null && (
          <div className={chg >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}>
            {chg >= 0 ? "+" : ""}{fmt(chg)} ({chg >= 0 ? "+" : ""}{chgP!.toFixed(2)}%)
          </div>
        )}
        <div className="border-t border-[#2a2a2a] pt-1 space-y-0.5 text-[#777]">
          {overlays.has("sma20")  && d.sma20  && <div>SMA20: {fmt(d.sma20)}</div>}
          {overlays.has("sma50")  && d.sma50  && <div>SMA50: {fmt(d.sma50)}</div>}
          {overlays.has("sma200") && d.sma200 && <div>SMA200: {fmt(d.sma200)}</div>}
          {overlays.has("ema9")   && d.ema9   && <div>EMA9: {fmt(d.ema9)}</div>}
          {overlays.has("ema21")  && d.ema21  && <div>EMA21: {fmt(d.ema21)}</div>}
          {d.volume != null && <div>Vol: {fmtK(d.volume)}</div>}
        </div>
      </div>
    );
  };

  const RsiTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const v = payload[0]?.value;
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-2 py-1.5 text-xs pointer-events-none">
        <span className="text-[#8a8a8a]">RSI: </span>
        <span className={v < 30 ? "text-[#00c805]" : v > 70 ? "text-[#ff5000]" : "text-white"}>{v?.toFixed(1)}</span>
      </div>
    );
  };

  const MacdTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-2 py-1.5 text-xs space-y-0.5 pointer-events-none">
        {d.macd      != null && <div><span className="text-[#4f8ef7]">MACD: </span><span className="text-white">{d.macd.toFixed(4)}</span></div>}
        {d.macd_signal != null && <div><span className="text-[#f7c44f]">Signal: </span><span className="text-white">{d.macd_signal.toFixed(4)}</span></div>}
        {d.macd_hist != null && <div><span className={d.macd_hist >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}>Hist: {d.macd_hist.toFixed(4)}</span></div>}
      </div>
    );
  };

  const VolTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-[#1a1a1a] border border-[#333] rounded-lg px-2 py-1.5 text-xs pointer-events-none">
        <span className="text-[#8a8a8a]">Vol: </span>
        <span className="text-white">{fmtK(d.volume)}</span>
        {d.vol_ma20 && <><br /><span className="text-[#8a8a8a]">Avg20: </span><span className="text-[#555]">{fmtK(d.vol_ma20)}</span></>}
      </div>
    );
  };

  const yDomain = useMemo(() => {
    const closes = sliced.map(d => d.close).filter((v): v is number => v != null);
    if (!closes.length) return ["auto", "auto"] as [string, string];
    let lo = Math.min(...closes), hi = Math.max(...closes);
    if (overlays.has("bb")) {
      const bbs = sliced.flatMap(d => [d.bb_upper, d.bb_lower]).filter((v): v is number => v != null);
      if (bbs.length) { lo = Math.min(lo, ...bbs); hi = Math.max(hi, ...bbs); }
    }
    const pad = (hi - lo) * 0.05;
    return [lo - pad, hi + pad] as [number, number];
  }, [sliced, overlays]);

  return (
    <div className="space-y-0">
      {/* ── Controls ── */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        {/* Period pills */}
        <div className="flex gap-1">
          {(["1M", "3M", "6M", "1Y"] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                period === p ? "bg-[#222] text-white" : "text-[#555] hover:text-[#8a8a8a]"
              }`}>{p}</button>
          ))}
        </div>

        {/* Return pill */}
        {change != null && (
          <div className="flex items-center gap-2">
            {displayEnd && <span className="text-white font-semibold text-sm">${displayEnd.toFixed(2)}</span>}
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${
              isUp ? "bg-[#0a2a0a] text-[#00c805]" : "bg-[#2a0a0a] text-[#ff5000]"
            }`}>
              {isUp ? "+" : ""}{fmt(change)} ({isUp ? "+" : ""}{changePct!.toFixed(2)}%)
            </span>
            <span className="text-[#444] text-[10px]">{period}</span>
          </div>
        )}
      </div>

      {/* Overlay toggles */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {(Object.keys(OVERLAY_CFG) as Overlay[]).map(o => (
          <button key={o} onClick={() => toggleOverlay(o)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors ${
              overlays.has(o)
                ? "border-transparent text-black"
                : "border-[#2a2a2a] text-[#555] hover:text-[#888]"
            }`}
            style={overlays.has(o) ? { backgroundColor: OVERLAY_CFG[o].color } : {}}>
            {OVERLAY_CFG[o].label}
          </button>
        ))}
      </div>

      {/* ── Panel 1: Price ── */}
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={sliced} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#151515" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "#444", fontSize: 9 }} axisLine={false} tickLine={false}
            tickFormatter={v => v.slice(5)} interval={tickInterval} />
          <YAxis domain={yDomain} tick={{ fill: "#444", fontSize: 9 }} axisLine={false} tickLine={false}
            tickFormatter={v => `$${v.toFixed(0)}`} width={52} />
          <Tooltip content={<PriceTooltip />} cursor={{ stroke: "#333", strokeWidth: 1 }} />

          {/* BB fill */}
          {overlays.has("bb") && (
            <>
              <Area dataKey="bb_upper" stroke="none" fill="#333" fillOpacity={0.15} stackId="bb" isAnimationActive={false} />
              <Area dataKey="bb_lower" stroke="none" fill="#0a0a0a" fillOpacity={1} stackId="bb" isAnimationActive={false} />
              <Line dataKey="bb_upper" stroke="#444" strokeWidth={1} dot={false} strokeDasharray="3 3" isAnimationActive={false} />
              <Line dataKey="bb_lower" stroke="#444" strokeWidth={1} dot={false} strokeDasharray="3 3" isAnimationActive={false} />
              <Line dataKey="bb_mid"   stroke="#2a2a2a" strokeWidth={1} dot={false} isAnimationActive={false} />
            </>
          )}

          {/* Overlays */}
          {overlays.has("sma20")  && <Line dataKey="sma20"  stroke={OVERLAY_CFG.sma20.color}  strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          {overlays.has("sma50")  && <Line dataKey="sma50"  stroke={OVERLAY_CFG.sma50.color}  strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          {overlays.has("sma200") && <Line dataKey="sma200" stroke={OVERLAY_CFG.sma200.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          {overlays.has("ema9")   && <Line dataKey="ema9"   stroke={OVERLAY_CFG.ema9.color}   strokeWidth={1.5} dot={false} isAnimationActive={false} />}
          {overlays.has("ema21")  && <Line dataKey="ema21"  stroke={OVERLAY_CFG.ema21.color}  strokeWidth={1.5} dot={false} isAnimationActive={false} />}

          {/* Price line */}
          <Line dataKey="close" stroke={lineColor} strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* ── Panel 2: Volume ── */}
      <ResponsiveContainer width="100%" height={55}>
        <ComposedChart data={sliced} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide />
          <Tooltip content={<VolTooltip />} cursor={false} />
          <Bar dataKey="volume" isAnimationActive={false} radius={[1, 1, 0, 0]}>
            {sliced.map((d, i) => {
              const prev = i > 0 ? sliced[i - 1].close : d.close;
              const up = (d.close ?? 0) >= (prev ?? 0);
              return <Cell key={i} fill={up ? "#1a3a1a" : "#3a1a1a"} />;
            })}
          </Bar>
          <Line dataKey="vol_ma20" stroke="#555" strokeWidth={1} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* ── Panel 3: RSI ── */}
      <div className="relative">
        <div className="absolute left-1 top-1 text-[9px] text-[#444] font-medium z-10">RSI(14)</div>
        <ResponsiveContainer width="100%" height={72}>
          <ComposedChart data={sliced} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis domain={[0, 100]} ticks={[30, 70]} tick={{ fill: "#444", fontSize: 8 }} axisLine={false} tickLine={false} width={24} />
            <CartesianGrid strokeDasharray="3 3" stroke="#151515" vertical={false} />
            <Tooltip content={<RsiTooltip />} cursor={{ stroke: "#333", strokeWidth: 1 }} />
            {/* Overbought / oversold zones */}
            <ReferenceLine y={70} stroke="#ff500033" strokeWidth={1} strokeDasharray="3 3" />
            <ReferenceLine y={30} stroke="#00c80533" strokeWidth={1} strokeDasharray="3 3" />
            <Area dataKey="rsi" stroke="none" fill="#ff500015"
              type="monotone" dot={false} isAnimationActive={false}
              // shade above 70
            />
            <Line dataKey="rsi" stroke="#a78bfa" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Panel 4: MACD ── */}
      <div className="relative">
        <div className="absolute left-1 top-1 text-[9px] text-[#444] font-medium z-10">MACD(12,26,9)</div>
        <ResponsiveContainer width="100%" height={72}>
          <ComposedChart data={sliced} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#151515" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#444", fontSize: 9 }} axisLine={false} tickLine={false}
              tickFormatter={v => v.slice(5)} interval={tickInterval} />
            <YAxis tick={{ fill: "#444", fontSize: 8 }} axisLine={false} tickLine={false}
              tickFormatter={v => v.toFixed(1)} width={28} />
            <Tooltip content={<MacdTooltip />} cursor={{ stroke: "#333", strokeWidth: 1 }} />
            <ReferenceLine y={0} stroke="#2a2a2a" />
            <Bar dataKey="macd_hist" isAnimationActive={false} radius={[1, 1, 0, 0]}>
              {sliced.map((d, i) => (
                <Cell key={i} fill={(d.macd_hist ?? 0) >= 0 ? "#1a3a1a" : "#3a1a1a"} />
              ))}
            </Bar>
            <Line dataKey="macd"        stroke="#4f8ef7" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="macd_signal" stroke="#f7c44f" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-3 pt-1 text-[10px] text-[#444]">
        <span className="flex items-center gap-1"><span className="inline-block w-6 border-t-2" style={{ borderColor: lineColor }} />Price</span>
        {(Object.keys(OVERLAY_CFG) as Overlay[]).filter(o => overlays.has(o) && o !== "bb").map(o => (
          <span key={o} className="flex items-center gap-1">
            <span className="inline-block w-6 border-t-2" style={{ borderColor: OVERLAY_CFG[o].color }} />
            {OVERLAY_CFG[o].label}
          </span>
        ))}
        {overlays.has("bb") && <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed border-[#555]" />BB</span>}
        <span className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-[#4f8ef7]" />MACD</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-[#f7c44f]" />Signal</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-[#a78bfa]" />RSI</span>
        </span>
      </div>
    </div>
  );
}
