import { useState } from "react";
import { X, TrendingDown, AlertTriangle } from "lucide-react";
import type { Holding } from "../types";

interface Props {
  holding: Holding;
  onClose: () => void;
  onSell: (quantity: number, sellPrice: number) => Promise<void>;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function SellModal({ holding, onClose, onSell }: Props) {
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState(holding.current_price > 0 ? String(holding.current_price.toFixed(2)) : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const maxQty = holding.total_quantity;
  const qty = parseFloat(quantity);
  const px = parseFloat(price);
  const proceeds = !isNaN(qty) && !isNaN(px) ? qty * px : null;
  const isValid = !isNaN(qty) && qty > 0 && qty <= maxQty + 1e-9 && !isNaN(px) && px > 0;

  function fillAll() {
    setQuantity(String(maxQty));
    if (holding.current_price > 0) setPrice(String(holding.current_price.toFixed(2)));
  }

  async function handleSubmit() {
    if (!isValid) return;
    setLoading(true);
    setError("");
    try {
      await onSell(qty, px);
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Sell failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 w-[420px] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <TrendingDown size={16} className="text-[#ff5000]" />
            <span className="text-white font-semibold">Sell {holding.symbol}</span>
            <span className="text-[#555] text-sm">{holding.name}</span>
          </div>
          <button onClick={onClose} className="text-[#555] hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Position summary */}
        <div className="bg-[#0f0f0f] border border-[#1e1e1e] rounded-xl px-4 py-3 mb-5 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-wide mb-0.5">Shares Held</div>
            <div className="text-white text-sm font-semibold">{maxQty.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-wide mb-0.5">Current Price</div>
            <div className="text-white text-sm font-semibold">
              {holding.current_price > 0 ? fmt(holding.current_price) : "—"}
            </div>
          </div>
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-wide mb-0.5">Market Value</div>
            <div className="text-white text-sm font-semibold">{fmt(holding.current_value)}</div>
          </div>
        </div>

        {/* Inputs */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[#8a8a8a] text-xs uppercase tracking-wide">Shares to Sell</label>
              <button
                onClick={fillAll}
                className="text-[10px] text-[#4f8ef7] hover:text-white border border-[#2a2a2a] hover:border-[#444] rounded px-2 py-0.5 transition-colors"
              >
                Sell All ({maxQty.toLocaleString()} shares)
              </button>
            </div>
            <input
              type="number"
              placeholder={`Max ${maxQty}`}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              max={maxQty}
              min={0}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2.5 text-white text-sm outline-none focus:border-[#555]"
              autoFocus
            />
            {!isNaN(qty) && qty > maxQty + 1e-9 && (
              <div className="text-[#ff5000] text-xs mt-1">Exceeds held quantity of {maxQty}</div>
            )}
          </div>

          <div>
            <label className="text-[#8a8a8a] text-xs uppercase tracking-wide block mb-1.5">
              Sell Price per Share
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">$</span>
              <input
                type="number"
                placeholder="0.00"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                min={0}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg pl-7 pr-3 py-2.5 text-white text-sm outline-none focus:border-[#555]"
              />
            </div>
          </div>
        </div>

        {/* Proceeds preview */}
        {proceeds != null && proceeds > 0 && (
          <div className="mt-4 bg-[#0a1a0a] border border-[#1a3a1a] rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-[#555] text-[10px] uppercase tracking-wide">Cash Generated</div>
              <div className="text-[#00c805] text-lg font-bold mt-0.5">{fmt(proceeds)}</div>
            </div>
            <div className="text-right">
              <div className="text-[#555] text-[10px]">Added to portfolio cash</div>
              {holding.avg_cost > 0 && (
                <div className={`text-xs mt-0.5 ${px >= holding.avg_cost ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                  {px >= holding.avg_cost ? "+" : ""}{fmt((px - holding.avg_cost) * qty)} vs cost basis
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-center gap-2 text-[#ff5000] bg-[#2a0a0a] border border-[#550000] rounded-xl px-3 py-2.5 text-xs">
            <AlertTriangle size={13} className="shrink-0" />
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-[#2a2a2a] text-[#8a8a8a] hover:text-white text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || loading}
            className="flex-1 py-2.5 rounded-xl bg-[#ff5000] text-white font-semibold text-sm hover:bg-[#cc4000] disabled:opacity-40 transition-colors"
          >
            {loading ? "Selling…" : `Sell ${!isNaN(qty) && qty > 0 ? qty.toLocaleString() + " shares" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
