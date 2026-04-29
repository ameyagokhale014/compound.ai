import { useState } from "react";
import { Plus, Trash2, Pencil, Check, X, ExternalLink, Home } from "lucide-react";
import { addRealEstate, updateRealEstate, deleteRealEstate } from "../api";
import type { RealEstateProperty } from "../types";

interface Props {
  properties: RealEstateProperty[];
  onChange: (props: RealEstateProperty[]) => void;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function ZillowLink({ address }: { address: string }) {
  const url = `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[10px] text-[#4f8ef7] hover:underline"
    >
      <ExternalLink size={10} /> Zillow
    </a>
  );
}

interface AddFormProps {
  onSave: (data: { address: string; estimated_value: number; ownership_pct: number }) => Promise<void>;
  onCancel: () => void;
}

function AddForm({ onSave, onCancel }: AddFormProps) {
  const [address, setAddress] = useState("");
  const [value, setValue] = useState("");
  const [pct, setPct] = useState("100");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!address.trim()) return setError("Enter an address");
    const v = parseFloat(value);
    const p = parseFloat(pct);
    if (isNaN(v) || v <= 0) return setError("Enter a valid home value");
    if (isNaN(p) || p <= 0 || p > 100) return setError("Ownership must be 1–100%");
    setError("");
    setSaving(true);
    try {
      await onSave({ address: address.trim(), estimated_value: v, ownership_pct: p });
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-4 space-y-3">
      <div>
        <label className="text-[#8a8a8a] text-[10px] uppercase tracking-wide block mb-1">Address</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St, City, State"
          className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder-[#444]"
          autoFocus
        />
        {address.trim().length > 5 && (
          <div className="mt-1">
            <ZillowLink address={address} />
            <span className="text-[#555] text-[10px] ml-2">← look up value</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[#8a8a8a] text-[10px] uppercase tracking-wide block mb-1">Est. Value</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">$</span>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg pl-6 pr-3 py-2 text-white text-sm outline-none focus:border-[#444]"
            />
          </div>
        </div>
        <div>
          <label className="text-[#8a8a8a] text-[10px] uppercase tracking-wide block mb-1">Ownership %</label>
          <div className="relative">
            <input
              type="number"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              min="1"
              max="100"
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 pr-7 py-2 text-white text-sm outline-none focus:border-[#444]"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">%</span>
          </div>
        </div>
      </div>
      {error && <div className="text-[#ff5000] text-xs">{error}</div>}
      {parseFloat(value) > 0 && parseFloat(pct) > 0 && (
        <div className="flex justify-between text-xs">
          <span className="text-[#8a8a8a]">Your equity</span>
          <span className="text-white font-medium">
            {fmt(parseFloat(value) * (parseFloat(pct) / 100))}
          </span>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 py-1.5 rounded-lg border border-[#2a2a2a] text-[#8a8a8a] text-xs">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-1.5 rounded-lg bg-white text-black font-semibold text-xs hover:bg-[#ddd] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add Property"}
        </button>
      </div>
    </div>
  );
}

interface EditRowProps {
  property: RealEstateProperty;
  onSave: (data: { estimated_value: number; ownership_pct: number }) => Promise<void>;
  onCancel: () => void;
}

function EditRow({ property, onSave, onCancel }: EditRowProps) {
  const [value, setValue] = useState(property.estimated_value.toString());
  const [pct, setPct] = useState(property.ownership_pct.toString());
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({ estimated_value: parseFloat(value), ownership_pct: parseFloat(pct) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="relative flex-1">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#555] text-xs">$</span>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full bg-[#111] border border-[#333] rounded-lg pl-5 pr-2 py-1.5 text-white text-xs outline-none focus:border-[#555]"
        />
      </div>
      <div className="relative w-20">
        <input
          type="number"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          min="1"
          max="100"
          className="w-full bg-[#111] border border-[#333] rounded-lg px-2 pr-5 py-1.5 text-white text-xs outline-none focus:border-[#555]"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[#555] text-xs">%</span>
      </div>
      <button onClick={handleSave} disabled={saving} className="text-[#00c805] hover:opacity-80">
        <Check size={14} />
      </button>
      <button onClick={onCancel} className="text-[#555] hover:text-white">
        <X size={14} />
      </button>
    </div>
  );
}

export default function RealEstatePanel({ properties, onChange }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const totalEquity = properties.reduce((s, p) => s + p.equity, 0);
  const totalValue = properties.reduce((s, p) => s + p.estimated_value, 0);

  async function handleAdd(data: { address: string; estimated_value: number; ownership_pct: number }) {
    const created = await addRealEstate(data);
    onChange([...properties, created]);
    setShowAdd(false);
  }

  async function handleUpdate(id: number, data: { estimated_value: number; ownership_pct: number }) {
    const updated = await updateRealEstate(id, data);
    onChange(properties.map((p) => (p.id === id ? updated : p)));
    setEditingId(null);
  }

  async function handleDelete(id: number) {
    await deleteRealEstate(id);
    onChange(properties.filter((p) => p.id !== id));
  }

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-5 h-fit">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Home size={16} className="text-[#8a8a8a]" />
          <h2 className="text-white font-semibold text-sm">Real Estate</h2>
        </div>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-xs text-[#8a8a8a] hover:text-white border border-[#2a2a2a] rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <Plus size={12} /> Add
          </button>
        )}
      </div>

      {/* Summary */}
      {properties.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-[#1a1a1a] rounded-xl p-3">
            <div className="text-[#8a8a8a] text-[10px] uppercase tracking-wide mb-0.5">Your Equity</div>
            <div className="text-white font-semibold text-sm">{fmt(totalEquity)}</div>
          </div>
          <div className="bg-[#1a1a1a] rounded-xl p-3">
            <div className="text-[#8a8a8a] text-[10px] uppercase tracking-wide mb-0.5">Total Value</div>
            <div className="text-white font-semibold text-sm">{fmt(totalValue)}</div>
          </div>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="mb-4">
          <AddForm onSave={handleAdd} onCancel={() => setShowAdd(false)} />
        </div>
      )}

      {/* Properties list */}
      {properties.length === 0 && !showAdd ? (
        <div className="text-center py-8">
          <Home size={28} className="text-[#333] mx-auto mb-2" />
          <div className="text-[#555] text-xs">No properties added yet</div>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-3 text-xs text-[#4f8ef7] hover:underline"
          >
            + Add your first property
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {properties.map((p) => {
            const isEditing = editingId === p.id;
            return (
              <div key={p.id} className="bg-[#1a1a1a] border border-[#252525] rounded-xl p-3 group">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-white text-xs font-medium leading-tight truncate">{p.address}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <ZillowLink address={p.address} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditingId(isEditing ? null : p.id)} className="text-[#555] hover:text-white p-0.5">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => handleDelete(p.id)} className="text-[#555] hover:text-[#ff5000] p-0.5">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {!isEditing ? (
                  <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                    <div>
                      <div className="text-[#555] text-[10px]">Value</div>
                      <div className="text-white text-xs font-medium">{fmt(p.estimated_value)}</div>
                    </div>
                    <div>
                      <div className="text-[#555] text-[10px]">Owned</div>
                      <div className="text-white text-xs font-medium">{p.ownership_pct}%</div>
                    </div>
                    <div>
                      <div className="text-[#555] text-[10px]">Equity</div>
                      <div className="text-[#00c805] text-xs font-medium">{fmt(p.equity)}</div>
                    </div>
                  </div>
                ) : (
                  <EditRow
                    property={p}
                    onSave={(data) => handleUpdate(p.id, data)}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
