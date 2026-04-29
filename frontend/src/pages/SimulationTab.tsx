import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, RefreshCw, TrendingUp, Zap, Target, DollarSign,
         RotateCcw, Rocket, Settings, X, AlertTriangle, MessageSquare, CheckCircle, XCircle, Send } from "lucide-react";
import { getSimulation, createSimulation, resetSimulation, popiTrade, contribute, updateSimSettings,
         suggestChanges, executeProposedTrades } from "../api";
import type { SimState, SimGoalIn, SimHoldingOut, ProposedTrade } from "../api";

// ── Formatters ────────────────────────────────────────────────────────────────
const fmt  = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const fmtD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
const fmtPct = (n: number, sign = true) =>
  `${sign && n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

// ── Risk config ───────────────────────────────────────────────────────────────
const RISK_OPTIONS = [
  { key: "conservative",   label: "Conservative",    emoji: "🛡️",  sub: "Stability first"         },
  { key: "moderate",       label: "Moderate",         emoji: "⚖️",  sub: "Balanced growth"        },
  { key: "aggressive",     label: "Aggressive",       emoji: "📈",  sub: "Growth oriented"        },
  { key: "very_aggressive",label: "Very Aggressive",  emoji: "🚀",  sub: "High risk / high reward" },
];

const PRESET_GOALS: SimGoalIn[] = [
  { name: "Pay off student loan", amount: 35000, years: 4,  priority: 1 },
  { name: "Buy a car",            amount: 28000, years: 5,  priority: 2 },
];

type TimeUnit = "years" | "months";

// ── Action badge ──────────────────────────────────────────────────────────────
const TRADE_STYLE: Record<string, { bg: string; text: string }> = {
  buy:  { bg: "bg-[#0a2a0a]", text: "text-[#00c805]" },
  sell: { bg: "bg-[#2a0a0a]", text: "text-[#ff5000]" },
};

// ── Shared goal rows editor (used in both wizard + edit panel) ─────────────────
function GoalRows({
  goals, units, horizons,
  onUpdate, onRemove, onAdd, onHorizon,
}: {
  goals: SimGoalIn[];
  units: TimeUnit[];
  horizons: number[];
  onUpdate: (i: number, field: keyof SimGoalIn, val: string | number) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  onHorizon: (i: number, raw: number, unit: TimeUnit) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[#555] text-[10px] font-medium uppercase tracking-wide">Goals</span>
        <button
          onClick={onAdd}
          className="flex items-center gap-1 text-[#4f8ef7] text-xs hover:text-[#7ab0ff] transition-colors"
        >
          <Plus size={12} /> Add Goal
        </button>
      </div>
      {/* Column headers */}
      <div className="grid grid-cols-[1fr_100px_150px_24px] gap-2 mb-1 px-0.5">
        <div className="text-[#444] text-[10px]">Description</div>
        <div className="text-[#444] text-[10px]">Amount</div>
        <div className="text-[#444] text-[10px]">Time horizon</div>
        <div />
      </div>
      <div className="space-y-2">
        {goals.map((g, i) => {
          const unit   = units[i] ?? "years";
          const rawVal = horizons[i] ?? (unit === "months" ? g.years * 12 : g.years);
          const inYears = unit === "months" ? rawVal / 12 : rawVal;
          const hint = unit === "months"
            ? `= ${inYears % 1 === 0 ? inYears : inYears.toFixed(1)} yr${inYears !== 1 ? "s" : ""}`
            : rawVal > 0 ? `= ${Math.round(rawVal * 12)} months` : "";
          return (
            <div key={i}>
              <div className="grid grid-cols-[1fr_100px_150px_24px] gap-2 items-center">
                <input
                  value={g.name}
                  onChange={e => onUpdate(i, "name", e.target.value)}
                  placeholder="e.g. Buy a car"
                  className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none focus:border-[#4f8ef7]"
                />
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#555] text-xs">$</span>
                  <input
                    type="number"
                    value={g.amount || ""}
                    onChange={e => onUpdate(i, "amount", parseFloat(e.target.value) || 0)}
                    placeholder="30000"
                    className="w-full bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg pl-4 pr-1 py-2 text-white text-xs focus:outline-none focus:border-[#4f8ef7]"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={rawVal || ""}
                    min="1"
                    onChange={e => onHorizon(i, parseFloat(e.target.value) || 1, unit)}
                    placeholder={unit === "months" ? "18" : "5"}
                    className="w-14 bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg px-1 py-2 text-white text-xs text-center focus:outline-none focus:border-[#4f8ef7]"
                  />
                  <div className="flex rounded-lg overflow-hidden border border-[#2a2a2a]">
                    <button
                      type="button"
                      onClick={() => onHorizon(i, unit === "months" ? Math.round(rawVal / 12) || 1 : rawVal, "years")}
                      className={`px-1.5 py-1.5 text-[10px] font-medium transition-colors ${
                        unit === "years" ? "bg-[#4f8ef7] text-white" : "bg-[#0d0d0d] text-[#555] hover:text-[#8a8a8a]"
                      }`}
                    >yrs</button>
                    <button
                      type="button"
                      onClick={() => onHorizon(i, unit === "years" ? Math.round(rawVal * 12) || 1 : rawVal, "months")}
                      className={`px-1.5 py-1.5 text-[10px] font-medium transition-colors ${
                        unit === "months" ? "bg-[#4f8ef7] text-white" : "bg-[#0d0d0d] text-[#555] hover:text-[#8a8a8a]"
                      }`}
                    >mos</button>
                  </div>
                </div>
                <button onClick={() => onRemove(i)} className="text-[#333] hover:text-[#ff5000] transition-colors">
                  <Trash2 size={12} />
                </button>
              </div>
              {hint && rawVal > 0 && (
                <div className="grid grid-cols-[1fr_100px_150px_24px] gap-2 -mt-0.5">
                  <div /><div />
                  <div className="text-[#3a3a3a] text-[10px] pl-0.5">{hint}</div>
                  <div />
                </div>
              )}
            </div>
          );
        })}
        {goals.length === 0 && (
          <p className="text-[#444] text-xs text-center py-2">No goals — Popi will grow wealth based on risk appetite.</p>
        )}
      </div>
    </div>
  );
}

// ── Setup Wizard ──────────────────────────────────────────────────────────────
function SetupWizard({ onCreated }: { onCreated: (s: SimState) => void }) {
  const [principal,  setPrincipal]  = useState("100000");
  const [salary,       setSalary]       = useState("");
  const [contribMode,  setContribMode]  = useState<"pct" | "fixed">("pct");
  const [contribValue, setContribValue] = useState("");
  const [risk,         setRisk]         = useState("moderate");
  const [goals,      setGoals]      = useState<SimGoalIn[]>(PRESET_GOALS);
  const [units,      setUnits]      = useState<TimeUnit[]>(PRESET_GOALS.map(() => "years"));
  const [horizons,   setHorizons]   = useState<number[]>(PRESET_GOALS.map(g => g.years));
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");

  // Check if API key is configured
  const hasApiKey = !!localStorage.getItem("anthropic_api_key");

  function addGoal() {
    setGoals(g => [...g, { name: "", amount: 0, years: 3, priority: g.length + 1 }]);
    setUnits(u => [...u, "years"]);
    setHorizons(h => [...h, 3]);
  }
  function removeGoal(i: number) {
    setGoals(g   => g.filter((_, idx) => idx !== i));
    setUnits(u   => u.filter((_, idx) => idx !== i));
    setHorizons(h => h.filter((_, idx) => idx !== i));
  }
  function updateGoal(i: number, field: keyof SimGoalIn, val: string | number) {
    setGoals(g => g.map((goal, idx) => idx === i ? { ...goal, [field]: val } : goal));
  }
  function updateHorizon(i: number, raw: number, unit: TimeUnit) {
    const inYears = unit === "months" ? raw / 12 : raw;
    setHorizons(h => h.map((v, idx) => idx === i ? raw : v));
    setUnits(u => u.map((v, idx) => idx === i ? unit : v));
    setGoals(g => g.map((goal, idx) => idx === i ? { ...goal, years: inYears } : goal));
  }

  const salaryNum    = salary ? parseFloat(salary.replace(/,/g, "")) : 0;
  const contribNum   = contribValue ? parseFloat(contribValue.replace(/,/g, "")) : 0;
  const resolvedContrib: number | undefined = (() => {
    if (!contribValue || contribNum <= 0) return undefined;
    if (contribMode === "pct") return salaryNum > 0 ? (salaryNum * contribNum / 100) : undefined;
    return contribNum;
  })();

  async function handleCreate() {
    const p = parseFloat(principal.replace(/,/g, ""));
    if (!p || p < 1000) { setError("Principal must be at least $1,000"); return; }
    if (!hasApiKey) { setError("Please add your Anthropic API key in Profile Settings (top-right corner) before creating a plan."); return; }
    setLoading(true); setError("");
    try {
      const res = await createSimulation({
        principal: p,
        monthly_salary: salaryNum > 0 ? salaryNum : undefined,
        monthly_contribution: resolvedContrib,
        risk_appetite: risk,
        goals: goals.filter(g => g.name && g.amount > 0),
      });
      if ("error" in res) { setError(res.error); return; }
      onCreated(res as SimState);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-start justify-center pt-10 pb-16 px-4">
      <div className="w-full max-w-2xl space-y-6">

        {/* Hero */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🤖</div>
          <h1 className="text-white text-3xl font-bold mb-2">Popi Sim Lab</h1>
          <p className="text-[#8a8a8a] text-sm max-w-md mx-auto leading-relaxed">
            Give Popi a principal amount and goals. Popi will pick stocks, allocate your money,
            and manage it like a real portfolio manager — completely simulated,
            isolated from your real wealth.
          </p>
        </div>

        {/* API Key Warning */}
        {!hasApiKey && (
          <div className="bg-[#1a1200] border border-[#f7c44f] rounded-2xl px-4 py-3 flex items-start gap-3">
            <AlertTriangle size={16} className="text-[#f7c44f] shrink-0 mt-0.5" />
            <div>
              <div className="text-[#f7c44f] text-xs font-semibold mb-0.5">Anthropic API Key Required</div>
              <p className="text-[#a08030] text-xs leading-relaxed">
                Popi needs an AI model to build your plan. Open <strong className="text-[#f7c44f]">Profile Settings</strong> (top-right corner),
                paste your Anthropic API key, and come back here.
              </p>
            </div>
          </div>
        )}

        {/* Principal + Salary */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 space-y-4">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <DollarSign size={14} className="text-[#4f8ef7]" /> Your Money
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[#8a8a8a] text-xs mb-1.5 block">Principal Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">$</span>
                <input
                  type="text"
                  value={principal}
                  onChange={e => setPrincipal(e.target.value)}
                  className="w-full bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl pl-7 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#4f8ef7]"
                  placeholder="100,000"
                />
              </div>
            </div>
            <div>
              <label className="text-[#8a8a8a] text-xs mb-1.5 block">Monthly Salary <span className="text-[#444]">(optional)</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">$</span>
                <input
                  type="text"
                  value={salary}
                  onChange={e => setSalary(e.target.value)}
                  className="w-full bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl pl-7 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#4f8ef7]"
                  placeholder="8,000"
                />
              </div>
            </div>
          </div>

          {/* Monthly contribution row */}
          <div>
            <label className="text-[#8a8a8a] text-xs mb-1.5 block">
              Monthly Contribution <span className="text-[#444]">(optional)</span>
            </label>
            <div className="flex items-center gap-2">
              <div className="flex rounded-xl overflow-hidden border border-[#2a2a2a] shrink-0">
                <button
                  type="button"
                  onClick={() => { setContribMode("pct"); setContribValue(""); }}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    contribMode === "pct" ? "bg-[#4f8ef7] text-white" : "bg-[#0d0d0d] text-[#555] hover:text-[#8a8a8a]"
                  }`}
                >% of salary</button>
                <button
                  type="button"
                  onClick={() => { setContribMode("fixed"); setContribValue(""); }}
                  className={`px-3 py-2 text-xs font-medium transition-colors ${
                    contribMode === "fixed" ? "bg-[#4f8ef7] text-white" : "bg-[#0d0d0d] text-[#555] hover:text-[#8a8a8a]"
                  }`}
                >$ amount</button>
              </div>
              <div className="relative flex-1 max-w-[160px]">
                {contribMode === "fixed" && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">$</span>
                )}
                <input
                  type="number"
                  min="0"
                  value={contribValue}
                  onChange={e => setContribValue(e.target.value)}
                  placeholder={contribMode === "pct" ? "10" : "500"}
                  className={`w-full bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl py-2.5 text-white text-sm focus:outline-none focus:border-[#4f8ef7] ${
                    contribMode === "fixed" ? "pl-7 pr-3" : "px-3"
                  }`}
                />
                {contribMode === "pct" && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">%</span>
                )}
              </div>
              {resolvedContrib != null && resolvedContrib > 0 ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-[#333] text-xs">=</span>
                  <span className="text-[#00c805] text-sm font-semibold">
                    ${resolvedContrib.toLocaleString("en-US", { maximumFractionDigits: 0 })}<span className="text-xs text-[#555] font-normal">/mo</span>
                  </span>
                </div>
              ) : contribMode === "pct" && contribValue && !salaryNum ? (
                <span className="text-[#555] text-xs">Enter salary to compute</span>
              ) : null}
            </div>
            <p className="text-[#333] text-[10px] mt-1.5">
              Popi will factor this into goal timelines and investment pacing.
            </p>
          </div>
        </div>

        {/* Risk Appetite */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6">
          <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
            <TrendingUp size={14} className="text-[#4f8ef7]" /> Risk Appetite
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {RISK_OPTIONS.map(r => (
              <button
                key={r.key}
                onClick={() => setRisk(r.key)}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                  risk === r.key ? "border-[#4f8ef7] bg-[#0d1a2a]" : "border-[#2a2a2a] bg-[#0d0d0d] hover:border-[#333]"
                }`}
              >
                <span className="text-xl">{r.emoji}</span>
                <div>
                  <div className={`text-xs font-semibold ${risk === r.key ? "text-white" : "text-[#8a8a8a]"}`}>{r.label}</div>
                  <div className="text-[#555] text-[10px]">{r.sub}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Goals */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6">
          <GoalRows
            goals={goals} units={units} horizons={horizons}
            onUpdate={updateGoal} onRemove={removeGoal} onAdd={addGoal} onHorizon={updateHorizon}
          />
        </div>

        {error && (
          <div className="bg-[#2a0a0a] border border-[#ff5000] rounded-xl px-4 py-3 flex items-start gap-2">
            <AlertTriangle size={14} className="text-[#ff5000] shrink-0 mt-0.5" />
            <span className="text-[#ff5000] text-xs">{error}</span>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleCreate}
          disabled={loading || !hasApiKey}
          className="w-full bg-[#4f8ef7] hover:bg-[#3d7be4] disabled:opacity-50 text-white font-semibold py-4 rounded-2xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <RefreshCw size={16} className="animate-spin" />
              Popi is building your plan…
            </>
          ) : !hasApiKey ? (
            <>
              <AlertTriangle size={16} />
              Add API Key in Profile Settings First
            </>
          ) : (
            <>
              <Rocket size={16} />
              Let Popi Build My Plan
            </>
          )}
        </button>
        <p className="text-center text-[#333] text-xs">
          This is a simulation — no real money is involved. Your real portfolio is unaffected.
        </p>
      </div>
    </div>
  );
}

// ── Edit Settings Panel (modal overlay) ───────────────────────────────────────
function EditSettingsPanel({
  sim,
  onClose,
  onUpdated,
}: {
  sim: SimState;
  onClose: () => void;
  onUpdated: (s: SimState, msg: string) => void;
}) {
  const [risk,     setRisk]     = useState(sim.risk_appetite);
  const [salary,   setSalary]   = useState(sim.monthly_salary ? String(sim.monthly_salary) : "");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");

  // Goals state
  const [goals,    setGoals]    = useState<SimGoalIn[]>(
    sim.goals.map(g => ({ name: g.name, amount: g.amount, years: g.years, priority: g.priority }))
  );
  const [units,    setUnits]    = useState<TimeUnit[]>(sim.goals.map(() => "years"));
  const [horizons, setHorizons] = useState<number[]>(sim.goals.map(g => g.years));

  function addGoal() {
    setGoals(g => [...g, { name: "", amount: 0, years: 3, priority: g.length + 1 }]);
    setUnits(u => [...u, "years"]);
    setHorizons(h => [...h, 3]);
  }
  function removeGoal(i: number) {
    setGoals(g => g.filter((_, idx) => idx !== i));
    setUnits(u => u.filter((_, idx) => idx !== i));
    setHorizons(h => h.filter((_, idx) => idx !== i));
  }
  function updateGoal(i: number, field: keyof SimGoalIn, val: string | number) {
    setGoals(g => g.map((goal, idx) => idx === i ? { ...goal, [field]: val } : goal));
  }
  function updateHorizon(i: number, raw: number, unit: TimeUnit) {
    const inYears = unit === "months" ? raw / 12 : raw;
    setHorizons(h => h.map((v, idx) => idx === i ? raw : v));
    setUnits(u => u.map((v, idx) => idx === i ? unit : v));
    setGoals(g => g.map((goal, idx) => idx === i ? { ...goal, years: inYears } : goal));
  }

  const riskChanged = risk !== sim.risk_appetite;

  async function handleSave() {
    setSaving(true); setError("");
    try {
      const salaryNum = salary ? parseFloat(salary.replace(/,/g, "")) : null;
      const res = await updateSimSettings({
        risk_appetite:  risk,
        goals:          goals.filter(g => g.name && g.amount > 0),
        monthly_salary: salaryNum && salaryNum > 0 ? salaryNum : null,
      });
      if ("error" in res) { setError(res.error); return; }
      onUpdated(
        res.state,
        res.popi_comment ||
          (riskChanged ? `Popi has updated the portfolio for your new ${risk.replace("_", " ")} risk profile.` : "Settings saved.")
      );
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-[#141414] border border-[#2a2a2a] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a] sticky top-0 bg-[#141414] z-10">
          <div className="flex items-center gap-2">
            <Settings size={14} className="text-[#4f8ef7]" />
            <span className="text-white font-semibold text-sm">Edit Simulation Settings</span>
          </div>
          <button onClick={onClose} className="text-[#555] hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-6">

          {/* Risk Appetite */}
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-widest mb-3">Risk Appetite</div>
            {riskChanged && (
              <div className="bg-[#0d1520] border border-[#1a3a5a] rounded-xl px-3 py-2 flex items-center gap-2 mb-3">
                <Zap size={12} className="text-[#4f8ef7] shrink-0" />
                <span className="text-[#8ab4e8] text-xs">
                  Popi will rebalance your portfolio to match the new risk profile when you save.
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {RISK_OPTIONS.map(r => (
                <button
                  key={r.key}
                  onClick={() => setRisk(r.key)}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                    risk === r.key ? "border-[#4f8ef7] bg-[#0d1a2a]" : "border-[#2a2a2a] bg-[#0d0d0d] hover:border-[#333]"
                  }`}
                >
                  <span className="text-lg">{r.emoji}</span>
                  <div>
                    <div className={`text-xs font-semibold ${risk === r.key ? "text-white" : "text-[#8a8a8a]"}`}>{r.label}</div>
                    <div className="text-[#555] text-[10px]">{r.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Monthly Salary */}
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-widest mb-2">Monthly Salary</div>
            <div className="relative max-w-[200px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">$</span>
              <input
                type="text"
                value={salary}
                onChange={e => setSalary(e.target.value)}
                placeholder="8,000"
                className="w-full bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl pl-7 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#4f8ef7]"
              />
            </div>
          </div>

          {/* Goals */}
          <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl p-4">
            <GoalRows
              goals={goals} units={units} horizons={horizons}
              onUpdate={updateGoal} onRemove={removeGoal} onAdd={addGoal} onHorizon={updateHorizon}
            />
          </div>

          {error && (
            <div className="bg-[#2a0a0a] border border-[#ff5000] rounded-xl px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={13} className="text-[#ff5000] shrink-0 mt-0.5" />
              <span className="text-[#ff5000] text-xs">{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-[#333] text-[#555] text-xs hover:text-[#8a8a8a] hover:border-[#444] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-[#4f8ef7] hover:bg-[#3d7be4] disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-xs transition-colors flex items-center justify-center gap-2"
            >
              {saving ? (
                <><RefreshCw size={12} className="animate-spin" /> {riskChanged ? "Rebalancing…" : "Saving…"}</>
              ) : (
                <><Settings size={12} /> {riskChanged ? "Save & Rebalance" : "Save Settings"}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Proposal card — shown when Popi has proposed trades for user approval ─────
function ProposalCard({
  comment,
  trades,
  noChangeNeeded,
  onApprove,
  onDismiss,
  executing,
}: {
  comment: string;
  trades: ProposedTrade[];
  noChangeNeeded: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  executing: boolean;
}) {
  const totalBuy  = trades.filter(t => t.action === "buy").reduce((s, t) => s + t.amount_usd, 0);
  const totalSell = trades.filter(t => t.action === "sell").reduce((s, t) => s + t.amount_usd, 0);

  return (
    <div className="bg-[#0d1a2a] border border-[#1a4a7a] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1a3a5a] bg-[#0a1520]">
        <span className="text-lg">🤖</span>
        <span className="text-[#4f8ef7] font-semibold text-xs">Popi's Proposal</span>
        <span className="ml-auto text-[#3a5a7a] text-[10px]">Review before executing</span>
      </div>

      {/* Popi's comment */}
      <div className="px-4 py-3 border-b border-[#1a3a5a]">
        <p className="text-[#8ab4e8] text-xs leading-relaxed">{comment}</p>
      </div>

      {/* Proposed trades */}
      {!noChangeNeeded && trades.length > 0 && (
        <div className="px-4 py-3 space-y-2 border-b border-[#1a3a5a]">
          <div className="text-[#3a6a9a] text-[10px] uppercase tracking-widest mb-2">Proposed Trades</div>
          {trades.map((t, i) => (
            <div key={i} className="flex items-start gap-3 bg-[#081018] rounded-xl px-3 py-2.5">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 mt-0.5 ${
                t.action === "buy"
                  ? "bg-[#0a2a0a] text-[#00c805]"
                  : "bg-[#2a0a0a] text-[#ff5000]"
              }`}>
                {t.action.toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-xs font-semibold">{t.symbol}</span>
                  <span className="text-[#4f8ef7] text-xs font-medium">{fmt(t.amount_usd)}</span>
                </div>
                <p className="text-[#4a7a9a] text-[10px] mt-0.5 leading-relaxed">{t.reason}</p>
              </div>
            </div>
          ))}
          {/* Summary line */}
          <div className="flex gap-3 pt-1 text-[10px] text-[#3a5a7a]">
            {totalBuy  > 0 && <span>Buying <span className="text-[#00c805]">{fmt(totalBuy)}</span></span>}
            {totalSell > 0 && <span>Selling <span className="text-[#ff5000]">{fmt(totalSell)}</span></span>}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 px-4 py-3">
        <button
          onClick={onDismiss}
          disabled={executing}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-[#2a3a4a] text-[#4a6a7a] text-xs hover:text-[#8a9aaa] hover:border-[#3a4a5a] transition-colors disabled:opacity-40"
        >
          <XCircle size={12} /> Dismiss
        </button>
        {!noChangeNeeded && trades.length > 0 && (
          <button
            onClick={onApprove}
            disabled={executing}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#4f8ef7] hover:bg-[#3d7be4] text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {executing
              ? <><RefreshCw size={11} className="animate-spin" /> Executing…</>
              : <><CheckCircle size={11} /> Execute Changes</>
            }
          </button>
        )}
      </div>
    </div>
  );
}

// ── Goal progress bar ─────────────────────────────────────────────────────────
function GoalCard({
  goal, totalValue, monthlyContribution, onRemove,
}: {
  goal: { name: string; amount: number; years: number };
  totalValue: number;
  monthlyContribution?: number;
  onRemove?: () => void;
}) {
  const targetTotal = goal.amount;
  // Progress: what fraction of the goal amount is covered by the current portfolio
  const pct         = Math.min((totalValue / targetTotal) * 100, 100);
  const needed      = Math.max(targetTotal - totalValue, 0);
  const monthsLeft  = goal.years * 12;
  const reqMonthly  = needed > 0 && monthsLeft > 0 ? needed / monthsLeft : 0;
  const onTrack     = monthlyContribution ? monthlyContribution >= reqMonthly : pct >= 100;
  const yearsLabel  = goal.years >= 1
    ? `${goal.years % 1 === 0 ? goal.years : goal.years.toFixed(1)} yr`
    : `${Math.round(goal.years * 12)} mo`;

  return (
    <div className="bg-[#0d0d0d] border border-[#1e1e1e] rounded-xl p-3">
      <div className="flex items-start justify-between mb-1.5 gap-1">
        <span className="text-white text-xs font-medium leading-tight">{goal.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
            onTrack ? "bg-[#0a2a0a] text-[#00c805]" : "bg-[#261f00] text-[#f7c44f]"
          }`}>
            {onTrack ? "On Track" : "Needs Contrib."}
          </span>
          {onRemove && (
            <button
              onClick={onRemove}
              className="text-[#2a2a2a] hover:text-[#ff5000] transition-colors"
              title="Remove goal"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-[#555] mb-1.5">
        <span>Target: {fmt(targetTotal)}</span>
        <span>{yearsLabel}</span>
      </div>
      <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden mb-1.5">
        <div
          className="h-1.5 rounded-full bg-gradient-to-r from-[#4f8ef7] to-[#a78bfa] transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[9px] text-[#444]">
        <span>{pct.toFixed(1)}% funded</span>
        {reqMonthly > 0 && <span>~{fmt(reqMonthly)}/mo needed</span>}
      </div>
    </div>
  );
}

// ── Holdings row ──────────────────────────────────────────────────────────────
function HoldingRow({ h, totalValue }: { h: SimHoldingOut; totalValue: number }) {
  const [expanded, setExpanded] = useState(false);
  const alloc = totalValue > 0 ? (h.current_value / totalValue) * 100 : 0;
  const up    = h.gain_loss >= 0;

  return (
    <>
      <tr
        className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="py-3 px-4">
          <div className="text-white font-semibold text-sm">{h.symbol}</div>
          <div className="text-[#555] text-[10px] truncate max-w-[140px]">{h.name}</div>
        </td>
        <td className="py-3 px-4 text-right">
          <div className="text-white text-sm font-semibold">{fmt(h.current_value)}</div>
          <div className="text-[#8a8a8a] text-[10px]">{alloc.toFixed(1)}%</div>
        </td>
        <td className="py-3 px-4 text-right">
          <div className={`text-sm font-semibold ${up ? "text-[#00c805]" : "text-[#ff5000]"}`}>
            {fmtPct(h.gain_loss_pct)}
          </div>
          <div className={`text-[10px] ${up ? "text-[#00c805]" : "text-[#ff5000]"}`}>
            {up ? "+" : ""}{fmtD(h.gain_loss)}
          </div>
        </td>
        <td className="py-3 px-4 text-right hidden md:table-cell">
          <div className="text-white text-sm">{fmtD(h.current_price)}</div>
          <div className="text-[#555] text-[10px]">avg {fmtD(h.avg_cost)}</div>
        </td>
        <td className="py-3 px-4 text-right hidden lg:table-cell">
          <div className="text-[#8a8a8a] text-sm">{h.quantity.toFixed(3)}</div>
        </td>
        <td className="py-3 px-4 text-center">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
            h.asset_class === "etf"
              ? "border-[#1a1a2a] text-[#4488ff]"
              : "border-[#1a2a1a] text-[#00c805]"
          }`}>
            {h.asset_class || "stock"}
          </span>
        </td>
      </tr>
      {expanded && h.rationale && (
        <tr className="bg-[#0d0d0d]">
          <td colSpan={6} className="px-4 py-2">
            <div className="flex items-start gap-2">
              <span className="text-[#4f8ef7] text-xs shrink-0">🤖 Popi:</span>
              <p className="text-[#8a8a8a] text-xs leading-relaxed">{h.rationale}</p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main SimulationTab ─────────────────────────────────────────────────────────
export default function SimulationTab() {
  const [sim,          setSim]          = useState<SimState | null | undefined>(undefined);
  const [trading,      setTrading]      = useState(false);
  const [resetting,    setResetting]    = useState(false);
  const [tradeMsg,     setTradeMsg]     = useState("");
  const [contribAmt,   setContribAmt]   = useState("");
  const [contributing, setContributing] = useState(false);
  const [showLiveModal,  setShowLiveModal]  = useState(false);
  const [showEditPanel,  setShowEditPanel]  = useState(false);

  // Suggestion / proposal state
  const [suggestion,   setSuggestion]   = useState("");
  const [suggesting,   setSuggesting]   = useState(false);
  const [proposal,     setProposal]     = useState<{
    comment: string;
    trades: ProposedTrade[];
    noChangeNeeded: boolean;
  } | null>(null);
  const [executing,    setExecuting]    = useState(false);
  const [suggestError, setSuggestError] = useState("");

  useEffect(() => {
    getSimulation().then(setSim).catch(() => setSim(null));
  }, []);

  async function handleTrade() {
    setTrading(true); setTradeMsg("");
    try {
      const res = await popiTrade();
      if ("error" in res) { setTradeMsg(`⚠️ ${res.error}`); return; }
      setTradeMsg(res.popi_comment || (res.should_rebalance ? "Popi made some trades." : "No rebalancing needed today."));
      setSim(res.state);
    } finally {
      setTrading(false);
    }
  }

  async function handleContribute() {
    const amt = parseFloat(contribAmt.replace(/,/g, ""));
    if (!amt || amt <= 0) return;
    setContributing(true);
    try {
      const res = await contribute(amt);
      if ("error" in res) { alert(res.error); return; }
      if (res.popi_comment) setTradeMsg(res.popi_comment);
      setSim(res.state);
      setContribAmt("");
    } finally {
      setContributing(false);
    }
  }

  async function handleReset() {
    if (!confirm("Reset the entire simulation? This cannot be undone.")) return;
    setResetting(true);
    await resetSimulation();
    setSim(null);
    setResetting(false);
    setTradeMsg("");
  }

  function handleSettingsUpdated(state: SimState, msg: string) {
    setSim(state);
    if (msg) setTradeMsg(msg);
  }

  // ── Goal management helpers ────────────────────────────────────────────────
  const [showAddGoal,  setShowAddGoal]  = useState(false);
  const [newGoalName,  setNewGoalName]  = useState("");
  const [newGoalAmt,   setNewGoalAmt]   = useState("");
  const [newGoalYears, setNewGoalYears] = useState("5");
  const [newGoalUnit,  setNewGoalUnit]  = useState<TimeUnit>("years");
  const [savingGoal,   setSavingGoal]   = useState(false);

  async function handleAddGoal() {
    if (!sim) return;
    const name = newGoalName.trim();
    const amt  = parseFloat(newGoalAmt.replace(/,/g, ""));
    const raw  = parseFloat(newGoalYears) || 1;
    if (!name || !amt) return;
    const years = newGoalUnit === "months" ? raw / 12 : raw;
    setSavingGoal(true);
    try {
      const existing = sim.goals.map(g => ({
        name: g.name, amount: g.amount, years: g.years, priority: g.priority,
      }));
      const res = await updateSimSettings({
        goals: [...existing, { name, amount: amt, years, priority: existing.length + 1 }],
      });
      if ("error" in res) return;
      setSim(res.state);
      setNewGoalName(""); setNewGoalAmt(""); setNewGoalYears("5"); setNewGoalUnit("years");
      setShowAddGoal(false);
    } finally {
      setSavingGoal(false);
    }
  }

  async function handleRemoveGoal(goalId: number) {
    if (!sim) return;
    const remaining = sim.goals
      .filter(g => g.id !== goalId)
      .map((g, i) => ({ name: g.name, amount: g.amount, years: g.years, priority: i + 1 }));
    const res = await updateSimSettings({ goals: remaining });
    if (!("error" in res)) setSim(res.state);
  }

  async function handleSuggest() {
    const msg = suggestion.trim();
    if (!msg) return;
    setSuggesting(true); setSuggestError(""); setProposal(null);
    try {
      const res = await suggestChanges(msg);
      if ("error" in res) { setSuggestError(res.error); return; }
      setProposal({
        comment:        res.popi_comment,
        trades:         res.proposed_trades,
        noChangeNeeded: res.no_change_needed,
      });
      setSuggestion("");
    } catch (e: any) {
      setSuggestError(e?.response?.data?.detail || "Something went wrong");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleApproveProposal() {
    if (!proposal || proposal.trades.length === 0) return;
    setExecuting(true);
    try {
      const res = await executeProposedTrades(proposal.trades);
      if ("error" in res) { setSuggestError(res.error); return; }
      setSim(res.state);
      setTradeMsg("Changes executed per your direction. Popi has updated the portfolio.");
      setProposal(null);
    } catch (e: any) {
      setSuggestError(e?.response?.data?.detail || "Something went wrong");
    } finally {
      setExecuting(false);
    }
  }

  const plan = useMemo(() => sim?.plan || null, [sim]);

  // Loading
  if (sim === undefined) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-[#555] text-sm">Loading Popi Sim…</div>
      </div>
    );
  }

  // No simulation yet → Setup Wizard
  if (!sim) {
    return <SetupWizard onCreated={setSim} />;
  }

  // ── Active Simulation Dashboard ─────────────────────────────────────────────
  const up          = sim.gain_loss >= 0;
  const totalDeployed = sim.principal + sim.total_contributed;
  const allocPct    = sim.total_value > 0
    ? (sim.total_invested / sim.total_value) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">

      {/* ── Top banner ── */}
      <div className="bg-[#141414] border-b border-[#2a2a2a] px-6 py-5">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🤖</span>
              <div>
                <div className="text-[#8a8a8a] text-[10px] uppercase tracking-widest">Popi Sim Lab</div>
                <div className="text-white font-semibold text-sm">Managed since {new Date(sim.created_at).toLocaleDateString()}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowEditPanel(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2a2a2a] text-[#8a8a8a] text-xs font-medium hover:border-[#4f8ef7] hover:text-[#4f8ef7] transition-colors"
              >
                <Settings size={12} /> Edit Settings
              </button>
              <button
                onClick={() => setShowLiveModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#4f8ef7] text-[#4f8ef7] text-xs font-medium hover:bg-[#0d1a2a] transition-colors"
              >
                <Rocket size={12} /> Make This Live
              </button>
              <button
                onClick={handleReset}
                disabled={resetting}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#333] text-[#555] text-xs hover:text-[#8a8a8a] hover:border-[#444] transition-colors"
              >
                <RotateCcw size={11} className={resetting ? "animate-spin" : ""} />
                Reset
              </button>
            </div>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-5">
            <div>
              <div className="text-[#555] text-xs mb-0.5">Portfolio Value</div>
              <div className="text-white text-2xl font-bold">{fmt(sim.total_value)}</div>
            </div>
            <div>
              <div className="text-[#555] text-xs mb-0.5">Total Return</div>
              <div className={`text-xl font-bold ${up ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                {up ? "+" : ""}{fmtD(sim.gain_loss)}
              </div>
              <div className={`text-xs ${up ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                {fmtPct(sim.gain_loss_pct)}
              </div>
            </div>
            <div>
              <div className="text-[#555] text-xs mb-0.5">vs S&P 500</div>
              {sim.bench_return_pct != null ? (
                <div className={`text-xl font-bold ${sim.gain_loss_pct >= sim.bench_return_pct ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                  {sim.gain_loss_pct >= sim.bench_return_pct ? "+" : ""}
                  {(sim.gain_loss_pct - sim.bench_return_pct).toFixed(2)}%
                  <span className="text-xs text-[#555] ml-1">alpha</span>
                </div>
              ) : (
                <div className="text-[#555] text-xl">—</div>
              )}
            </div>
            <div>
              <div className="text-[#555] text-xs mb-0.5">Cash Available</div>
              <div className="text-[#f7c44f] text-xl font-bold">{fmt(sim.cash_balance)}</div>
              <div className="text-[#555] text-xs">{(sim.total_value > 0 ? sim.cash_balance / sim.total_value * 100 : 0).toFixed(1)}% of portfolio</div>
            </div>
            <div>
              <div className="text-[#555] text-xs mb-0.5">Deployed</div>
              <div className="text-white text-xl font-bold">{allocPct.toFixed(0)}%</div>
              <div className="text-[#555] text-xs">{fmt(sim.total_invested)} invested</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <div className="flex gap-5 items-start">

          {/* ── Left sidebar ── */}
          <div className="w-[280px] shrink-0 space-y-4">

            {/* Popi's message */}
            {plan?.popi_message && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🤖</span>
                  <span className="text-white text-xs font-semibold">Popi's Note</span>
                </div>
                <p className="text-[#8a8a8a] text-xs leading-relaxed">{plan.popi_message}</p>
              </div>
            )}

            {/* Strategy */}
            {plan?.strategy_summary && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
                <div className="text-[#555] text-[10px] uppercase tracking-widest mb-2">Strategy</div>
                <p className="text-[#8a8a8a] text-xs leading-relaxed">{plan.strategy_summary}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#1a1a2a] text-[#4488ff] border border-[#1a1a2a]">
                    {sim.risk_appetite.replace("_", " ")}
                  </span>
                  {plan.rebalance_frequency && (
                    <span className="text-[9px] px-2 py-0.5 rounded-full bg-[#1a2a1a] text-[#00c805] border border-[#1a2a1a]">
                      {plan.rebalance_frequency} rebalancing
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Monthly contribution recommendation */}
            {plan?.monthly_contribution_needed > 0 && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
                <div className="text-[#555] text-[10px] uppercase tracking-widest mb-2">Suggested Monthly Add</div>
                <div className="text-[#f7c44f] text-2xl font-bold">
                  {fmt(plan.monthly_contribution_needed)}<span className="text-xs text-[#555] ml-1">/mo</span>
                </div>
                <p className="text-[#444] text-[10px] mt-1">To stay on track with all goals</p>
              </div>
            )}

            {/* Goals — always shown, always editable */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[#555] text-[10px] uppercase tracking-widest">Goals</div>
                <button
                  onClick={() => setShowAddGoal(v => !v)}
                  className="flex items-center gap-1 text-[#4f8ef7] text-[10px] hover:text-[#7ab0ff] transition-colors"
                >
                  <Plus size={11} /> Add Goal
                </button>
              </div>

              {/* Goal cards */}
              {sim.goals.length > 0 ? (
                <div className="space-y-3">
                  {sim.goals.map(g => (
                    <GoalCard
                      key={g.id}
                      goal={g}
                      totalValue={sim.total_value}
                      monthlyContribution={plan?.monthly_contribution_needed}
                      onRemove={() => handleRemoveGoal(g.id)}
                    />
                  ))}
                </div>
              ) : !showAddGoal && (
                <div
                  className="text-center py-4 cursor-pointer group"
                  onClick={() => setShowAddGoal(true)}
                >
                  <div className="text-[#333] text-xs mb-1">No goals set</div>
                  <div className="text-[#4f8ef7] text-[10px] group-hover:text-[#7ab0ff] transition-colors">
                    + Add your first goal
                  </div>
                </div>
              )}

              {/* Inline add-goal form */}
              {showAddGoal && (
                <div className="mt-3 pt-3 border-t border-[#1e1e1e] space-y-2">
                  <div className="text-[#555] text-[10px] mb-1">New Goal</div>
                  <input
                    value={newGoalName}
                    onChange={e => setNewGoalName(e.target.value)}
                    placeholder="e.g. Down payment, Emergency fund"
                    className="w-full bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none focus:border-[#4f8ef7]"
                  />
                  <div className="flex gap-2">
                    {/* Amount */}
                    <div className="relative flex-1">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#555] text-xs">$</span>
                      <input
                        type="number"
                        value={newGoalAmt}
                        onChange={e => setNewGoalAmt(e.target.value)}
                        placeholder="50,000"
                        className="w-full bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg pl-4 pr-2 py-2 text-white text-xs focus:outline-none focus:border-[#4f8ef7]"
                      />
                    </div>
                    {/* Time horizon */}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={newGoalYears}
                        min="1"
                        onChange={e => setNewGoalYears(e.target.value)}
                        className="w-12 bg-[#0d0d0d] border border-[#2a2a2a] rounded-lg px-1 py-2 text-white text-xs text-center focus:outline-none focus:border-[#4f8ef7]"
                      />
                      <div className="flex rounded-lg overflow-hidden border border-[#2a2a2a]">
                        {(["yrs", "mos"] as const).map(u => (
                          <button
                            key={u}
                            type="button"
                            onClick={() => setNewGoalUnit(u === "yrs" ? "years" : "months")}
                            className={`px-1.5 py-1.5 text-[10px] font-medium transition-colors ${
                              (u === "yrs" ? "years" : "months") === newGoalUnit
                                ? "bg-[#4f8ef7] text-white"
                                : "bg-[#0d0d0d] text-[#555] hover:text-[#8a8a8a]"
                            }`}
                          >{u}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => { setShowAddGoal(false); setNewGoalName(""); setNewGoalAmt(""); }}
                      className="flex-1 py-1.5 rounded-lg border border-[#2a2a2a] text-[#555] text-[10px] hover:text-[#8a8a8a] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddGoal}
                      disabled={savingGoal || !newGoalName.trim() || !newGoalAmt}
                      className="flex-1 py-1.5 rounded-lg bg-[#4f8ef7] hover:bg-[#3d7be4] disabled:opacity-40 text-white text-[10px] font-semibold transition-colors flex items-center justify-center gap-1"
                    >
                      {savingGoal ? <RefreshCw size={10} className="animate-spin" /> : <Plus size={10} />}
                      Save Goal
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Projections */}
            {(plan?.projected_value_3yr || plan?.projected_value_5yr) && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
                <div className="text-[#555] text-[10px] uppercase tracking-widest mb-3">Popi's Projections</div>
                <div className="space-y-2">
                  {plan.projected_value_3yr && (
                    <div className="flex justify-between items-center">
                      <span className="text-[#555] text-xs">3 years</span>
                      <span className="text-white text-xs font-semibold">{fmt(plan.projected_value_3yr)}</span>
                    </div>
                  )}
                  {plan.projected_value_5yr && (
                    <div className="flex justify-between items-center">
                      <span className="text-[#555] text-xs">5 years</span>
                      <span className="text-white text-xs font-semibold">{fmt(plan.projected_value_5yr)}</span>
                    </div>
                  )}
                  {plan.projected_value_10yr && (
                    <div className="flex justify-between items-center">
                      <span className="text-[#555] text-xs">10 years</span>
                      <span className="text-white text-xs font-semibold">{fmt(plan.projected_value_10yr)}</span>
                    </div>
                  )}
                </div>
                <p className="text-[#333] text-[9px] mt-2">Based on Popi's allocation + monthly contributions</p>
              </div>
            )}

          </div>

          {/* ── Center: Holdings ── */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* Popi's trade comment */}
            {tradeMsg && (
              <div className="bg-[#0d1520] border border-[#1a3a5a] rounded-xl px-4 py-3 flex items-start gap-3">
                <span className="text-lg shrink-0">🤖</span>
                <p className="text-[#8ab4e8] text-xs leading-relaxed">{tradeMsg}</p>
              </div>
            )}

            {/* Holdings table */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1e1e1e] flex items-center justify-between">
                <div>
                  <div className="text-white font-semibold text-sm">Popi's Portfolio</div>
                  <div className="text-[#555] text-xs">{sim.holdings.length} positions · click any row for Popi's rationale</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#555] text-xs">
                    {fmt(sim.total_invested)} invested · {fmt(sim.cash_balance)} cash
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#1a1a1a]">
                      <th className="text-left px-4 py-2 text-[#555] text-[10px] font-medium">Symbol</th>
                      <th className="text-right px-4 py-2 text-[#555] text-[10px] font-medium">Value</th>
                      <th className="text-right px-4 py-2 text-[#555] text-[10px] font-medium">P&L</th>
                      <th className="text-right px-4 py-2 text-[#555] text-[10px] font-medium hidden md:table-cell">Price</th>
                      <th className="text-right px-4 py-2 text-[#555] text-[10px] font-medium hidden lg:table-cell">Shares</th>
                      <th className="text-center px-4 py-2 text-[#555] text-[10px] font-medium">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sim.holdings
                      .slice()
                      .sort((a, b) => b.current_value - a.current_value)
                      .map(h => (
                        <HoldingRow key={h.symbol} h={h} totalValue={sim.total_value} />
                      ))}
                    {/* Cash row */}
                    <tr className="border-b border-[#1a1a1a]">
                      <td className="py-3 px-4">
                        <div className="text-[#f7c44f] font-semibold text-sm">CASH</div>
                        <div className="text-[#555] text-[10px]">Available</div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="text-[#f7c44f] text-sm font-semibold">{fmt(sim.cash_balance)}</div>
                        <div className="text-[#555] text-[10px]">
                          {(sim.total_value > 0 ? sim.cash_balance / sim.total_value * 100 : 0).toFixed(1)}%
                        </div>
                      </td>
                      <td colSpan={4} />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Goal analysis from plan */}
            {plan?.goal_analysis?.length > 0 && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-5">
                <div className="text-[#555] text-[10px] uppercase tracking-widest mb-4">Popi's Goal Analysis</div>
                <div className="space-y-3">
                  {plan.goal_analysis.map((g: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-[#0d0d0d] rounded-xl border border-[#1e1e1e]">
                      <span className={`text-sm shrink-0 mt-0.5 ${
                        g.feasibility === "achievable" ? "text-[#00c805]" :
                        g.feasibility === "challenging" ? "text-[#f7c44f]" : "text-[#ff5000]"
                      }`}>
                        {g.feasibility === "achievable" ? "✓" : g.feasibility === "challenging" ? "⚠" : "✗"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-white text-xs font-medium">{g.goal_name}</span>
                          <span className="text-[#555] text-[10px]">{fmt(g.amount || 0)} · {g.years || 0}yr</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                            g.feasibility === "achievable" ? "bg-[#0a2a0a] text-[#00c805]" :
                            g.feasibility === "challenging" ? "bg-[#261f00] text-[#f7c44f]" :
                            "bg-[#2a0a0a] text-[#ff5000]"
                          }`}>
                            {g.feasibility}
                          </span>
                        </div>
                        <p className="text-[#666] text-[10px] leading-relaxed">{g.note}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Suggest Changes to Popi ── */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1e1e1e] flex items-center gap-2">
                <MessageSquare size={13} className="text-[#a78bfa]" />
                <div>
                  <div className="text-white font-semibold text-sm">Suggest a Change</div>
                  <div className="text-[#555] text-xs">Tell Popi what you'd like to adjust — Popi proposes, you approve</div>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {/* Prompt chips */}
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Add more tech exposure",
                    "Reduce bond allocation",
                    "I want more dividend stocks",
                    "Too concentrated — diversify",
                    "Reduce risk a little",
                    "Deploy the cash",
                  ].map(chip => (
                    <button
                      key={chip}
                      onClick={() => setSuggestion(chip)}
                      className="text-[10px] px-2.5 py-1 rounded-full border border-[#2a2a2a] text-[#555] hover:border-[#a78bfa] hover:text-[#a78bfa] transition-colors"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                {/* Input row */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={suggestion}
                    onChange={e => setSuggestion(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !suggesting && handleSuggest()}
                    placeholder="e.g. I want more exposure to AI stocks"
                    className="flex-1 bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl px-3 py-2.5 text-white text-xs placeholder-[#333] focus:outline-none focus:border-[#a78bfa]"
                  />
                  <button
                    onClick={handleSuggest}
                    disabled={suggesting || !suggestion.trim()}
                    className="px-3 py-2.5 rounded-xl bg-[#a78bfa] hover:bg-[#9370f0] disabled:opacity-40 text-white transition-colors shrink-0"
                  >
                    {suggesting
                      ? <RefreshCw size={13} className="animate-spin" />
                      : <Send size={13} />
                    }
                  </button>
                </div>
                {suggestError && (
                  <div className="flex items-start gap-2 bg-[#2a0a0a] border border-[#ff5000] rounded-xl px-3 py-2">
                    <AlertTriangle size={12} className="text-[#ff5000] shrink-0 mt-0.5" />
                    <span className="text-[#ff5000] text-xs">{suggestError}</span>
                  </div>
                )}
              </div>
              {/* Proposal card — appears inline below the input once Popi responds */}
              {proposal && (
                <div className="px-4 pb-4">
                  <ProposalCard
                    comment={proposal.comment}
                    trades={proposal.trades}
                    noChangeNeeded={proposal.noChangeNeeded}
                    onApprove={handleApproveProposal}
                    onDismiss={() => { setProposal(null); setSuggestError(""); }}
                    executing={executing}
                  />
                </div>
              )}
            </div>

            {/* Trade log */}
            {sim.trades.length > 0 && (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1e1e1e]">
                  <div className="text-white font-semibold text-sm">Trade Log</div>
                  <div className="text-[#555] text-xs">All virtual trades executed by Popi</div>
                </div>
                <div className="divide-y divide-[#1a1a1a]">
                  {sim.trades.slice(0, 20).map((t, i) => {
                    const ts = TRADE_STYLE[t.action] ?? TRADE_STYLE.buy;
                    return (
                      <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${ts.bg} ${ts.text} shrink-0`}>
                          {t.action.toUpperCase()}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-xs font-semibold">{t.symbol}</span>
                            <span className="text-[#8a8a8a] text-xs">{t.quantity.toFixed(3)} @ {fmtD(t.price)}</span>
                            <span className="text-white text-xs font-medium">{fmt(t.amount)}</span>
                          </div>
                          {t.reason && (
                            <div className="text-[#444] text-[10px] truncate">{t.reason}</div>
                          )}
                        </div>
                        <span className="text-[#333] text-[10px] shrink-0">
                          {new Date(t.executed_at).toLocaleDateString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Right sidebar: actions ── */}
          <div className="w-[240px] shrink-0 sticky top-6 space-y-4">

            {/* Let Popi Trade */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
              <div className="text-[#555] text-[10px] uppercase tracking-widest mb-3">Popi Action</div>
              <button
                onClick={handleTrade}
                disabled={trading}
                className="w-full bg-[#4f8ef7] hover:bg-[#3d7be4] disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-xs transition-colors flex items-center justify-center gap-2"
              >
                {trading ? (
                  <><RefreshCw size={12} className="animate-spin" /> Thinking…</>
                ) : (
                  <><Zap size={12} /> Let Popi Trade</>
                )}
              </button>
              <p className="text-[#333] text-[10px] mt-2 text-center">
                Popi reviews & rebalances the portfolio
              </p>
            </div>

            {/* Add Contribution */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
              <div className="text-[#555] text-[10px] uppercase tracking-widest mb-3">Add Contribution</div>
              <div className="relative mb-2">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] text-sm">$</span>
                <input
                  type="text"
                  value={contribAmt}
                  onChange={e => setContribAmt(e.target.value)}
                  placeholder="1,000"
                  className="w-full bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl pl-7 pr-3 py-2 text-white text-sm focus:outline-none focus:border-[#4f8ef7]"
                />
              </div>
              <button
                onClick={handleContribute}
                disabled={contributing || !contribAmt}
                className="w-full bg-[#0a2a0a] border border-[#00c805] text-[#00c805] hover:bg-[#0d3a0d] disabled:opacity-50 font-semibold py-2 rounded-xl text-xs transition-colors flex items-center justify-center gap-2"
              >
                {contributing ? (
                  <><RefreshCw size={11} className="animate-spin" /> Deploying…</>
                ) : (
                  <><TrendingUp size={11} /> Add & Deploy</>
                )}
              </button>
            </div>

            {/* Edit Settings */}
            <button
              onClick={() => setShowEditPanel(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-[#2a2a2a] text-[#8a8a8a] text-xs font-medium hover:border-[#4f8ef7] hover:text-[#4f8ef7] transition-colors"
            >
              <Settings size={12} />
              Edit Settings
            </button>

            {/* Portfolio stats */}
            <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
              <div className="text-[#555] text-[10px] uppercase tracking-widest mb-3">Stats</div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#555]">Started with</span>
                  <span className="text-white font-medium">{fmt(sim.principal)}</span>
                </div>
                {sim.total_contributed > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#555]">Added</span>
                    <span className="text-white font-medium">{fmt(sim.total_contributed)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#555]">Total in</span>
                  <span className="text-white font-medium">{fmt(totalDeployed)}</span>
                </div>
                <div className="h-px bg-[#1e1e1e] my-1" />
                <div className="flex justify-between">
                  <span className="text-[#555]">Positions</span>
                  <span className="text-white font-medium">{sim.holdings.length}</span>
                </div>
                {sim.last_traded && (
                  <div className="flex justify-between">
                    <span className="text-[#555]">Last trade</span>
                    <span className="text-[#8a8a8a]">{new Date(sim.last_traded).toLocaleDateString()}</span>
                  </div>
                )}
                {plan?.key_risks && (
                  <>
                    <div className="h-px bg-[#1e1e1e] my-1" />
                    <div>
                      <div className="text-[#555] text-[10px] mb-1">Key Risk</div>
                      <p className="text-[#444] text-[10px] leading-relaxed">{plan.key_risks}</p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Make it live */}
            <button
              onClick={() => setShowLiveModal(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-[#4f8ef7] text-[#4f8ef7] text-xs font-medium hover:bg-[#0d1a2a] transition-colors"
            >
              <Rocket size={12} />
              Make This Live →
            </button>

          </div>
        </div>
      </div>

      {/* ── Edit Settings Modal ── */}
      {showEditPanel && sim && (
        <EditSettingsPanel
          sim={sim}
          onClose={() => setShowEditPanel(false)}
          onUpdated={handleSettingsUpdated}
        />
      )}

      {/* ── "Make it Live" modal ── */}
      {showLiveModal && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4"
          onClick={() => setShowLiveModal(false)}
        >
          <div
            className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-8 max-w-md w-full text-center"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-5xl mb-4">🚀</div>
            <h2 className="text-white font-bold text-xl mb-2">Coming Soon</h2>
            <p className="text-[#8a8a8a] text-sm leading-relaxed mb-6">
              Ready to go live? We're building the ability to turn this simulation into a
              <strong className="text-white"> fully managed Popi account</strong> — where Popi
              executes real trades on your behalf through a connected brokerage.
            </p>
            <div className="bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl p-4 mb-6 text-left space-y-2">
              <div className="flex items-center gap-2 text-xs text-[#8a8a8a]">
                <span className="text-[#00c805]">✓</span> Connect brokerage (Alpaca, IBKR, Schwab)
              </div>
              <div className="flex items-center gap-2 text-xs text-[#8a8a8a]">
                <span className="text-[#00c805]">✓</span> Popi executes trades within your risk limits
              </div>
              <div className="flex items-center gap-2 text-xs text-[#8a8a8a]">
                <span className="text-[#00c805]">✓</span> You stay in control — approve or override any trade
              </div>
              <div className="flex items-center gap-2 text-xs text-[#8a8a8a]">
                <span className="text-[#00c805]">✓</span> Full audit trail and performance reporting
              </div>
            </div>
            <button
              onClick={() => setShowLiveModal(false)}
              className="w-full bg-[#4f8ef7] hover:bg-[#3d7be4] text-white font-semibold py-3 rounded-xl text-sm transition-colors"
            >
              Got it — I'll wait for launch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
