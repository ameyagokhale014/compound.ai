import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2, Plus, ArrowUpDown, TrendingDown } from "lucide-react";
import type { Holding, CachedBuyTarget } from "../types";
import type { ExtendedPrice } from "../hooks/useWebSocket";

interface Props {
  holdings: Holding[];
  totalPortfolioValue: number;
  onAddBuy: (holding: Holding) => void;
  onSell: (holding: Holding) => void;
  onDeleteHolding: (holdingId: number) => void;
  onDeleteTransaction: (holdingId: number, txId: number) => void;
  buyTargets?: Map<string, CachedBuyTarget>;
  onViewStock?: (symbol: string) => void;
  extendedPrices?: Record<string, ExtendedPrice>;
  session?: string;
}

const SIGNAL_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  strong_buy:   { bg: "bg-[#0a2a0a]", text: "text-[#00c805]", label: "Strong Buy" },
  buy:          { bg: "bg-[#0d1f0d]", text: "text-[#4dbb50]", label: "Buy" },
  near_target:  { bg: "bg-[#261f00]", text: "text-[#f7c44f]", label: "Near" },
  above_target: { bg: "bg-[#2a0a0a]", text: "text-[#ff5000]", label: "Above" },
};

type SortKey = "value" | "day_change" | "total_return";
type SortDir = "desc" | "asc";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtNum(n: number, digits = 4) {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

const TYPE_BADGE: Record<string, string> = {
  stock: "bg-[#1a2a1a] text-[#00c805]",
  etf: "bg-[#1a1a2a] text-[#4488ff]",
  mutual_fund: "bg-[#2a1a2a] text-[#cc44ff]",
  crypto: "bg-[#2a1a2a] text-[#ff8800]",
  cash: "bg-[#2a2a1a] text-[#ffcc00]",
};

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "value", label: "Value" },
  { key: "day_change", label: "Day Change" },
  { key: "total_return", label: "Total Return" },
];

function sortHoldings(holdings: Holding[], key: SortKey, dir: SortDir): Holding[] {
  return [...holdings].sort((a, b) => {
    let av: number, bv: number;
    if (key === "value") { av = a.current_value; bv = b.current_value; }
    else if (key === "day_change") { av = a.day_change_pct; bv = b.day_change_pct; }
    else { av = a.gain_loss_pct; bv = b.gain_loss_pct; }
    return dir === "desc" ? bv - av : av - bv;
  });
}

