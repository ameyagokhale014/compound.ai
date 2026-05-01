import { useMemo, useState, useEffect, useRef } from "react";
import type { Portfolio, RealEstateProperty } from "../types";
import type { ExtendedPrice } from "../hooks/useWebSocket";
import { useBuyTargets } from "../hooks/useBuyTargets";
import { useHoldingTags, STRATEGY_TAGS, TAG_META } from "../hooks/useHoldingTags";
import type { StrategyTag } from "../hooks/useHoldingTags";
import PopiStocks from "../components/PopiStocks";
import TotalChart from "../components/TotalChart";
import BuyAnalysis from "../components/BuyAnalysis";
import AllocationChart from "../components/AllocationChart";
import StrategyPieChart from "../components/StrategyPieChart";
import { ArrowUpDown, ChevronDown, X } from "lucide-react";

interface Props {
  portfolios: Portfolio[];
  properties: RealEstateProperty[];
  onViewStock?: (symbol: string) => void;
  extendedPrices?: Record<string, ExtendedPrice>;
  session?: string;
}

interface AggHolding {
  symbol: string;
  name: string;
  asset_type: string;
  total_quantity: number;
  avg_cost: number;
  current_price: number;
  current_value: number;
  total_cost: number;
  gain_loss: number;
  gain_loss_pct: number;
  day_change_value: number;
  day_change_pct: number;
  portfolio_names: string[];
}

type SortKey = "value" | "gain_loss_pct" | "day_change" | "allocation" | "signal";
type SortDir = "desc" | "asc";
const ASSET_TYPE_FILTERS = [
  { id: "stock",       label: "Stocks" },
  { id: "etf",         label: "ETFs" },
  { id: "mutual_fund", label: "Mutual Funds" },
  { id: "crypto",      label: "Crypto" },
  { id: "cash",        label: "Cash" },
];

const SIGNAL_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  strong_buy:   { bg: "bg-[#0a2a0a]", text: "text-[#00c805]", label: "Strong Buy" },
  buy:          { bg: "bg-[#0d1f0d]", text: "text-[#4dbb50]", label: "Buy" },
  near_target:  { bg: "bg-[#261f00]", text: "text-[#f7c44f]", label: "Near" },
  above_target: { bg: "bg-[#2a0a0a]", text: "text-[#ff5000]", label: "Above" },
};

