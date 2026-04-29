import { useState, useCallback, useMemo } from "react";
import { ArrowLeft, Plus, DollarSign, Pencil, Check } from "lucide-react";
import type { Portfolio, Holding } from "../types";
import {
  addHolding,
  addTransaction,
  deleteHolding,
  deleteTransaction,
  updatePortfolio,
  sellHolding,
} from "../api";
import PortfolioChart from "../components/PortfolioChart";
import HoldingsTable from "../components/HoldingsTable";
import AddHoldingModal from "../components/AddHoldingModal";
import CashModal from "../components/CashModal";
import SellModal from "../components/SellModal";
import BuyAnalysis from "../components/BuyAnalysis";
import Popi from "../components/Popi";
import { useBuyTargets } from "../hooks/useBuyTargets";
import type { ExtendedPrice } from "../hooks/useWebSocket";

interface Props {
  portfolio: Portfolio;
  onBack: () => void;
  onUpdate: (p: Portfolio) => void;
  onViewStock?: (symbol: string) => void;
  extendedPrices?: Record<string, ExtendedPrice>;
  session?: string;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function PortfolioDetail({ portfolio, onBack, onUpdate, onViewStock, extendedPrices = {}, session = "closed" }: Props) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [addBuyFor, setAddBuyFor] = useState<Holding | null>(null);
  const [sellFor, setSellFor] = useState<Holding | null>(null);
  const [showCash, setShowCash] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(portfolio.name);

  // Recalculate totals using extended prices when in pre/post market
  const { adjTotalValue, adjGainLoss, adjGainLossPct } = useMemo(() => {
    const useExt = session === "pre_market" || session === "post_market";
    if (!useExt) {
      return {
        adjTotalValue: portfolio.total_value,
        adjGainLoss: portfolio.total_gain_loss,
        adjGainLossPct: portfolio.total_gain_loss_pct,
      };
    }
    let investedValue = 0;
    let totalCostCalc = 0;
    for (const h of portfolio.holdings) {
      const ext = extendedPrices[h.symbol];
      investedValue += ext ? ext.price * h.total_quantity : h.current_value;
      totalCostCalc += h.total_cost;
    }
    const total = investedValue + portfolio.cash_balance;
    const gl = investedValue - totalCostCalc;
    const glPct = totalCostCalc > 0 ? (gl / totalCostCalc) * 100 : 0;
    return { adjTotalValue: total, adjGainLoss: gl, adjGainLossPct: glPct };
  }, [portfolio, extendedPrices, session]);

  const isUp = adjGainLoss >= 0;

  const stockSymbols = useMemo(
    () => portfolio.holdings.filter((h) => h.asset_type !== "cash").map((h) => h.symbol),
    [portfolio.holdings]
  );
  const buyTargets = useBuyTargets(stockSymbols);

  const handleAdd = useCallback(
    async (data: {
      symbol: string;
      name: string;
      asset_type: string;
      entries: { quantity: string; buy_price: string; purchased_at: string }[];
    }) => {
      let updated = portfolio;
      for (const entry of data.entries) {
        updated = await addHolding(portfolio.id, {
          symbol: data.symbol,
          name: data.name,
          asset_type: data.asset_type,
          quantity: parseFloat(entry.quantity),
          buy_price: parseFloat(entry.buy_price),
          purchased_at: entry.purchased_at ? new Date(entry.purchased_at).toISOString() : undefined,
        });
      }
      onUpdate(updated);
    },
    [portfolio, onUpdate]
  );

  const handleAddBuy = useCallback(
    async (data: {
      symbol: string;
      name: string;
      asset_type: string;
      entries: { quantity: string; buy_price: string; purchased_at: string }[];
    }) => {
      if (!addBuyFor) return;
      let updated = portfolio;
      for (const entry of data.entries) {
        updated = await addTransaction(portfolio.id, addBuyFor.id, {
          quantity: parseFloat(entry.quantity),
          buy_price: parseFloat(entry.buy_price),
          purchased_at: entry.purchased_at ? new Date(entry.purchased_at).toISOString() : undefined,
        });
      }
      onUpdate(updated);
      setAddBuyFor(null);
    },
    [portfolio, addBuyFor, onUpdate]
  );

  const handleDeleteHolding = useCallback(
    async (holdingId: number) => {
      await deleteHolding(portfolio.id, holdingId);
      const updated = {
        ...portfolio,
        holdings: portfolio.holdings.filter((h) => h.id !== holdingId),
      };
      // Recalculate totals
      const totalCost = updated.holdings.reduce((s, h) => s + h.total_cost, 0);
      const totalValue = updated.holdings.reduce((s, h) => s + h.current_value, 0) + updated.cash_balance;
      onUpdate({ ...updated, total_cost: totalCost, total_value: totalValue });
    },
    [portfolio, onUpdate]
  );

  const handleDeleteTransaction = useCallback(
    async (holdingId: number, txId: number) => {
      const updated = await deleteTransaction(portfolio.id, holdingId, txId).then(() =>
        import("../api").then((m) => m.getPortfolio(portfolio.id))
      );
      onUpdate(updated);
    },
    [portfolio, onUpdate]
  );

  const handleSaveCash = useCallback(
    async (amount: number) => {
      const updated = await updatePortfolio(portfolio.id, portfolio.name, amount);
      onUpdate(updated);
    },
    [portfolio, onUpdate]
  );

  const handleSell = useCallback(
    async (quantity: number, sellPrice: number) => {
      if (!sellFor) return;
      const updated = await sellHolding(portfolio.id, sellFor.id, { quantity, sell_price: sellPrice });
      onUpdate(updated);
      setSellFor(null);
    },
    [portfolio, sellFor, onUpdate]
  );