export default function HoldingsTable({ holdings, totalPortfolioValue, onAddBuy, onSell, onDeleteHolding, onDeleteTransaction, buyTargets, onViewStock, extendedPrices = {}, session = "closed" }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (holdings.length === 0) {
    return (
      <div className="text-center py-12 text-[#555]">
        <div className="text-lg mb-2">No positions yet</div>
        <div className="text-sm">Add stocks, ETFs, crypto, or cash to get started</div>
      </div>
    );
  }

  const sorted = sortHoldings(holdings, sortKey, sortDir);

  return (
    <div>
      {/* Sort bar */}
      <div className="flex items-center gap-1 mb-3 pb-3 border-b border-[#1a1a1a]">
        <span className="text-[#555] text-xs mr-1">
          <ArrowUpDown size={11} className="inline mr-0.5" />
          Sort:
        </span>
        {SORT_OPTIONS.map(({ key, label }) => {
          const active = sortKey === key;
          return (
            <button
              key={key}
              onClick={() => handleSort(key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                active
                  ? "bg-[#222] text-white"
                  : "text-[#555] hover:text-[#8a8a8a]"
              }`}
            >
              {label}
              {active ? (
                sortDir === "desc" ? (
                  <ChevronDown size={11} />
                ) : (
                  <ChevronUp size={11} />
                )
              ) : (
                <ChevronDown size={11} className="opacity-30" />
              )}
            </button>
          );
        })}
      </div>

      {/* Column headers */}
      <div className="flex items-center px-4 pb-1 text-[#555] text-xs">
        <div className="flex-1">Position · Price</div>
        <div className="text-right w-14 ml-4">Alloc.</div>
        <div className="text-right w-28 ml-4">Value</div>
        <div className="text-right w-28 ml-4 hidden sm:block">Day Change</div>
        <div className="text-right w-28 ml-4 hidden md:block">Total Return</div>
        {buyTargets && <div className="text-right w-28 ml-4 hidden lg:block">Buy Target</div>}
        <div className="ml-3 w-16" />
      </div>

      {/* Holdings list */}
      <div className="space-y-1">
        {sorted.map((h) => {
          const isUp = h.gain_loss >= 0;
          const dayUp = h.day_change >= 0;
          const isOpen = expanded.has(h.id);
          const ext = extendedPrices[h.symbol];
          const isExtended = (session === "pre_market" || session === "post_market") && !!ext;
          const extLabel = session === "pre_market" ? "Pre-Mkt" : "After Hrs";
          const extUp = ext ? ext.change >= 0 : false;

          return (
            <div key={h.id} className="border border-[#2a2a2a] rounded-xl overflow-hidden">
              <div
                className="flex items-center px-4 py-3 hover:bg-[#1a1a1a] cursor-pointer transition-colors"
                onClick={() => toggle(h.id)}
              >
                {/* Symbol + name + price */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-white font-semibold ${onViewStock ? "cursor-pointer hover:text-[#4f8ef7] transition-colors" : ""}`}
                      onClick={(e) => { if (onViewStock) { e.stopPropagation(); onViewStock(h.symbol); } }}
                    >{h.symbol}</span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded uppercase ${
                        TYPE_BADGE[h.asset_type] ?? "bg-[#222] text-[#888]"
                      }`}
                    >
                      {h.asset_type.replace("_", " ")}
                    </span>
                  </div>
                  <div className="text-[#8a8a8a] text-xs truncate">{h.name}</div>
                  {/* Price row — shows extended price as primary when in pre/post market */}
                  {h.current_price > 0 && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-white text-sm font-semibold tabular-nums">
                        {isExtended && ext ? fmt(ext.price) : fmt(h.current_price)}
                      </span>
                      {isExtended && ext ? (
                        <span className={`text-xs ${extUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                          {extUp ? "+" : ""}{ext.change_pct.toFixed(2)}%
                        </span>
                      ) : h.total_quantity > 0 && (
                        <span className="text-[#444] text-[10px]">
                          avg {fmt(h.total_cost / h.total_quantity)}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Extended-hours session badge + regular close reference */}
                  {isExtended && ext && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        session === "pre_market"
                          ? "bg-[#2a2000] text-[#f7c44f]"
                          : "bg-[#1e1030] text-[#a78bfa]"
                      }`}>
                        {extLabel}
                      </span>
                      <span className="text-[#555] text-[10px]">
                        close {fmt(ext.reg_close ?? h.current_price)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Allocation % */}
                <div className="text-right ml-4 w-14">
                  {totalPortfolioValue > 0 ? (
                    <>
                      <div className="text-white text-sm font-medium">
                        {((h.current_value / totalPortfolioValue) * 100).toFixed(1)}%
                      </div>
                      <div className="w-full bg-[#2a2a2a] rounded-full h-1 mt-1">
                        <div
                          className="bg-[#444] h-1 rounded-full"
                          style={{ width: `${Math.min((h.current_value / totalPortfolioValue) * 100, 100)}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="text-[#555] text-sm">—</div>
                  )}
                </div>

                {/* Value — uses extended price when available */}
                <div className="text-right ml-4 w-28">
                  <div className="text-white text-sm font-medium">
                    {isExtended && ext ? fmt(ext.price * h.total_quantity) : fmt(h.current_value)}
                  </div>
                  <div className="text-[#8a8a8a] text-xs">{fmtNum(h.total_quantity)} sh</div>
                </div>

                {/* Day change */}
                <div className="text-right ml-4 w-28 hidden sm:block">
                  <div className={`text-sm ${dayUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                    {dayUp ? "+" : ""}
                    {h.day_change_pct.toFixed(2)}%
                  </div>
                  <div className={`text-xs ${dayUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                    {dayUp ? "+" : ""}
                    {fmt(h.day_change_value)}
                  </div>
                </div>

                {/* Total return */}
                <div className="text-right ml-4 w-28 hidden md:block">
                  <div className={`text-sm ${isUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                    {isUp ? "+" : ""}
                    {h.gain_loss_pct.toFixed(2)}%
                  </div>
                  <div className={`text-xs ${isUp ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                    {isUp ? "+" : ""}
                    {fmt(h.gain_loss)}
                  </div>
                </div>

                {/* Buy Target */}
                {buyTargets && (() => {
                  const bt = buyTargets.get(h.symbol);
                  if (!bt || !bt.base_buy_price || !bt.signal) {
                    return <div className="text-right ml-4 w-28 hidden lg:block"><div className="text-[#444] text-xs">—</div></div>;
                  }
                  const style = SIGNAL_STYLE[bt.signal];
                  const distPct = bt.current_price && bt.base_buy_price
                    ? ((bt.current_price - bt.base_buy_price) / bt.base_buy_price) * 100
                    : null;
                  return (
                    <div className="text-right ml-4 w-28 hidden lg:block">
                      <div className="text-white text-sm">{fmt(bt.base_buy_price)}</div>
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                          {style.label}
                        </span>
                        {distPct !== null && (
                          <span className={`text-[10px] ${distPct < 0 ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                            {distPct < 0 ? "" : "+"}{distPct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Actions */}
                <div className="ml-3 flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); onAddBuy(h); }}
                    className="text-[#555] hover:text-[#00c805] p-1"
                    title="Add buy"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSell(h); }}
                    className="text-[#555] hover:text-[#ff5000] p-1"
                    title="Sell shares"
                  >
                    <TrendingDown size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteHolding(h.id); }}
                    className="text-[#555] hover:text-[#ff5000] p-1"
                    title="Remove position"
                  >
                    <Trash2 size={14} />
                  </button>
                  {isOpen ? (
                    <ChevronUp size={14} className="text-[#555]" />
                  ) : (
                    <ChevronDown size={14} className="text-[#555]" />
                  )}
                </div>
              </div>

              {/* Expanded transactions */}
              {isOpen && (
                <div className="border-t border-[#2a2a2a] bg-[#0f0f0f] px-4 py-3">
                  <div className="text-[#8a8a8a] text-xs uppercase tracking-wide mb-2">Transactions</div>
                  <div className="space-y-1">
                    {h.transactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between py-1.5 border-b border-[#1a1a1a] last:border-0"
                      >
                        <div className="text-[#8a8a8a] text-xs">
                          {new Date(tx.purchased_at).toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                          })}
                        </div>
                        <div className="text-white text-sm">{fmtNum(tx.quantity)} shares</div>
                        <div className="text-white text-sm">{fmt(tx.buy_price)}</div>
                        <div className="text-[#8a8a8a] text-xs">{fmt(tx.quantity * tx.buy_price)}</div>
                        <button
                          onClick={() => onDeleteTransaction(h.id, tx.id)}
                          className="text-[#555] hover:text-[#ff5000] ml-2"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
