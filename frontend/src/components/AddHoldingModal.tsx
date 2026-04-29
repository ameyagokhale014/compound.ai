import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import StockSearch from "./StockSearch";
import type { SearchResult, Holding } from "../types";

interface BuyEntry {
  quantity: string;
  buy_price: string;
  purchased_at: string;
}

interface Props {
  onClose: () => void;
  onAdd: (data: {
    symbol: string;
    name: string;
    asset_type: string;
    entries: BuyEntry[];
  }) => Promise<void>;
  existingHolding?: Holding | null;
}

export default function AddHoldingModal({ onClose, onAdd, existingHolding }: Props) {
  const [selected, setSelected] = useState<SearchResult | null>(
    existingHolding
      ? { symbol: existingHolding.symbol, name: existingHolding.name, type: existingHolding.asset_type }
      : null
  );
  const [entries, setEntries] = useState<BuyEntry[]>([
    { quantity: "", buy_price: "", purchased_at: new Date().toISOString().split("T")[0] },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addEntry() {
    setEntries([...entries, { quantity: "", buy_price: "", purchased_at: new Date().toISOString().split("T")[0] }]);
  }

  function removeEntry(i: number) {
    setEntries(entries.filter((_, idx) => idx !== i));
  }

  function updateEntry(i: number, field: keyof BuyEntry, value: string) {
    setEntries(entries.map((e, idx) => (idx === i ? { ...e, [field]: value } : e)));
  }

  async function handleSubmit() {
    if (!selected) return setError("Select a symbol first");
    if (entries.some((e) => !e.quantity || !e.buy_price)) return setError("Fill all buy entries");
    setSaving(true);
    setError("");
    try {
      await onAdd({ symbol: selected.symbol, name: selected.name, asset_type: selected.type, entries });
      onClose();
    } catch {
      setError("Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <h2 className="text-white font-semibold">
            {existingHolding ? `Add buy for ${existingHolding.symbol}` : "Add Position"}
          </h2>
          <button onClick={onClose} className="text-[#555] hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {!existingHolding && (
            <div>
              <label className="text-[#8a8a8a] text-xs uppercase tracking-wide mb-2 block">Symbol</label>
              {selected ? (
                <div className="flex items-center justify-between bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2">
                  <div>
                    <div className="text-white font-medium">{selected.symbol}</div>
                    <div className="text-[#8a8a8a] text-xs">{selected.name}</div>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-[#555] hover:text-white">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <StockSearch onSelect={setSelected} />
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[#8a8a8a] text-xs uppercase tracking-wide">Buy Lots</label>
              <button
                onClick={addEntry}
                className="flex items-center gap-1 text-[#00c805] text-xs hover:opacity-80"
              >
                <Plus size={12} /> Add lot
              </button>
            </div>
            <div className="space-y-2">
              {entries.map((e, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="number"
                    placeholder="Shares"
                    value={e.quantity}
                    onChange={(v) => updateEntry(i, "quantity", v.target.value)}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm w-24 outline-none focus:border-[#444]"
                  />
                  <input
                    type="number"
                    placeholder="Buy price"
                    value={e.buy_price}
                    onChange={(v) => updateEntry(i, "buy_price", v.target.value)}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm flex-1 outline-none focus:border-[#444]"
                  />
                  <input
                    type="date"
                    value={e.purchased_at}
                    onChange={(v) => updateEntry(i, "purchased_at", v.target.value)}
                    className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm w-36 outline-none focus:border-[#444]"
                  />
                  {entries.length > 1 && (
                    <button onClick={() => removeEntry(i)} className="text-[#555] hover:text-[#ff5000]">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && <div className="text-[#ff5000] text-sm">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-[#2a2a2a] flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#2a2a2a] text-[#8a8a8a] hover:text-white text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2 rounded-lg bg-white text-black font-semibold text-sm hover:bg-[#ddd] disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