const TYPE_BADGE: Record<string, string> = {
  stock:       "bg-[#1a2a1a] text-[#00c805]",
  etf:         "bg-[#1a1a2a] text-[#4488ff]",
  mutual_fund: "bg-[#2a1a2a] text-[#cc44ff]",
  crypto:      "bg-[#2a1a2a] text-[#ff8800]",
  cash:        "bg-[#2a2a1a] text-[#ffcc00]",
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}
function fmtCompact(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtQty(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export default function MasterPortfolio({ portfolios, properties, onViewStock, extendedPrices = {}, session = "closed" }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [openTagMenu, setOpenTagMenu] = useState<string | null>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  const { tags, setTag } = useHoldingTags();
  const [filterStrategies, setFilterStrategies] = useState<Set<StrategyTag>>(new Set());
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());

  // Close tag menu when clicking outside
  useEffect(() => {
    if (!openTagMenu) return;
    const handler = (e: MouseEvent) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setOpenTagMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openTagMenu]);


  const { aggHoldings, totalCash, totalInvested, totalCost, totalGainLoss, totalGainLossPct, totalDayChange, totalDayChangePct, virtualPortfolio } = useMemo(() => {
    const map = new Map<string, AggHolding>();
    let totalCash = 0;
    const useExt = session === "pre_market" || session === "post_market";

    for (const p of portfolios) {
      totalCash += p.cash_balance;
      for (const h of p.holdings) {
        const ex = map.get(h.symbol);
        if (ex) {
          ex.total_quantity += h.total_quantity;
          ex.total_cost += h.total_cost;
          ex.current_value += h.current_value;
          ex.gain_loss += h.gain_loss;
          ex.day_change_value += h.day_change_value;
          if (!ex.portfolio_names.includes(p.name)) ex.portfolio_names.push(p.name);
        } else {
          map.set(h.symbol, {
            symbol: h.symbol,
            name: h.name,
            asset_type: h.asset_type,
            total_quantity: h.total_quantity,
            avg_cost: h.avg_cost,
            current_price: h.current_price,
            current_value: h.current_value,
            total_cost: h.total_cost,
            gain_loss: h.gain_loss,
            gain_loss_pct: h.gain_loss_pct,
            day_change_value: h.day_change_value,
            day_change_pct: h.day_change_pct,
            portfolio_names: [p.name],
          });
        }
      }
    }

    const holdings = Array.from(map.values()).map((h) => {
      const ext = useExt ? extendedPrices[h.symbol] : undefined;
      const extPrice = ext ? ext.price : null;
      const currentPrice = extPrice ?? (h.total_quantity > 0 ? h.current_value / h.total_quantity : 0);
      const currentValue = extPrice != null ? extPrice * h.total_quantity : h.current_value;
      const gainLoss = currentValue - h.total_cost;
      return {
        ...h,
        avg_cost: h.total_quantity > 0 ? h.total_cost / h.total_quantity : 0,
        current_price: currentPrice,
        current_value: currentValue,
        gain_loss: gainLoss,
        gain_loss_pct: h.total_cost > 0 ? (gainLoss / h.total_cost) * 100 : 0,
        day_change_pct: (h.current_value - h.day_change_value) > 0
          ? (h.day_change_value / (h.current_value - h.day_change_value)) * 100 : 0,
      };
    });

    const totalInvested = holdings.reduce((s, h) => s + h.current_value, 0);
    const totalCost2 = holdings.reduce((s, h) => s + h.total_cost, 0);
    const totalGainLoss = totalInvested - totalCost2;
    const totalGainLossPct = totalCost2 > 0 ? (totalGainLoss / totalCost2) * 100 : 0;
    const totalDayChange = holdings.reduce((s, h) => s + h.day_change_value, 0);
    const prevTotal = totalInvested - totalDayChange;
    const totalDayChangePct = prevTotal > 0 ? (totalDayChange / prevTotal) * 100 : 0;

    // Virtual combined portfolio for BuyAnalysis (uses first portfolio's id as routing key;
    // per-symbol cagr_map requests don't depend on which portfolio_id is used)
    const basePortfolio = portfolios[0] ?? null;
    const virtualPortfolio: Portfolio | null = basePortfolio ? {
      ...basePortfolio,
      holdings: holdings.map((h, i) => ({
        id: i,
        symbol: h.symbol,
        name: h.name,
        asset_type: h.asset_type as any,
        transactions: [],
        total_quantity: h.total_quantity,
        avg_cost: h.avg_cost,
        current_price: h.current_price,
        current_value: h.current_value,
        total_cost: h.total_cost,
        gain_loss: h.gain_loss,
        gain_loss_pct: h.gain_loss_pct,
        day_change: 0,
        day_change_pct: h.day_change_pct,
        day_change_value: h.day_change_value,
      })),
    } : null;

    return { aggHoldings: holdings, totalCash, totalInvested, totalCost: totalCost2, totalGainLoss, totalGainLossPct, totalDayChange, totalDayChangePct, virtualPortfolio };
  }, [portfolios]);

  const allSymbols = useMemo(
    () => aggHoldings.filter((h) => h.asset_type !== "cash").map((h) => h.symbol),
    [aggHoldings]
  );
  const buyTargets = useBuyTargets(allSymbols);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const SIGNAL_ORDER: Record<string, number> = {
    strong_buy: 0, buy: 1, near_target: 2, above_target: 3,
  };

  const sorted = useMemo(() => {
    const totalInv = aggHoldings.reduce((s, h) => s + h.current_value, 0);
    return [...aggHoldings].sort((a, b) => {
      if (sortKey === "signal") {
        const sa = SIGNAL_ORDER[buyTargets.get(a.symbol)?.signal ?? ""] ?? 99;
        const sb = SIGNAL_ORDER[buyTargets.get(b.symbol)?.signal ?? ""] ?? 99;
        return sortDir === "asc" ? sb - sa : sa - sb;
      }
      let av: number, bv: number;
      if (sortKey === "value") { av = a.current_value; bv = b.current_value; }
      else if (sortKey === "gain_loss_pct") { av = a.gain_loss_pct; bv = b.gain_loss_pct; }
      else if (sortKey === "day_change") { av = a.day_change_pct; bv = b.day_change_pct; }
      else { av = totalInv > 0 ? a.current_value / totalInv : 0; bv = totalInv > 0 ? b.current_value / totalInv : 0; }
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [aggHoldings, sortKey, sortDir, buyTargets]);

  const isUp = totalGainLoss >= 0;
  const todayUp = totalDayChange >= 0;

  const filtered = useMemo(() => {
    return sorted.filter((h) => {
      if (filterStrategies.size > 0) {
        const tag = tags[h.symbol] ?? "none";
        if (!filterStrategies.has(tag as StrategyTag)) return false;
      }
      if (filterTypes.size > 0 && !filterTypes.has(h.asset_type)) return false;
      return true;
    });
  }, [sorted, filterStrategies, filterTypes, tags]);

  const hasFilters = filterStrategies.size > 0 || filterTypes.size > 0;

  function toggleSet<T>(set: Set<T>, val: T): Set<T> {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    return next;
  }

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => toggleSort(k)}
      className={`flex items-center gap-1 text-xs transition-colors ${sortKey === k ? "text-white" : "text-[#555] hover:text-[#8a8a8a]"}`}>
      {label}<ArrowUpDown size={10} />
    </button>
  );

  // suppress unused variable warning
  void totalCost;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-[1800px] mx-auto px-4 py-8">

        {/* Summary Banner */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 mb-6">
          <div className="text-[#8a8a8a] text-xs uppercase tracking-widest mb-1">Master Portfolio</div>
          <div className="text-4xl font-semibold text-white mb-4">{fmtCompact(totalInvested + totalCash)}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
            <div>
              <div className="text-[#8a8a8a] text-xs mb-0.5">Invested</div>
              <div className="text-white font-semibold">{fmtCompact(totalInvested)}</div>
            </div>
            <div>
              <div className="text-[#8a8a8a] text-xs mb-0.5">Cash (all accounts)</div>
              <div className="text-[#f7c44f] font-semibold">{fmtCompact(totalCash)}</div>
            </div>
            <div>
              <div className="text-[#8a8a8a] text-xs mb-0.5">Today</div>
              <div className={`font-semibold ${todayUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                {todayUp ? "+" : ""}{fmt(totalDayChange)} ({todayUp ? "+" : ""}{totalDayChangePct.toFixed(2)}%)
              </div>
            </div>
            <div>
              <div className="text-[#8a8a8a] text-xs mb-0.5">Total Return</div>
              <div className={`font-semibold ${isUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                {isUp ? "+" : ""}{fmt(totalGainLoss)} ({isUp ? "+" : ""}{totalGainLossPct.toFixed(2)}%)
              </div>
            </div>
          </div>

          {/* Portfolio allocation breakdown */}
          {portfolios.length > 0 && (() => {
            const grandTotal = totalInvested + totalCash;
            const PORTFOLIO_COLORS = [
              "#4f8ef7","#00c805","#f7c44f","#a78bfa","#ff8800",
              "#4dbb50","#00b4d8","#ff5000","#e76f51","#2ec4b6",
            ];
            return (
              <div>
                <div className="text-[#555] text-xs mb-2">Allocation by portfolio</div>
                {/* Stacked bar */}
                <div className="flex rounded-full overflow-hidden h-2 mb-3 bg-[#222]">
                  {portfolios.map((p, i) => {
                    const pct = grandTotal > 0 ? (p.total_value / grandTotal) * 100 : 0;
                    return pct > 0 ? (
                      <div key={p.id} className="h-2 transition-all"
                        style={{ width: `${pct}%`, background: PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length] }} />
                    ) : null;
                  })}
                </div>
                {/* Legend */}
                <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                  {portfolios.map((p, i) => {
                    const pct = grandTotal > 0 ? (p.total_value / grandTotal) * 100 : 0;
                    return (
                      <div key={p.id} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length] }} />
                        <span className="text-[#8a8a8a] text-xs">{p.name}</span>
                        <span className="text-white text-xs font-medium">{pct.toFixed(1)}%</span>
                        <span className="text-[#555] text-xs">{fmtCompact(p.total_value)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Asset class breakdown */}
          {aggHoldings.length > 0 && (() => {
            const grandTotal = totalInvested + totalCash;
            let stockVal = 0, etfVal = 0, cryptoVal = 0;
            for (const h of aggHoldings) {
              if (h.asset_type === "crypto") cryptoVal += h.current_value;
              else if (h.asset_type === "etf" || h.asset_type === "mutual_fund") etfVal += h.current_value;
              else stockVal += h.current_value;
            }
            const cashVal = totalCash;
            const classes = [
              { label: "Stocks", value: stockVal, color: "#00c805" },
              { label: "ETFs / Funds", value: etfVal, color: "#4488ff" },
              { label: "Crypto", value: cryptoVal, color: "#ff8800" },
              { label: "Cash", value: cashVal, color: "#f7c44f" },
            ].filter((c) => c.value > 0);
            return (
              <div className="mt-5 pt-5 border-t border-[#1f1f1f]">
                <div className="text-[#555] text-xs mb-2">Asset class breakdown</div>
                <div className="flex rounded-full overflow-hidden h-2 mb-3 bg-[#222]">
                  {classes.map((c) => {
                    const pct = grandTotal > 0 ? (c.value / grandTotal) * 100 : 0;
                    return pct > 0.1 ? (
                      <div key={c.label} className="h-2 transition-all"
                        style={{ width: `${pct}%`, background: c.color }} />
                    ) : null;
                  })}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                  {classes.map((c) => {
                    const pct = grandTotal > 0 ? (c.value / grandTotal) * 100 : 0;
                    return (
                      <div key={c.label} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
                        <span className="text-[#8a8a8a] text-xs">{c.label}</span>
                        <span className="text-white text-xs font-medium">{pct.toFixed(1)}%</span>
                        <span className="text-[#555] text-xs">{fmtCompact(c.value)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        <TotalChart
          portfolios={portfolios}
          totalValue={totalInvested + totalCash}
          totalTodayValue={totalDayChange}
          totalGainLoss={totalGainLoss}
          totalGainLossPct={totalGainLossPct}
        />

        <AllocationChart portfolios={portfolios} onViewStock={onViewStock} />

        <div className="flex gap-5 items-start">
          {/* Left — Popi */}
          <div className="w-[440px] shrink-0 sticky top-6">
            <PopiStocks />
          </div>

          {/* Centre — Holdings */}
          <div className="flex-1 min-w-0 space-y-5">
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl">
              <div className="px-5 py-4 border-b border-[#2a2a2a] rounded-t-2xl space-y-3">
                {/* Title + sort */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-white font-semibold">All Holdings</h2>
                    <div className="text-[#555] text-xs mt-0.5">
                      {filtered.length !== aggHoldings.length
                        ? <>{filtered.length} of {aggHoldings.length} positions</>
                        : <>{aggHoldings.length} positions across {portfolios.length} portfolios</>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[#555]">
                    Sort:
                    <SortBtn k="value" label="Value" />
                    <SortBtn k="gain_loss_pct" label="Return" />
                    <SortBtn k="day_change" label="Today" />
                    <SortBtn k="allocation" label="Alloc" />
                    <SortBtn k="signal" label="Signal" />
                  </div>
                </div>

                {/* Filter bar */}
                <div className="flex flex-wrap gap-y-2 gap-x-4 items-center">
                  {/* Strategy */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[#444] text-[10px] uppercase tracking-wider">Strategy</span>
                    {STRATEGY_TAGS.filter(t => t.id !== "none").map(t => (
                      <button key={t.id}
                        onClick={() => setFilterStrategies(s => toggleSet(s, t.id))}
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
                        style={filterStrategies.has(t.id)
                          ? { background: t.bg, color: t.color, border: `1px solid ${t.color}88` }
                          : { background: "transparent", color: "#555", border: "1px solid #2a2a2a" }
                        }
                      >{t.short}</button>
                    ))}
                  </div>

                  <div className="w-px h-4 bg-[#2a2a2a]" />

                  {/* Asset type */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[#444] text-[10px] uppercase tracking-wider">Type</span>
                    {ASSET_TYPE_FILTERS.map(t => (
                      <button key={t.id}
                        onClick={() => setFilterTypes(s => toggleSet(s, t.id))}
                        className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border"
                        style={filterTypes.has(t.id)
                          ? { background: "#1a2a1a", color: "#00c805", borderColor: "#00c80566" }
                          : { background: "transparent", color: "#555", borderColor: "#2a2a2a" }
                        }
                      >{t.label}</button>
                    ))}
                  </div>

                  {/* Clear */}
                  {hasFilters && (
                    <button
                      onClick={() => { setFilterStrategies(new Set()); setFilterTypes(new Set()); }}
                      className="flex items-center gap-1 text-[10px] text-[#555] hover:text-[#ff5000] transition-colors ml-auto"
                    >
                      <X size={10} /> Clear
                    </button>
                  )}
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="py-16 text-center text-[#555] text-sm">
                  {hasFilters ? "No holdings match these filters." : "No holdings yet — add positions in your portfolios."}
                </div>
              ) : (
                <div className="divide-y divide-[#1a1a1a]">
                  {filtered.map((h) => {
                    const alloc = totalInvested > 0 ? (h.current_value / totalInvested) * 100 : 0;
                    const up = h.gain_loss >= 0;
                    const dayUp = h.day_change_value >= 0;
                    const bt = buyTargets.get(h.symbol);
                    const signalStyle = bt?.signal ? SIGNAL_STYLE[bt.signal] : null;
                    const ext = (session === "pre_market" || session === "post_market") ? extendedPrices[h.symbol] : undefined;
                    const extUp = ext ? ext.change >= 0 : false;
                    return (
                      <div key={h.symbol} className="px-5 py-3 hover:bg-[#1a1a1a] transition-colors">
                        {/* Row layout: flex so it wraps gracefully */}
                        <div className="flex items-center gap-4 min-w-0">

                          {/* Symbol + name + current price + type badge */}
                          <div className="w-44 shrink-0 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`text-white font-semibold text-sm ${onViewStock ? "cursor-pointer hover:text-[#4f8ef7] transition-colors" : ""}`}
                                onClick={() => onViewStock && onViewStock(h.symbol)}
                              >{h.symbol}</span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 ${TYPE_BADGE[h.asset_type] ?? "bg-[#222] text-[#8a8a8a]"}`}>
                                {h.asset_type}
                              </span>
                            </div>
                            <div className="text-[#555] text-xs truncate">{h.name}</div>
                            {/* Current price — uses ext price when in extended hours */}
                            {h.current_price > 0 && (
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="text-white text-sm font-semibold tabular-nums">
                                  {fmt(h.current_price)}
                                </span>
                                {ext && (
                                  <span className={`text-[10px] font-medium ${extUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                                    {extUp ? "+" : ""}{ext.change_pct.toFixed(2)}%
                                  </span>
                                )}
                              </div>
                            )}
                            {h.portfolio_names.length > 1 && (
                              <div className="text-[#333] text-[10px] truncate">{h.portfolio_names.join(", ")}</div>
                            )}
                          </div>

                          {/* Alloc % — always visible, prominent (fixed 64px) */}
                          <div className="w-16 shrink-0 text-right">
                            <div className="text-[#8a8a8a] text-[10px]">Alloc</div>
                            <div className="text-white font-semibold text-sm">{alloc.toFixed(1)}%</div>
                            <div className="w-full bg-[#2a2a2a] rounded-full h-1 mt-1">
                              <div className="bg-[#4f8ef7] h-1 rounded-full"
                                style={{ width: `${Math.min(alloc, 100)}%` }} />
                            </div>
                          </div>

                          {/* Value (fixed 110px) */}
                          <div className="w-28 shrink-0">
                            <div className="text-[#8a8a8a] text-[10px]">Value</div>
                            <div className="text-white font-semibold text-sm">{fmt(h.current_value)}</div>
                            <div className={`text-xs ${dayUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                              {dayUp ? "+" : ""}{h.day_change_pct.toFixed(2)}% today
                            </div>
                          </div>

                          {/* Total Return (fixed 120px) */}
                          <div className="w-28 shrink-0">
                            <div className="text-[#8a8a8a] text-[10px]">Total Return</div>
                            <div className={`font-semibold text-sm ${up ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                              {up ? "+" : ""}{h.gain_loss_pct.toFixed(2)}%
                            </div>
                            <div className={`text-xs ${up ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                              {up ? "+" : ""}{fmt(h.gain_loss)}
                            </div>
                          </div>

                          {/* Avg cost / qty (fixed 100px) */}
                          <div className="w-24 shrink-0 hidden lg:block">
                            <div className="text-[#8a8a8a] text-[10px]">Avg Cost</div>
                            <div className="text-white text-sm">{fmt(h.avg_cost)}</div>
                            <div className="text-[#555] text-xs">{fmtQty(h.total_quantity)} shares</div>
                          </div>

                          {/* Buy Target + signal */}
                          <div className="w-28 shrink-0">
                            {bt?.base_buy_price && signalStyle ? (
                              <>
                                <div className="text-[#8a8a8a] text-[10px]">Buy Target</div>
                                <div className="text-white text-sm">{fmt(bt.base_buy_price)}</div>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${signalStyle.bg} ${signalStyle.text}`}>
                                    {signalStyle.label}
                                  </span>
                                  {bt.current_price && (
                                    <span className={`text-[10px] ${bt.current_price < bt.base_buy_price ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                                      {bt.current_price < bt.base_buy_price ? "" : "+"}{(((bt.current_price - bt.base_buy_price) / bt.base_buy_price) * 100).toFixed(1)}%
                                    </span>
                                  )}
                                </div>
                              </>
                            ) : (
                              <div className="text-[#444] text-xs">—</div>
                            )}
                          </div>

                          {/* Strategy tag */}
                          <div className="flex-1 min-w-0 relative" ref={openTagMenu === h.symbol ? tagMenuRef : undefined}>
                            <div className="text-[#8a8a8a] text-[10px] mb-0.5">Strategy</div>
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenTagMenu(openTagMenu === h.symbol ? null : h.symbol); }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors hover:opacity-80"
                              style={{
                                background: TAG_META[tags[h.symbol] ?? "none"].bg,
                                color: TAG_META[tags[h.symbol] ?? "none"].color,
                                border: `1px solid ${TAG_META[tags[h.symbol] ?? "none"].color}44`,
                              }}
                            >
                              <span className="whitespace-nowrap">{TAG_META[tags[h.symbol] ?? "none"].short}</span>
                              <ChevronDown size={10} className="shrink-0" />
                            </button>
                            {openTagMenu === h.symbol && (
                              <div className="absolute top-full left-0 mt-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl shadow-2xl w-52 py-1" style={{ zIndex: 9999 }}>
                                {STRATEGY_TAGS.map((t) => (
                                  <button
                                    key={t.id}
                                    onClick={(e) => { e.stopPropagation(); setTag(h.symbol, t.id); setOpenTagMenu(null); }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-[#252525] transition-colors text-left"
                                  >
                                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
                                    <span className="text-xs text-white whitespace-nowrap">{t.label}</span>
                                    {(tags[h.symbol] ?? "none") === t.id && (
                                      <span className="ml-auto text-[10px]" style={{ color: t.color }}>✓</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right — Strategy Breakdown + AI Price Target Analysis */}
          {virtualPortfolio && (
            <div className="w-[420px] shrink-0 sticky top-6">
              <StrategyPieChart holdings={aggHoldings} tags={tags} />
              <div className="mt-4">
                <BuyAnalysis portfolio={virtualPortfolio} onViewStock={onViewStock} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