  const handleSaveName = useCallback(async () => {
    if (nameValue.trim() && nameValue !== portfolio.name) {
      const updated = await updatePortfolio(portfolio.id, nameValue.trim());
      onUpdate(updated);
    }
    setEditingName(false);
  }, [nameValue, portfolio, onUpdate]);

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button onClick={onBack} className="text-[#8a8a8a] hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          {editingName ? (
            <div className="flex items-center gap-2 flex-1">
              <input
                className="bg-[#1a1a1a] border border-[#444] rounded-lg px-3 py-1 text-white text-lg font-semibold outline-none"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                autoFocus
              />
              <button onClick={handleSaveName} className="text-[#00c805]">
                <Check size={18} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <h1 className="text-xl font-semibold text-white">{portfolio.name}</h1>
              <span className="text-[10px] text-[#555] bg-[#1a1a1a] border border-[#2a2a2a] px-2 py-0.5 rounded">
                {portfolio.account_type === "cash" ? "Cash Account" :
                 portfolio.account_type === "roth_ira" ? "Roth IRA" :
                 portfolio.account_type === "traditional_ira" ? "Traditional IRA" :
                 portfolio.account_type === "401k"
                   ? `401(k)${portfolio.company_name ? ` · ${portfolio.company_name}` : ""}${portfolio.employer_status ? ` (${portfolio.employer_status})` : ""}`
                   : "Brokerage"}
              </span>
              <button onClick={() => setEditingName(true)} className="text-[#555] hover:text-[#8a8a8a]">
                <Pencil size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Two-column body */}
        <div className="flex gap-5 items-start">
          {/* Left — chart, stats, holdings */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Chart */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6">
              <PortfolioChart portfolio={portfolio} />
            </div>

            {/* Summary row */}
            {(() => {
              const todayValue = portfolio.holdings.reduce((s, h) => s + h.day_change_value, 0);
              const prevTotal = adjTotalValue - todayValue;
              const todayPct = prevTotal > 0 ? (todayValue / prevTotal) * 100 : 0;
              const todayUp = todayValue >= 0;
              return (
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
                    <div className="text-[#8a8a8a] text-xs mb-1">Total Value</div>
                    <div className="text-white font-semibold">{fmt(adjTotalValue)}</div>
                  </div>
                  <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
                    <div className="text-[#8a8a8a] text-xs mb-1">Today's Return</div>
                    <div className={`font-semibold ${todayUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                      {todayUp ? "+" : ""}{fmt(todayValue)}
                    </div>
                    <div className={`text-xs mt-0.5 ${todayUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                      {todayUp ? "+" : ""}{todayPct.toFixed(2)}%
                    </div>
                  </div>
                  <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
                    <div className="text-[#8a8a8a] text-xs mb-1">Total Return</div>
                    <div className={`font-semibold ${isUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                      {isUp ? "+" : ""}{fmt(adjGainLoss)}
                    </div>
                    <div className={`text-xs mt-0.5 ${isUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                      {isUp ? "+" : ""}{adjGainLossPct.toFixed(2)}%
                    </div>
                  </div>
                  <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-4">
                    <div className="text-[#8a8a8a] text-xs mb-1">Cash</div>
                    <div className="text-white font-semibold">{fmt(portfolio.cash_balance)}</div>
                    {adjTotalValue > 0 && (
                      <div className="text-[#8a8a8a] text-xs mt-0.5">
                        {((portfolio.cash_balance / adjTotalValue) * 100).toFixed(1)}% of portfolio
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Holdings */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold">Holdings</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowCash(true)}
                    className="flex items-center gap-1.5 text-sm text-[#8a8a8a] hover:text-white border border-[#2a2a2a] rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <DollarSign size={14} />
                    Cash
                  </button>
                  {portfolio.account_type !== "cash" && (
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="flex items-center gap-1.5 text-sm bg-white text-black font-medium rounded-lg px-3 py-1.5 hover:bg-[#ddd] transition-colors"
                    >
                      <Plus size={14} />
                      Add
                    </button>
                  )}
                </div>
              </div>

              <HoldingsTable
                holdings={portfolio.holdings}
                totalPortfolioValue={portfolio.total_value}
                onAddBuy={(h) => setAddBuyFor(h)}
                onSell={(h) => setSellFor(h)}
                onDeleteHolding={handleDeleteHolding}
                onDeleteTransaction={handleDeleteTransaction}
                buyTargets={buyTargets}
                onViewStock={onViewStock}
                extendedPrices={extendedPrices}
                session={session}
              />
            </div>
          </div>

          {/* Right — Popi + buy analysis */}
          <div className="w-[360px] shrink-0 sticky top-6 space-y-4">
            <Popi />
            {portfolio.account_type !== "cash" && (
              <BuyAnalysis portfolio={portfolio} onViewStock={onViewStock} />
            )}
          </div>
        </div>
      </div>

      {showAddModal && (
        <AddHoldingModal onClose={() => setShowAddModal(false)} onAdd={handleAdd} />
      )}

      {addBuyFor && (
        <AddHoldingModal
          onClose={() => setAddBuyFor(null)}
          onAdd={handleAddBuy}
          existingHolding={addBuyFor}
        />
      )}

      {showCash && (
        <CashModal
          current={portfolio.cash_balance}
          onSave={handleSaveCash}
          onClose={() => setShowCash(false)}
          isCashAccount={portfolio.account_type === "cash"}
        />
      )}

      {sellFor && (
        <SellModal holding={sellFor} onClose={() => setSellFor(null)} onSell={handleSell} />
      )}
    </div>
  );
}
