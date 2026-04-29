import { useState } from "react";
import {
  Sparkles, ChevronDown, ChevronUp, Loader2,
  TrendingDown, TrendingUp, Minus, AlertTriangle, RefreshCw, Info,
} from "lucide-react";
import { getAiBuyTargets } from "../api";
import type { AiBuyTarget, HistoricalPoint, Portfolio } from "../types";

interface Props {
  portfolio: Portfolio;
  onViewStock?: (symbol: string) => void;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function dcf(fwdEps: number, epsGrowthPct: number, exitPe: number, cagrPct: number): number {
  if (!fwdEps || fwdEps <= 0 || exitPe <= 0) return 0;
  return (fwdEps * Math.pow(1 + epsGrowthPct / 100, 5) * exitPe) / Math.pow(1 + cagrPct / 100, 5);
}

function signalFor(current: number, baseBuy: number) {
  if (baseBuy <= 0) return null;
  const d = (current - baseBuy) / baseBuy * 100;
  if (d < -20) return "strong_buy";
  if (d < 0)   return "buy";
  if (d < 15)  return "near_target";
  return "above_target";
}

const SIGNAL_CONFIG = {
  strong_buy:   { label: "Strong Buy",   bg: "bg-[#0a2a0a]", border: "border-[#00c805]", text: "text-[#00c805]", icon: TrendingDown },
  buy:          { label: "Buy",          bg: "bg-[#0f2a0f]", border: "border-[#4caf50]", text: "text-[#4caf50]", icon: TrendingDown },
  near_target:  { label: "Near Target",  bg: "bg-[#2a2a0a]", border: "border-[#f7c44f]", text: "text-[#f7c44f]", icon: Minus },
  above_target: { label: "Above Target", bg: "bg-[#2a0a0a]", border: "border-[#ff5000]", text: "text-[#ff5000]", icon: TrendingUp },
};

// ─── history bar chart ───────────────────────────────────────────────────────

function HistoryBars({
  data, label, formatter, baseColor = "#4f8ef7", avgLabel, avgValueLabel,
  overrideAvgValue, overrideAvgValueLabel,
}: {
  data: HistoricalPoint[];
  label: string;
  formatter: (v: number) => string;
  baseColor?: string;
  avgLabel: string;
  avgValueLabel: string;
  overrideAvgValue?: number | null;
  overrideAvgValueLabel?: string;
}) {
  const nonNull = data.filter((d) => d.value != null).map((d) => Math.abs(d.value!));
  const maxVal = nonNull.length ? Math.max(...nonNull) : 1;

  // CAGR from first to last positive value — the true "avg growth over N years"
  // Fallback to mean of valid YoY values only when fewer than 2 positive points
  const positivePoints = data.filter((d) => d.value != null && d.value > 0);
  let avgGrowth: number | null = null;
  if (positivePoints.length >= 2) {
    const first = positivePoints[0].value!;
    const last  = positivePoints[positivePoints.length - 1].value!;
    const n     = positivePoints.length - 1;
    avgGrowth   = (Math.pow(last / first, 1 / n) - 1) * 100;
  } else {
    const yoyVals = data.map((d) => d.yoy).filter((y): y is number => y != null);
    avgGrowth = yoyVals.length ? yoyVals.reduce((s, v) => s + v, 0) / yoyVals.length : null;
  }

  // Average value across all years
  const vals = data.filter((d) => d.value != null).map((d) => d.value!);
  const avgValue = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;

  return (
    <div className="flex-1">
      <div className="text-[#555] text-[10px] uppercase tracking-wide mb-2">{label}</div>
      <div className="flex items-end gap-1 h-[90px]">
        {data.map((d, i) => {
          const hasVal = d.value != null;
          const barPct = hasVal ? Math.max((Math.abs(d.value!) / maxVal) * 72, 6) : 0;
          const isPos = d.yoy == null ? true : d.yoy >= 0;
          const barColor = i === 0 || d.yoy == null ? baseColor : isPos ? "#00c805" : "#ff5000";

          return (
            <div key={d.year} className="flex-1 flex flex-col items-center justify-end gap-0">
              <div className="text-white text-[9px] font-medium leading-tight text-center whitespace-nowrap">
                {hasVal ? formatter(d.value!) : "—"}
              </div>
              <div className={`text-[8px] font-semibold leading-tight ${d.yoy == null ? "opacity-0" : isPos ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                {d.yoy != null ? `${d.yoy >= 0 ? "+" : ""}${d.yoy}%` : "+0%"}
              </div>
              <div
                className="w-full rounded-sm mt-0.5"
                style={{ height: `${barPct}px`, backgroundColor: hasVal ? barColor : "transparent", opacity: 0.85 }}
              />
              <div className="text-[#555] text-[8px] mt-1">{d.year}</div>
            </div>
          );
        })}
      </div>

      {/* Summary stats below chart */}
      <div className="mt-2 pt-2 border-t border-[#1e1e1e] flex justify-between">
        <div>
          <div className="text-[#555] text-[9px]">{avgLabel}</div>
          <div className={`text-[11px] font-semibold ${avgGrowth == null ? "text-[#555]" : avgGrowth >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}`}>
            {avgGrowth != null ? `${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[#555] text-[9px]">{overrideAvgValue !== undefined ? (overrideAvgValueLabel ?? avgValueLabel) : avgValueLabel}</div>
          <div className={`text-[11px] font-semibold ${overrideAvgValue != null ? (overrideAvgValue >= 0 ? "text-[#00c805]" : "text-[#ff5000]") : "text-white"}`}>
            {overrideAvgValue !== undefined
              ? (overrideAvgValue != null ? `${overrideAvgValue >= 0 ? "+" : ""}${overrideAvgValue.toFixed(1)}%` : "—")
              : (avgValue != null ? formatter(avgValue) : "—")}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── editable inputs per stock ───────────────────────────────────────────────

interface ScenarioInputs { epsGrowth: string; exitPe: string; }
interface StockInputs {
  fwdEps: string;
  epsSource: "yfinance" | "back-calculated" | "missing";
  bear: ScenarioInputs;
  base: ScenarioInputs;
  bull: ScenarioInputs;
  currentPrice: number;
  rationale: { bear: string; base: string; bull: string };
  managementOutlook: string;
  keyRisks: string;
  epsHistory: HistoricalPoint[];
  peHistory: HistoricalPoint[];
  priceCagr5y: number | null;
}

function inputsFromResult(r: AiBuyTarget, cagrPct: number): StockInputs {
  let fwdEps = r.forward_eps_used ?? null;
  let epsSource: StockInputs["epsSource"] = "yfinance";

  if (fwdEps == null || fwdEps <= 0) {
    // Back-calculate implied EPS from Claude's base buy price
    const g = r.base.annual_eps_growth ?? 0;
    const pe = r.base.exit_pe ?? 0;
    if (r.base_buy_price > 0 && pe > 0) {
      fwdEps = (r.base_buy_price * Math.pow(1 + cagrPct / 100, 5)) /
               (Math.pow(1 + g, 5) * pe);
      epsSource = "back-calculated";
    } else {
      epsSource = "missing";
    }
  }

  return {
    fwdEps: fwdEps != null && fwdEps > 0 ? fwdEps.toFixed(2) : "",
    epsSource,
    bear: { epsGrowth: ((r.bear.annual_eps_growth ?? 0) * 100).toFixed(1), exitPe: String(r.bear.exit_pe ?? "") },
    base: { epsGrowth: ((r.base.annual_eps_growth ?? 0) * 100).toFixed(1), exitPe: String(r.base.exit_pe ?? "") },
    bull: { epsGrowth: ((r.bull.annual_eps_growth ?? 0) * 100).toFixed(1), exitPe: String(r.bull.exit_pe ?? "") },
    currentPrice: r.current_price,
    rationale: { bear: r.bear.rationale, base: r.base.rationale, bull: r.bull.rationale },
    managementOutlook: r.management_outlook,
    keyRisks: r.key_risks,
    epsHistory: r.eps_history ?? [],
    peHistory: r.pe_history ?? [],
    priceCagr5y: (r as any).price_cagr_5y ?? null,
  };
}

// ─── small sub-components ───────────────────────────────────────────────────

function NumInput({
  label, value, onChange, suffix, width = "w-20",
}: { label: string; value: string; onChange: (v: string) => void; suffix?: string; width?: string }) {
  return (
    <div>
      <div className="text-[#555] text-[10px] uppercase tracking-wide mb-1">{label}</div>
      <div className="relative">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${width} bg-[#111] border border-[#333] rounded-lg px-2 ${suffix ? "pr-6" : "pr-2"} py-1.5 text-white text-xs outline-none focus:border-[#555] text-right tabular-nums`}
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#555] text-[10px]">{suffix}</span>
        )}
      </div>
    </div>
  );
}

function DistanceChip({ current, buyPrice }: { current: number; buyPrice: number }) {
  if (!buyPrice) return null;
  const d = (current - buyPrice) / buyPrice * 100;
  const up = d >= 0;
  return (
    <span className={`text-[10px] font-medium tabular-nums ${up ? "text-[#ff5000]" : "text-[#00c805]"}`}>
      {up ? "+" : ""}{d.toFixed(1)}%
    </span>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

const DEFAULT_CAGR = "15";

export default function BuyAnalysis({ portfolio, onViewStock }: Props) {
  const [open, setOpen] = useState(false);

  const investableSymbols = Array.from(
    new Set(portfolio.holdings.filter((h) => h.asset_type !== "cash").map((h) => h.symbol))
  );

  const [cagrMap, setCagrMap] = useState<Record<string, string>>(
    () => Object.fromEntries(investableSymbols.map((s) => [s, DEFAULT_CAGR]))
  );
  const [loadingSet, setLoadingSet]   = useState<Set<string>>(new Set());
  const [inputsMap, setInputsMap]     = useState<Record<string, StockInputs>>({});
  const [errorMap, setErrorMap]       = useState<Record<string, string>>({});
  const [detailOpen, setDetailOpen]   = useState<Set<string>>(new Set());

  const syncedCagr = (sym: string) => cagrMap[sym] ?? DEFAULT_CAGR;

  function setAllCagr(v: string) {
    setCagrMap(Object.fromEntries(investableSymbols.map((s) => [s, v])));
  }

  function patchInputs(sym: string, patch: Partial<StockInputs>) {
    setInputsMap((prev) => ({ ...prev, [sym]: { ...prev[sym], ...patch } }));
  }
  function patchScenario(sym: string, scenario: "bear" | "base" | "bull", patch: Partial<ScenarioInputs>) {
    setInputsMap((prev) => ({
      ...prev,
      [sym]: { ...prev[sym], [scenario]: { ...prev[sym][scenario], ...patch } },
    }));
  }

  async function fetchDefaults(symbol: string) {
    const v = parseFloat(syncedCagr(symbol));
    if (isNaN(v) || v <= 0 || v > 100) {
      setErrorMap((p) => ({ ...p, [symbol]: "Invalid CAGR" }));
      return;
    }
    setLoadingSet((p) => new Set(p).add(symbol));
    setErrorMap((p) => { const n = { ...p }; delete n[symbol]; return n; });

    try {
      const data = await getAiBuyTargets(portfolio.id, { [symbol]: v });
      const result = data.find((r) => r.symbol === symbol) ?? data[0];
      if (result) {
        setInputsMap((p) => ({ ...p, [symbol]: inputsFromResult(result, v) }));
        setDetailOpen((p) => new Set(p).add(symbol));
      }
    } catch (e: any) {
      setErrorMap((p) => ({
        ...p,
        [symbol]: e?.response?.data?.detail || "Failed. Check your API key in profile settings.",
      }));
    } finally {
      setLoadingSet((p) => { const n = new Set(p); n.delete(symbol); return n; });
    }
  }

  const analyzedCount = Object.keys(inputsMap).length;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl overflow-hidden">
      {/* Panel header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1a1a1a] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-[#4f8ef7]" />
          <span className="text-white font-semibold text-sm">AI Buy Price Analysis</span>
          <span className="text-[#555] text-xs">
            {analyzedCount > 0
              ? `${analyzedCount}/${investableSymbols.length} analyzed`
              : `${investableSymbols.length} positions`}
          </span>
        </div>
        {open ? <ChevronUp size={16} className="text-[#555]" /> : <ChevronDown size={16} className="text-[#555]" />}
      </button>

      {open && (
        <div className="border-t border-[#2a2a2a] px-4 py-4 space-y-3">

          {/* Formula legend */}
          <div className="bg-[#0d0d0d] border border-[#222] rounded-xl px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Info size={11} className="text-[#4f8ef7] shrink-0" />
              <span className="text-[#4f8ef7] text-[10px] font-semibold uppercase tracking-wide">DCF Buy Price Formula</span>
            </div>
            <div className="text-white text-xs font-mono mb-2 leading-relaxed">
              Buy Price = (FWD EPS × (1 + EPS Growth)⁵ × Exit P/E)<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;÷ (1 + Target CAGR%)⁵
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
              <div><span className="text-[#555]">FWD EPS</span> <span className="text-[#8a8a8a]">— next-12m earnings per share</span></div>
              <div><span className="text-[#555]">EPS Growth</span> <span className="text-[#8a8a8a]">— annual EPS CAGR over 5 yrs</span></div>
              <div><span className="text-[#555]">Exit P/E</span> <span className="text-[#8a8a8a]">— P/E multiple at year 5</span></div>
              <div><span className="text-[#555]">Target CAGR%</span> <span className="text-[#8a8a8a]">— your required annual return</span></div>
            </div>
          </div>

          {/* Set-all shortcuts */}
          <div className="flex items-center gap-2">
            <span className="text-[#555] text-xs">Set all CAGR:</span>
            {["8", "10", "12", "15", "20"].map((v) => (
              <button
                key={v}
                onClick={() => setAllCagr(v)}
                className="text-[10px] text-[#8a8a8a] hover:text-white border border-[#2a2a2a] hover:border-[#444] rounded px-1.5 py-0.5 transition-colors"
              >
                {v}%
              </button>
            ))}
          </div>

          {/* Per-stock cards */}
          {investableSymbols.map((sym) => {
            const holding  = portfolio.holdings.find((h) => h.symbol === sym);
            const isLoading = loadingSet.has(sym);
            const inputs    = inputsMap[sym];
            const error     = errorMap[sym];
            const showDetail = detailOpen.has(sym);

            // Live DCF calculations
            const cagr     = parseFloat(syncedCagr(sym)) || 15;
            const fwdEps   = parseFloat(inputs?.fwdEps || "0");
            const bearPrice = inputs ? dcf(fwdEps, parseFloat(inputs.bear.epsGrowth), parseFloat(inputs.bear.exitPe), cagr) : 0;
            const basePrice = inputs ? dcf(fwdEps, parseFloat(inputs.base.epsGrowth), parseFloat(inputs.base.exitPe), cagr) : 0;
            const bullPrice = inputs ? dcf(fwdEps, parseFloat(inputs.bull.epsGrowth), parseFloat(inputs.bull.exitPe), cagr) : 0;
            const current   = inputs?.currentPrice ?? 0;
            const signal    = basePrice > 0 ? signalFor(current, basePrice) : null;
            const sig       = signal ? SIGNAL_CONFIG[signal] : null;
            const SigIcon   = sig?.icon;

            return (
              <div key={sym} className="border border-[#2a2a2a] rounded-xl overflow-hidden">

                {/* Row: symbol + CAGR + fetch button */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <span
                      className={`text-white text-sm font-semibold ${onViewStock ? "cursor-pointer hover:text-[#4f8ef7] transition-colors" : ""}`}
                      onClick={() => onViewStock?.(sym)}
                    >{sym}</span>
                    {holding && <span className="text-[#555] text-[11px] ml-2 truncate">{holding.name}</span>}
                  </div>
                  <div className="relative shrink-0">
                    <input
                      type="number"
                      value={syncedCagr(sym)}
                      onChange={(e) => setCagrMap((p) => ({ ...p, [sym]: e.target.value }))}
                      min="1" max="100"
                      className="w-[64px] bg-[#1a1a1a] border border-[#333] rounded-lg px-2 pr-6 py-1.5 text-white text-xs outline-none focus:border-[#555] text-right tabular-nums"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#555] text-[10px]">%</span>
                  </div>
                  <button
                    onClick={() => fetchDefaults(sym)}
                    disabled={isLoading}
                    className="shrink-0 flex items-center gap-1.5 bg-white text-black font-semibold text-xs px-2.5 py-1.5 rounded-lg hover:bg-[#ddd] disabled:opacity-50 transition-colors"
                  >
                    {isLoading ? <Loader2 size={11} className="animate-spin" />
                      : inputs ? <RefreshCw size={11} /> : <Sparkles size={11} />}
                    {isLoading ? "…" : inputs ? "Re-fetch" : "Fetch Defaults"}
                  </button>
                </div>

                {/* Loading */}
                {isLoading && (
                  <div className="border-t border-[#2a2a2a] px-3 py-3 flex items-center gap-2">
                    <Loader2 size={13} className="animate-spin text-[#4f8ef7] shrink-0" />
                    <span className="text-[#8a8a8a] text-xs">Fetching fundamentals & AI estimates…</span>
                  </div>
                )}

                {/* Error */}
                {error && !isLoading && (
                  <div className="border-t border-[#2a2a2a] px-3 py-2.5 flex items-center gap-2 text-[#ff5000] text-xs">
                    <AlertTriangle size={12} className="shrink-0" />
                    {error}
                  </div>
                )}

                {/* Editable formula + live prices */}
                {inputs && !isLoading && (
                  <div className="border-t border-[#2a2a2a] px-3 py-3 space-y-3">

                    {/* FWD EPS — shared across scenarios */}
                    <div className="flex items-center justify-between">
                      <div>
                        <NumInput
                          label="Forward EPS (shared)"
                          value={inputs.fwdEps}
                          onChange={(v) => patchInputs(sym, { fwdEps: v })}
                          suffix="$"
                          width="w-24"
                        />
                        <div className="text-[#555] text-[10px] mt-1">
                        {inputs.epsSource === "yfinance" && "From Yahoo Finance · edit if needed"}
                        {inputs.epsSource === "back-calculated" && "⚠ yfinance had no EPS · back-calculated from AI price"}
                        {inputs.epsSource === "missing" && "⚠ Not available · enter manually"}
                      </div>
                      </div>
                      {current > 0 && (
                        <div className="text-right">
                          <div className="text-[#555] text-[10px]">Current price</div>
                          <div className="text-white text-sm font-semibold">{fmt(current)}</div>
                        </div>
                      )}
                    </div>

                    {/* Three scenario columns */}
                    <div className="grid grid-cols-3 gap-2">
                      {(["bear", "base", "bull"] as const).map((sc) => {
                        const price = sc === "bear" ? bearPrice : sc === "base" ? basePrice : bullPrice;
                        const labelColor = sc === "bear" ? "text-[#ff5000]" : sc === "base" ? "text-[#f7c44f]" : "text-[#00c805]";
                        const priceColor = price > 0 && current <= price
                          ? (sc === "bull" ? "text-[#4f8ef7]" : "text-[#00c805]")
                          : sc === "base" ? "text-white" : "text-[#8a8a8a]";

                        return (
                          <div key={sc} className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl p-2.5 space-y-2">
                            <div className={`text-[10px] font-semibold uppercase tracking-wide ${labelColor}`}>
                              {sc === "bear" ? "Bear" : sc === "base" ? "Base" : "Bull"}
                            </div>

                            <NumInput
                              label="EPS Growth"
                              value={inputs[sc].epsGrowth}
                              onChange={(v) => patchScenario(sym, sc, { epsGrowth: v })}
                              suffix="%"
                            />
                            <NumInput
                              label="Exit P/E"
                              value={inputs[sc].exitPe}
                              onChange={(v) => patchScenario(sym, sc, { exitPe: v })}
                              suffix="x"
                            />

                            <div className="pt-1 border-t border-[#1e1e1e]">
                              <div className="text-[#555] text-[10px] mb-0.5">Buy Price</div>
                              <div className={`text-sm font-bold tabular-nums ${priceColor}`}>
                                {price > 0 ? fmt(price) : "—"}
                              </div>
                              {price > 0 && current > 0 && (
                                <DistanceChip current={current} buyPrice={price} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Signal row */}
                    {sig && SigIcon && basePrice > 0 && (
                      <div className="flex items-center justify-between pt-1">
                        <div className="text-[#555] text-xs">
                          Base case: {fmt(basePrice)} · current is{" "}
                          <DistanceChip current={current} buyPrice={basePrice} />
                          {" "}from buy price
                        </div>
                        <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border ${sig.bg} ${sig.border} ${sig.text}`}>
                          <SigIcon size={10} />
                          {sig.label}
                        </span>
                      </div>
                    )}

                    {/* AI rationale toggle */}
                    <button
                      onClick={() => setDetailOpen((p) => {
                        const n = new Set(p);
                        n.has(sym) ? n.delete(sym) : n.add(sym);
                        return n;
                      })}
                      className="w-full flex items-center justify-between text-[#555] hover:text-[#8a8a8a] text-xs transition-colors pt-1"
                    >
                      <span>AI Rationale & Outlook</span>
                      {showDetail ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>

                    {showDetail && (
                      <div className="space-y-2 pt-1">

                        {/* EPS & P/E history charts */}
                        {(inputs.epsHistory.length > 0 || inputs.peHistory.length > 0) && (
                          <div className="bg-[#0d0d0d] border border-[#1e1e1e] rounded-xl px-3 py-3">
                            <div className="text-[#4f8ef7] text-[10px] font-semibold uppercase tracking-wide mb-3">
                              5-Year EPS &amp; P/E History
                            </div>
                            <div className="flex gap-4">
                              {inputs.epsHistory.length > 0 && (
                                <HistoryBars
                                  data={inputs.epsHistory}
                                  label="EPS (diluted)"
                                  formatter={(v) => `$${v.toFixed(2)}`}
                                  baseColor="#4f8ef7"
                                  avgLabel="EPS CAGR"
                                  avgValueLabel="Avg EPS"
                                  overrideAvgValue={inputs.priceCagr5y}
                                  overrideAvgValueLabel="5Y Price CAGR"
                                />
                              )}
                              {inputs.peHistory.length > 0 && (
                                <HistoryBars
                                  data={inputs.peHistory}
                                  label="P/E ratio"
                                  formatter={(v) => `${v.toFixed(1)}x`}
                                  baseColor="#a78bfa"
                                  avgLabel="Avg YoY Change"
                                  avgValueLabel="Avg P/E"
                                />
                              )}
                            </div>
                            <div className="mt-2 text-[#555] text-[9px]">
                              Bar color: <span className="text-[#00c805]">green</span> = YoY growth · <span className="text-[#ff5000]">red</span> = YoY decline · EPS CAGR = first→last positive year · P/E uses year-end price ÷ annual EPS
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-2">
                          {(["bear", "base", "bull"] as const).map((sc) => {
                            const colors = { bear: "text-[#ff5000]", base: "text-[#f7c44f]", bull: "text-[#00c805]" };
                            return (
                              <div key={sc} className="bg-[#111] rounded-lg px-2.5 py-2">
                                <div className={`text-[10px] font-semibold uppercase mb-1 ${colors[sc]}`}>{sc}</div>
                                <div className="text-[#8a8a8a] text-[11px] leading-relaxed">{inputs.rationale[sc]}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="bg-[#111] rounded-xl px-3 py-2.5">
                          <div className="text-[#4f8ef7] text-[10px] font-semibold uppercase tracking-wide mb-1">Management Outlook</div>
                          <div className="text-[#ccc] text-[11px] leading-relaxed">{inputs.managementOutlook}</div>
                        </div>
                        <div className="bg-[#1a0a0a] border border-[#330000] rounded-xl px-3 py-2.5">
                          <div className="text-[#ff5000] text-[10px] font-semibold uppercase tracking-wide mb-1">Key Risk</div>
                          <div className="text-[#8a8a8a] text-[11px] leading-relaxed">{inputs.keyRisks}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
