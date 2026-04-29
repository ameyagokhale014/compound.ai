import { useState, useEffect } from "react";
import { X, Plus, Minus, RefreshCw } from "lucide-react";

interface Props {
  current: number;
  onSave: (newTotal: number) => Promise<void>;
  onClose: () => void;
  isCashAccount?: boolean;
}

const CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR",
  "HKD", "SGD", "NOK", "SEK", "DKK", "NZD", "MXN", "BRL", "ZAR",
  "AED", "KRW", "THB", "MYR", "IDR", "PHP", "PLN", "CZK", "HUF",
  "TRY", "ILS", "SAR",
];

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function CashModal({ current, onSave, onClose, isCashAccount }: Props) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"add" | "withdraw">("add");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Multi-currency state (cash accounts only)
  const [currency, setCurrency] = useState("USD");
  const [rates, setRates] = useState<Record<string, number>>({});
  const [loadingRates, setLoadingRates] = useState(false);
  const [ratesError, setRatesError] = useState(false);

  useEffect(() => {
    if (!isCashAccount) return;
    setLoadingRates(true);
    setRatesError(false);
    fetch("https://open.er-api.com/v6/latest/USD")
      .then((r) => r.json())
      .then((data) => {
        if (data.rates) setRates(data.rates);
        else setRatesError(true);
      })
      .catch(() => setRatesError(true))
      .finally(() => setLoadingRates(false));
  }, [isCashAccount]);

  const parsed = parseFloat(amount) || 0;
  const rate = rates[currency] ?? 1;
  const usdAmount = currency === "USD" ? parsed : parsed / rate;
  const newTotal = mode === "add" ? current + usdAmount : current - usdAmount;

  async function handleSave() {
    if (!amount || parsed <= 0) return setError("Enter a valid amount");
    if (mode === "withdraw" && usdAmount > current) return setError("Cannot withdraw more than current balance");
    setError("");
    setSaving(true);
    try {
      await onSave(newTotal);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
          <h2 className="text-white font-semibold">{isCashAccount ? "Add / Withdraw Cash" : "Cash"}</h2>
          <button onClick={onClose} className="text-[#555] hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Current balance */}
          <div className="flex items-center justify-between bg-[#1a1a1a] rounded-xl px-4 py-3">
            <span className="text-[#8a8a8a] text-sm">Current balance</span>
            <span className="text-white font-semibold">{fmt(current)}</span>
          </div>

          {/* Add / Withdraw toggle */}
          <div className="flex rounded-lg overflow-hidden border border-[#2a2a2a]">
            <button
              onClick={() => { setMode("add"); setError(""); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors ${
                mode === "add" ? "bg-[#00c805] text-black" : "text-[#8a8a8a] hover:text-white"
              }`}
            >
              <Plus size={14} /> Add Cash
            </button>
            <button
              onClick={() => { setMode("withdraw"); setError(""); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors ${
                mode === "withdraw" ? "bg-[#ff5000] text-white" : "text-[#8a8a8a] hover:text-white"
              }`}
            >
              <Minus size={14} /> Withdraw
            </button>
          </div>

          {/* Amount + currency selector (cash accounts) or plain USD input */}
          {isCashAccount ? (
            <div className="space-y-2">
              <label className="text-[#8a8a8a] text-xs uppercase tracking-wide block">Amount</label>
              <div className="flex gap-2">
                {/* Currency picker */}
                <select
                  value={currency}
                  onChange={(e) => { setCurrency(e.target.value); setError(""); }}
                  className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-3 text-white text-sm outline-none focus:border-[#444] w-24 shrink-0"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-white text-lg outline-none focus:border-[#444]"
                  placeholder="0.00"
                  autoFocus
                />
              </div>

              {/* Conversion preview */}
              {currency !== "USD" && parsed > 0 && (
                <div className="bg-[#1a1a1a] rounded-xl px-4 py-2.5 flex items-center justify-between">
                  {loadingRates ? (
                    <div className="flex items-center gap-2 text-[#555] text-xs">
                      <RefreshCw size={11} className="animate-spin" /> Fetching exchange rates…
                    </div>
                  ) : ratesError ? (
                    <span className="text-[#ff5000] text-xs">Could not fetch rates. Using 1:1 fallback.</span>
                  ) : (
                    <>
                      <span className="text-[#8a8a8a] text-xs">
                        {parsed.toLocaleString()} {currency} @ {(1 / rate).toFixed(4)} USD/{currency}
                      </span>
                      <span className="text-white font-semibold text-sm">{fmt(usdAmount)}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="text-[#8a8a8a] text-xs uppercase tracking-wide mb-2 block">Amount (USD)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-white text-lg outline-none focus:border-[#444]"
                placeholder="0.00"
                autoFocus
              />
            </div>
          )}

          {/* New total preview */}
          {parsed > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#8a8a8a]">New balance (USD)</span>
              <span className={`font-semibold ${newTotal >= 0 ? "text-white" : "text-[#ff5000]"}`}>
                {fmt(newTotal)}
              </span>
            </div>
          )}

          {error && <div className="text-[#ff5000] text-sm">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-[#2a2a2a] flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-[#2a2a2a] text-[#8a8a8a] text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !amount || (isCashAccount && loadingRates && currency !== "USD")}
            className="flex-1 py-2 rounded-lg bg-white text-black font-semibold text-sm hover:bg-[#ddd] disabled:opacity-50"
          >
            {saving ? "Saving..." : mode === "add" ? "Add" : "Withdraw"}
          </button>
        </div>
      </div>
    </div>
  );
}
