import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, TrendingUp, TrendingDown, Zap } from "lucide-react";
import { getPortfolios, createPortfolio, deletePortfolio, getRealEstate, getStockSectors, getRecentEarningsSummaries } from "../api";
import type { Portfolio, RealEstateProperty, RecentEarningsSummary } from "../api";
import type { Portfolio as PortfolioType, RealEstateProperty as REType } from "../types";
import type { ExtendedPrice } from "../hooks/useWebSocket";
import { useBuyTargets } from "../hooks/useBuyTargets";
import AllocationChart from "../components/AllocationChart";
import RealEstatePanel from "../components/RealEstatePanel";
import TotalChart from "../components/TotalChart";
import Popi from "../components/Popi";
import SectorPieChart from "../components/SectorPieChart";
import AchievementsCard from "../components/AchievementsCard";
import { computeWealthScore } from "../utils/wealthScore";

interface Props {
  onSelect: (p: PortfolioType) => void;
  prices: Record<string, number>;
  extendedPrices?: Record<string, ExtendedPrice>;
  session?: string;
  onViewStock?: (symbol: string) => void;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtFull(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function Home({ onSelect, prices, extendedPrices = {}, session = "closed", onViewStock }: Props) {
  const [portfolios, setPortfolios] = useState<PortfolioType[]>([]);
  const [properties, setProperties] = useState<REType[]>([]);
  const [earningsPulse, setEarningsPulse] = useState<RecentEarningsSummary[]>([]);
  type WizardState = {
    step: "type" | "name" | "employer";
    accountType: string;
    name: string;
    company: string;
    employerStatus: string;
  };
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getPortfolios(), getRealEstate()]).then(([ps, re]) => {
      setPortfolios(ps as PortfolioType[]);
      setProperties(re as REType[]);
      setLoading(false);
    });
  }, [prices]);

  // Fetch cached earnings call summaries for the pulse strip (no API key needed)
  useEffect(() => {
    getRecentEarningsSummaries().then(setEarningsPulse).catch(() => {});
  }, []);

  function openWizard() {
    setWizard({ step: "type", accountType: "", name: "", company: "", employerStatus: "" });
  }

  function closeWizard() {
    setWizard(null);
  }

  async function handleCreate(w: WizardState) {
    if (!w.name.trim()) return;
    const p = await createPortfolio(
      w.name.trim(),
      w.accountType || "brokerage",
      w.company.trim() || undefined,
      w.employerStatus || undefined,
    );
    setPortfolios((prev) => [...prev, p]);
    setWizard(null);
  }

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this portfolio?")) return;
    await deletePortfolio(id);
    setPortfolios((prev) => prev.filter((p) => p.id !== id));
  }

  const totalPortfolio = portfolios.reduce((s, p) => s + p.total_value, 0);
  const totalGain = portfolios.reduce((s, p) => s + p.total_gain_loss, 0);
  const totalCost = portfolios.reduce((s, p) => s + p.total_cost, 0);
  const totalGainPct = totalCost ? (totalGain / totalCost) * 100 : 0;
  const isUp = totalGain >= 0;

  const totalTodayValue = portfolios.reduce(
    (s, p) => s + p.holdings.reduce((hs, h) => hs + h.day_change_value, 0), 0
  );
  const prevPortfolioTotal = totalPortfolio - totalTodayValue;
  const totalTodayPct = prevPortfolioTotal > 0 ? (totalTodayValue / prevPortfolioTotal) * 100 : 0;
  const todayUp = totalTodayValue >= 0;

  const totalCashBalance = portfolios.reduce((s, p) => s + p.cash_balance, 0);
  const totalInvested = totalPortfolio - totalCashBalance;

  const RETIREMENT_TYPES = new Set(["roth_ira", "traditional_ira", "401k"]);

  const retirementPortfolios    = portfolios.filter((p) => RETIREMENT_TYPES.has(p.account_type));
  const nonRetirementPortfolios = portfolios.filter((p) => !RETIREMENT_TYPES.has(p.account_type));

  const retirementValue    = retirementPortfolios.reduce((s, p) => s + p.total_value, 0);
  const nonRetirementValue = nonRetirementPortfolios.reduce((s, p) => s + p.total_value, 0);

  const retirementCash    = retirementPortfolios.reduce((s, p) => s + p.cash_balance, 0);
  const retirementStocks  = retirementValue - retirementCash;
  const nonRetirementCash   = nonRetirementPortfolios.reduce((s, p) => s + p.cash_balance, 0);
  const nonRetirementStocks = nonRetirementValue - nonRetirementCash;

  // Break non-retirement stocks into individual stocks vs ETFs+mutual funds
  const { nonRetirementIndivStocks, nonRetirementFunds } = useMemo(() => {
    let indiv = 0, funds = 0;
    for (const p of nonRetirementPortfolios) {
      for (const h of p.holdings) {
        if (h.asset_type === "stock" || h.asset_type === "crypto") indiv += h.current_value;
        else if (h.asset_type === "etf" || h.asset_type === "mutual_fund") funds += h.current_value;
      }
    }
    return { nonRetirementIndivStocks: indiv, nonRetirementFunds: funds };
  }, [nonRetirementPortfolios]);

  const [sectors, setSectors] = useState<Record<string, string>>({});

  const allStockSymbols = useMemo(() => {
    const seen = new Set<string>();
    for (const p of portfolios) {
      for (const h of p.holdings) {
        if (h.asset_type !== "cash") seen.add(h.symbol);
      }
    }
    return Array.from(seen);
  }, [portfolios]);

  useEffect(() => {
    if (!allStockSymbols.length) return;
    getStockSectors(allStockSymbols).then(setSectors);
  }, [allStockSymbols.join(",")]);

  const buyTargets = useBuyTargets(allStockSymbols);

  // Build sector breakdown: sum current_value by sector across all holdings
  const sectorData = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of portfolios) {
      for (const h of p.holdings) {
        if (h.asset_type === "cash") continue;
        const sector = sectors[h.symbol] || "Unknown";
        map.set(sector, (map.get(sector) ?? 0) + h.current_value);
      }
    }
    return Array.from(map.entries()).map(([sector, value]) => ({ sector, value }));
  }, [portfolios, sectors]);
  const buyAlerts = useMemo(() => {
    const alerts: Array<{ symbol: string; name: string; current_price: number; base_buy_price: number; signal: string; pct: number }> = [];
    for (const p of portfolios) {
      for (const h of p.holdings) {
        const bt = buyTargets.get(h.symbol);
        if (bt && bt.base_buy_price && bt.current_price && (bt.signal === "strong_buy" || bt.signal === "buy")) {
          if (!alerts.find((a) => a.symbol === h.symbol)) {
            alerts.push({
              symbol: h.symbol,
              name: h.name,
              current_price: bt.current_price,
              base_buy_price: bt.base_buy_price,
              signal: bt.signal,
              pct: ((bt.current_price - bt.base_buy_price) / bt.base_buy_price) * 100,
            });
          }
        }
      }
    }
    return alerts.sort((a, b) => a.pct - b.pct);
  }, [portfolios, buyTargets]);

  const totalRealEstateEquity = properties.reduce((s, p) => s + p.equity, 0);
  const netWealth = totalPortfolio + totalRealEstateEquity;

  // Wealth score snapshot for achievements tracking
  const wealthScoreValue = useMemo(
    () => (portfolios.length > 0 || properties.length > 0)
      ? computeWealthScore(portfolios, properties, buyTargets, sectors).total
      : undefined,
    [portfolios, properties, buyTargets, sectors],
  );
  const reEstatePct = netWealth > 0 ? (totalRealEstateEquity / netWealth) * 100 : 0;
  const investedPct = netWealth > 0 ? (totalInvested / netWealth) * 100 : 0;
  const cashPct = netWealth > 0 ? (totalCashBalance / netWealth) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-[1400px] mx-auto px-4 py-8">

        {/* ── Net Wealth Banner ── */}
        {(portfolios.length > 0 || properties.length > 0) && (
          <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 mb-6">
            <div className="text-[#8a8a8a] text-xs uppercase tracking-widest mb-1">Net Wealth</div>
            <div className="text-4xl font-semibold text-white mb-3">{fmt(netWealth)}</div>

            {/* Breakdown bar */}
            <div className="flex rounded-full overflow-hidden h-2 mb-3 bg-[#222]">
              {investedPct > 0 && (
                <div className="bg-[#4f8ef7] h-2 transition-all" style={{ width: `${investedPct}%` }} />
              )}
              {cashPct > 0 && (
                <div className="bg-[#f7c44f] h-2 transition-all" style={{ width: `${cashPct}%` }} />
              )}
              {reEstatePct > 0 && (
                <div className="bg-[#00c805] h-2 transition-all" style={{ width: `${reEstatePct}%` }} />
              )}
            </div>

            <div className="flex flex-wrap gap-6">
              {totalInvested > 0 && (
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#4f8ef7] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[#8a8a8a] text-xs">Stocks & Crypto</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-white font-semibold text-sm">{fmt(totalInvested)}</span>
                      <span className="text-[#4f8ef7] font-semibold text-sm">{investedPct.toFixed(1)}%</span>
                    </div>
                    <div className="flex gap-3 mt-0.5">
                      <span className={`text-xs ${todayUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                        Today {todayUp ? "+" : ""}{fmtFull(totalTodayValue)} ({todayUp ? "+" : ""}{totalTodayPct.toFixed(2)}%)
                      </span>
                      {totalCost > 0 && (
                        <span className={`text-xs ${isUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                          Total {isUp ? "+" : ""}{fmtFull(totalGain)} ({isUp ? "+" : ""}{totalGainPct.toFixed(2)}%)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {totalCashBalance > 0 && (
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#f7c44f] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[#8a8a8a] text-xs">Cash</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-white font-semibold text-sm">{fmt(totalCashBalance)}</span>
                      <span className="text-[#f7c44f] font-semibold text-sm">{cashPct.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              )}
              {totalRealEstateEquity > 0 && (
                <div className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#00c805] shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[#8a8a8a] text-xs">Real Estate</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-white font-semibold text-sm">{fmt(totalRealEstateEquity)}</span>
                      <span className="text-[#00c805] font-semibold text-sm">{reEstatePct.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Retirement vs Non-Retirement split */}
            {(retirementValue > 0 || nonRetirementValue > 0) && (
              <div className="mt-4 pt-4 border-t border-[#1a1a1a]">
                <div className="text-[#555] text-xs mb-2">Account type breakdown</div>
                <div className="flex rounded-full overflow-hidden h-1.5 mb-3 bg-[#222]">
                  {retirementValue > 0 && (
                    <div className="h-1.5 bg-[#a78bfa] transition-all"
                      style={{ width: `${totalPortfolio > 0 ? (retirementValue / totalPortfolio) * 100 : 0}%` }} />
                  )}
                  {nonRetirementValue > 0 && (
                    <div className="h-1.5 bg-[#4f8ef7] transition-all"
                      style={{ width: `${totalPortfolio > 0 ? (nonRetirementValue / totalPortfolio) * 100 : 0}%` }} />
                  )}
                </div>
                <div className="flex gap-8 flex-wrap">
                  {retirementValue > 0 && (
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#a78bfa] shrink-0 mt-1" />
                      <div>
                        <div className="text-[#8a8a8a] text-xs">Retirement <span className="text-[#555]">(IRA · 401k)</span></div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-white font-semibold text-sm">{fmt(retirementValue)}</span>
                          <span className="text-[#a78bfa] text-sm font-semibold">
                            {totalPortfolio > 0 ? ((retirementValue / totalPortfolio) * 100).toFixed(1) : "0"}%
                          </span>
                        </div>
                        <div className="flex gap-3 mt-1">
                          {retirementStocks > 0 && (
                            <span className="text-[#555] text-xs">
                              Stocks <span className="text-[#8a8a8a]">{retirementValue > 0 ? ((retirementStocks / retirementValue) * 100).toFixed(0) : 0}%</span>
                            </span>
                          )}
                          {retirementCash > 0 && (
                            <span className="text-[#555] text-xs">
                              Cash <span className="text-[#f7c44f]">{retirementValue > 0 ? ((retirementCash / retirementValue) * 100).toFixed(0) : 0}%</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {nonRetirementValue > 0 && (
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#4f8ef7] shrink-0 mt-1" />
                      <div>
                        <div className="text-[#8a8a8a] text-xs">Non-Retirement <span className="text-[#555]">(Brokerage · Cash)</span></div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-white font-semibold text-sm">{fmt(nonRetirementValue)}</span>
                          <span className="text-[#4f8ef7] text-sm font-semibold">
                            {totalPortfolio > 0 ? ((nonRetirementValue / totalPortfolio) * 100).toFixed(1) : "0"}%
                          </span>
                        </div>
                        <div className="flex gap-3 mt-1 flex-wrap">
                          {nonRetirementIndivStocks > 0 && (
                            <span className="text-[#555] text-xs">
                              Stocks <span className="text-[#8a8a8a]">{nonRetirementValue > 0 ? ((nonRetirementIndivStocks / nonRetirementValue) * 100).toFixed(0) : 0}%</span>
                            </span>
                          )}
                          {nonRetirementFunds > 0 && (
                            <span className="text-[#555] text-xs">
                              ETFs/Funds <span className="text-[#4488ff]">{nonRetirementValue > 0 ? ((nonRetirementFunds / nonRetirementValue) * 100).toFixed(0) : 0}%</span>
                            </span>
                          )}
                          {nonRetirementCash > 0 && (
                            <span className="text-[#555] text-xs">
                              Cash <span className="text-[#f7c44f]">{nonRetirementValue > 0 ? ((nonRetirementCash / nonRetirementValue) * 100).toFixed(0) : 0}%</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Buy Alerts */}
        {buyAlerts.length > 0 && (
          <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00c805] animate-pulse" />
              <span className="text-white font-semibold text-sm">Buy Alerts</span>
              <span className="text-[#555] text-xs">{buyAlerts.length} stock{buyAlerts.length > 1 ? "s" : ""} at or below 20% CAGR buy price</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {buyAlerts.map((a) => (
                <div key={a.symbol} className="flex items-center gap-2 bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl px-3 py-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-white font-semibold text-sm ${onViewStock ? "cursor-pointer hover:text-[#4f8ef7] transition-colors" : ""}`}
                        onClick={() => onViewStock?.(a.symbol)}
                      >{a.symbol}</span>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                        a.signal === "strong_buy"
                          ? "bg-[#0a2a0a] text-[#00c805]"
                          : "bg-[#0d1f0d] text-[#4dbb50]"
                      }`}>
                        {a.signal === "strong_buy" ? "Strong Buy" : "Buy"}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className="text-white text-xs">{fmtFull(a.current_price)}</span>
                      <span className="text-[#555] text-xs">target {fmtFull(a.base_buy_price)}</span>
                      <span className="text-[#00c805] text-xs font-medium">{a.pct.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && portfolios.length > 0 && (
          <TotalChart
            portfolios={portfolios}
            totalValue={totalPortfolio}
            totalTodayValue={totalTodayValue}
          />
        )}

        {/* ── Earnings Pulse ── most recent call summaries ── */}
        {earningsPulse.length > 0 && (
          <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4 mb-0">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={13} className="text-[#a78bfa]" />
              <span className="text-white font-semibold text-sm">Earnings Pulse</span>
              <span className="text-[#555] text-xs ml-1">Most recent reported results</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {earningsPulse.slice(0, 6).map(s => {
                const rxn = s.price_reaction_pct;
                const surp = s.eps_surprise_pct;
                const actionColors: Record<string, string> = {
                  buy:  "text-[#00c805] bg-[#0a2a0a]",
                  hold: "text-[#4f8ef7] bg-[#0d1520]",
                  trim: "text-[#f7c44f] bg-[#261f00]",
                  sell: "text-[#ff5000] bg-[#2a0a0a]",
                };
                const actionEmoji: Record<string, string> = {
                  buy: "🟢", hold: "🔵", trim: "🟡", sell: "🔴",
                };
                const ac = actionColors[s.action ?? "hold"] ?? actionColors.hold;
                const ae = actionEmoji[s.action ?? "hold"] ?? "🔵";
                return (
                  <div
                    key={s.symbol}
                    className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-3 hover:border-[#2a2a2a] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-white font-bold text-sm">{s.symbol}</span>
                          {s.quarter && (
                            <span className="text-[10px] text-[#444] bg-[#1a1a1a] px-1.5 py-0.5 rounded">
                              {s.quarter}
                            </span>
                          )}
                        </div>
                        <div className="text-[#555] text-[10px] truncate max-w-[140px]">{s.name}</div>
                      </div>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-lg shrink-0 ${ac}`}>
                        {ae} {(s.action ?? "hold").toUpperCase()}
                      </span>
                    </div>

                    {/* Metrics row */}
                    <div className="flex items-center gap-2 mb-2">
                      {surp != null && (
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                          surp > 0 ? "text-[#00c805] bg-[#0a1a0a]" : "text-[#ff5000] bg-[#1a0a0a]"
                        }`}>
                          EPS {surp > 0 ? "+" : ""}{surp.toFixed(1)}%
                        </span>
                      )}
                      {rxn != null && (
                        <span className={`text-[9px] font-semibold flex items-center gap-0.5 ${
                          rxn >= 0 ? "text-[#00c805]" : "text-[#ff5000]"
                        }`}>
                          {rxn >= 0 ? <TrendingUp size={9}/> : <TrendingDown size={9}/>}
                          {rxn >= 0 ? "+" : ""}{rxn.toFixed(1)}%
                        </span>
                      )}
                    </div>

                    {/* Headline */}
                    {s.headline && (
                      <p className="text-[#777] text-[10px] leading-relaxed line-clamp-2">{s.headline}</p>
                    )}

                    {/* Near-term teaser */}
                    {s.near_term_outlook && (
                      <p className="text-[#555] text-[9px] leading-relaxed mt-1 line-clamp-1 italic">
                        {s.near_term_outlook}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-[10px] text-[#2a2a2a] text-center">
              Generated in Earnings tab · Click 📅 Earnings to see full summaries
            </div>
          </div>
        )}

        {/* ── Streaks & Badges ── */}
        {!loading && (portfolios.length > 0 || properties.length > 0) && (
          <AchievementsCard
            wealthScore={wealthScoreValue}
            netWorth={netWealth > 0 ? netWealth : undefined}
            currentPage="dashboard"
          />
        )}

        {loading ? (
          <div className="text-center py-20 text-[#555]">Loading...</div>
        ) : (
          /* ── Three-column layout ── */
          <div className="flex gap-5 items-start">

            {/* Left — Popi */}
            <div className="w-[440px] shrink-0 sticky top-6">
              <Popi />
            </div>

            {/* Centre — Portfolios */}
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex items-baseline justify-between mb-1">
                <h1 className="text-xl font-semibold text-white">Portfolios</h1>
                {portfolios.length > 0 && (
                  <div className="flex gap-4 text-sm">
                    <span>
                      <span className="text-[#555] text-xs mr-1">Today</span>
                      <span className={todayUp ? "text-[#00c805]" : "text-[#ff5000]"}>
                        {todayUp ? "+" : ""}{fmtFull(totalTodayValue)} ({todayUp ? "+" : ""}{totalTodayPct.toFixed(2)}%)
                      </span>
                    </span>
                    <span>
                      <span className="text-[#555] text-xs mr-1">Total</span>
                      <span className={isUp ? "text-[#00c805]" : "text-[#ff5000]"}>
                        {isUp ? "+" : ""}{fmtFull(totalGain)} ({isUp ? "+" : ""}{totalGainPct.toFixed(2)}%)
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {portfolios.length > 0 && <AllocationChart portfolios={portfolios} onViewStock={onViewStock} />}

              {portfolios.map((p) => {
                const up = p.total_gain_loss >= 0;
                const pTodayVal = p.holdings.reduce((s, h) => s + h.day_change_value, 0);
                const pPrevTotal = p.total_value - pTodayVal;
                const pTodayPct = pPrevTotal > 0 ? (pTodayVal / pPrevTotal) * 100 : 0;
                const pTodayUp = pTodayVal >= 0;

                // Extended-hours: sum change_pct weighted by position value
                const isExtended = session === "pre_market" || session === "post_market";
                const extLabel = session === "pre_market" ? "Pre-Mkt" : "After Hrs";
                const extSymbol = session === "pre_market" ? "🌅" : "🌙";
                let extChangeVal = 0;
                if (isExtended) {
                  for (const h of p.holdings) {
                    const ext = extendedPrices[h.symbol];
                    if (ext) extChangeVal += ext.change * h.total_quantity;
                  }
                }
                const extUp = extChangeVal >= 0;

                return (
                  <div
                    key={p.id}
                    onClick={() => onSelect(p)}
                    className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-5 cursor-pointer hover:bg-[#1a1a1a] transition-colors group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-white font-semibold truncate">{p.name}</h2>
                          {pTodayUp ? <TrendingUp size={14} className="text-[#00c805] shrink-0" /> : <TrendingDown size={14} className="text-[#ff5000] shrink-0" />}
                          <span className="text-[10px] text-[#555] bg-[#1a1a1a] border border-[#2a2a2a] px-1.5 py-0.5 rounded shrink-0">
                            {p.account_type === "cash" ? "Cash" :
                             p.account_type === "roth_ira" ? "Roth IRA" :
                             p.account_type === "traditional_ira" ? "Trad. IRA" :
                             p.account_type === "401k" ? `401(k)${p.company_name ? ` · ${p.company_name}` : ""}` :
                             "Brokerage"}
                          </span>
                        </div>
                        <div className="text-xl font-semibold text-white">{fmtFull(p.total_value)}</div>
                        <div className="flex gap-4 mt-1 flex-wrap">
                          <div>
                            <span className="text-[#555] text-xs mr-1">Today</span>
                            <span className={`text-sm ${pTodayUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                              {pTodayUp ? "+" : ""}{fmtFull(pTodayVal)} ({pTodayUp ? "+" : ""}{pTodayPct.toFixed(2)}%)
                            </span>
                          </div>
                          <div>
                            <span className="text-[#555] text-xs mr-1">Total</span>
                            <span className={`text-sm ${up ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                              {up ? "+" : ""}{fmtFull(p.total_gain_loss)} ({up ? "+" : ""}{p.total_gain_loss_pct.toFixed(2)}%)
                            </span>
                          </div>
                          {isExtended && extChangeVal !== 0 && (
                            <div>
                              <span className="text-[#555] text-xs mr-1">{extSymbol} {extLabel}</span>
                              <span className={`text-sm ${extUp ? "text-[#f7c44f]" : "text-[#f87171]"}`}>
                                {extUp ? "+" : ""}{fmtFull(extChangeVal)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 ml-3 shrink-0">
                        <button
                          onClick={(e) => handleDelete(p.id, e)}
                          className="opacity-0 group-hover:opacity-100 text-[#555] hover:text-[#ff5000] transition-all"
                        >
                          <Trash2 size={15} />
                        </button>
                        <div className="text-right">
                          <div className="text-[#8a8a8a] text-xs">{p.holdings.length} positions</div>
                          {p.cash_balance > 0 && (
                            <div className="text-[#8a8a8a] text-xs">{fmt(p.cash_balance)} cash</div>
                          )}
                        </div>
                      </div>
                    </div>
                    {p.holdings.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {p.holdings.slice(0, 5).map((h) => (
                          <span
                            key={h.id}
                            onClick={(e) => { if (onViewStock) { e.stopPropagation(); onViewStock(h.symbol); } }}
                            className={`text-xs bg-[#222] text-[#8a8a8a] px-2 py-0.5 rounded ${onViewStock ? "cursor-pointer hover:bg-[#2a2a2a] hover:text-white transition-colors" : ""}`}
                          >
                            {h.symbol}
                          </span>
                        ))}
                        {p.holdings.length > 5 && (
                          <span className="text-xs text-[#555]">+{p.holdings.length - 5} more</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {wizard ? (
                <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-5">
                  {/* Step: account type */}
                  {wizard.step === "type" && (
                    <>
                      <div className="text-white font-semibold mb-1">What kind of account?</div>
                      <div className="text-[#555] text-xs mb-3">Choose the account type to get started</div>
                      <div className="space-y-2">
                        {[
                          { id: "brokerage",       label: "Brokerage",       desc: "Stocks, ETFs, crypto — taxable",             icon: "📊" },
                          { id: "roth_ira",        label: "Roth IRA",        desc: "Tax-free growth, after-tax contributions",   icon: "🌱" },
                          { id: "traditional_ira", label: "Traditional IRA", desc: "Tax-deferred growth, pre-tax contributions", icon: "🏦" },
                          { id: "401k",            label: "401(k)",          desc: "Employer-sponsored retirement plan",         icon: "🏢" },
                          { id: "cash",            label: "Cash Account",    desc: "Cash only — no securities",                  icon: "💵" },
                        ].map((t) => (
                          <button key={t.id}
                            onClick={() => setWizard({ step: t.id === "401k" ? "employer" : "name", accountType: t.id, name: "", company: "", employerStatus: "" })}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#2a2a2a] hover:border-[#444] hover:bg-[#1a1a1a] text-left transition-all group">
                            <span className="text-lg">{t.icon}</span>
                            <div>
                              <div className="text-white text-sm font-medium">{t.label}</div>
                              <div className="text-[#555] text-xs">{t.desc}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                      <button onClick={closeWizard} className="w-full mt-3 py-2 rounded-lg border border-[#2a2a2a] text-[#8a8a8a] text-sm hover:text-white transition-colors">Cancel</button>
                    </>
                  )}

                  {/* Step: employer (401k only) */}
                  {wizard.step === "employer" && (
                    <>
                      <div className="text-white font-semibold mb-1">401(k) details</div>
                      <div className="text-[#555] text-xs mb-3">Tell us about this plan</div>
                      <div className="space-y-3">
                        <div>
                          <label className="text-[#8a8a8a] text-xs block mb-1">Company / Employer name</label>
                          <input autoFocus value={wizard.company}
                            onChange={(e) => setWizard((w) => w && ({ ...w, company: e.target.value }))}
                            placeholder="e.g. Google, Amazon..."
                            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-[#555] placeholder-[#444]" />
                        </div>
                        <div>
                          <label className="text-[#8a8a8a] text-xs block mb-1">Employment status</label>
                          <div className="flex gap-2">
                            {["current", "past"].map((s) => (
                              <button key={s} onClick={() => setWizard((w) => w && ({ ...w, employerStatus: s }))}
                                className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${wizard.employerStatus === s ? "bg-white text-black border-white" : "border-[#2a2a2a] text-[#8a8a8a] hover:border-[#444] hover:text-white"}`}>
                                {s === "current" ? "Current employer" : "Past employer"}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button onClick={() => setWizard((w) => w && ({ ...w, step: "type" }))} className="flex-1 py-2 rounded-lg border border-[#2a2a2a] text-[#8a8a8a] text-sm">Back</button>
                        <button onClick={() => setWizard((w) => w && ({ ...w, step: "name" }))}
                          disabled={!wizard.company.trim() || !wizard.employerStatus}
                          className="flex-1 py-2 rounded-lg bg-white text-black font-semibold text-sm hover:bg-[#ddd] disabled:opacity-50">Next</button>
                      </div>
                    </>
                  )}

                  {/* Step: name */}
                  {wizard.step === "name" && (
                    <>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="text-white font-semibold">Name this account</div>
                        <span className="text-[10px] bg-[#1a1a1a] border border-[#2a2a2a] text-[#8a8a8a] px-2 py-0.5 rounded">
                          {wizard.accountType === "cash" ? "💵 Cash Account" :
                           wizard.accountType === "roth_ira" ? "🌱 Roth IRA" :
                           wizard.accountType === "traditional_ira" ? "🏦 Traditional IRA" :
                           wizard.accountType === "401k" ? `🏢 401(k)${wizard.company ? ` · ${wizard.company}` : ""}` :
                           "📊 Brokerage"}
                        </span>
                      </div>
                      <input autoFocus
                        className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-[#555] placeholder-[#444] mb-4"
                        placeholder={
                          wizard.accountType === "cash" ? "e.g. Emergency Fund" :
                          wizard.accountType === "roth_ira" ? "e.g. My Roth IRA" :
                          wizard.accountType === "traditional_ira" ? "e.g. Traditional IRA" :
                          wizard.accountType === "401k" ? `e.g. ${wizard.company || "Company"} 401(k)` :
                          "e.g. Main Portfolio"
                        }
                        value={wizard.name}
                        onChange={(e) => setWizard((w) => w && ({ ...w, name: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") handleCreate({ ...wizard }) }}
                      />
                      <div className="flex gap-2">
                        <button onClick={() => setWizard((w) => w && ({ ...w, step: wizard.accountType === "401k" ? "employer" : "type" }))} className="flex-1 py-2 rounded-lg border border-[#2a2a2a] text-[#8a8a8a] text-sm">Back</button>
                        <button
                          onClick={() => handleCreate({ ...wizard })}
                          disabled={!wizard.name.trim()}
                          className="flex-1 py-2 rounded-lg bg-white text-black font-semibold text-sm hover:bg-[#ddd] disabled:opacity-50"
                        >Create</button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button
                  onClick={openWizard}
                  className="w-full border border-dashed border-[#2a2a2a] rounded-2xl p-4 text-[#555] hover:text-[#8a8a8a] hover:border-[#444] transition-colors flex items-center justify-center gap-2 text-sm"
                >
                  <Plus size={16} /> New Portfolio
                </button>
              )}
            </div>

            {/* Right — Sector breakdown + Real Estate */}
            <div className="w-72 shrink-0 space-y-4">
              {sectorData.length > 0 && <SectorPieChart data={sectorData} />}
              <div>
                <div className="flex items-baseline justify-between mb-3 px-0.5">
                  <h1 className="text-xl font-semibold text-white">Real Estate</h1>
                </div>
                <RealEstatePanel properties={properties} onChange={setProperties} />
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
