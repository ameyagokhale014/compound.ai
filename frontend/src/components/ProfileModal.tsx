import { useState, useEffect } from "react";
import { User, X, Eye, EyeOff, LogOut, Check } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import type { InvestingGoal } from "../api";

export function getStoredApiKey(): string {
  return localStorage.getItem("anthropic_api_key") || "";
}

const GOAL_OPTIONS = [
  { id: "preservation", label: "Capital preservation" },
  { id: "income",       label: "Dividend income" },
  { id: "growth",       label: "Steady growth" },
  { id: "hyper_growth", label: "Hyper growth" },
  { id: "value",        label: "Value investing" },
  { id: "retirement",   label: "Retirement planning" },
  { id: "speculation",  label: "Speculation" },
];

const SECTORS = [
  "Fossil Fuels", "Tobacco", "Alcohol", "Gambling", "Defense / Weapons",
  "Cannabis", "Adult Content", "Animal Testing", "Pharmaceuticals", "Social Media",
];

export default function ProfileModal() {
  const { user, logout, updateUser } = useAuth();
  const [open, setOpen]       = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [tab, setTab]         = useState<"profile" | "investing" | "ai">("profile");

  // Form state — synced from user on open
  const [firstName, setFirstName]           = useState("");
  const [lastName, setLastName]             = useState("");
  const [dob, setDob]                       = useState("");
  const [country, setCountry]               = useState("");
  const [companyName, setCompanyName]       = useState("");
  const [employerSector, setEmployerSector] = useState("");
  const [annualIncome, setAnnualIncome]     = useState("");
  const [monthlyInvest, setMonthlyInvest]   = useState("");
  const [netWorth, setNetWorth]             = useState("");
  const [retirementAge, setRetirementAge]   = useState("");
  const [hasDependents, setHasDependents]   = useState<boolean | null>(null);
  const [riskTolerance, setRiskTolerance]   = useState(3);
  const [experienceLevel, setExperience]    = useState("");
  const [timeHorizon, setTimeHorizon]       = useState("");
  const [selectedGoals, setSelectedGoals]   = useState<string[]>([]);
  const [goalWeights, setGoalWeights]       = useState<Record<string, number>>({});
  const [sectorsToAvoid, setSectors]        = useState<string[]>([]);
  const [apiKey, setApiKey]                 = useState("");

  useEffect(() => {
    if (!open || !user) return;
    setFirstName(user.first_name ?? "");
    setLastName(user.last_name ?? "");
    setDob(user.date_of_birth ?? "");
    setCountry(user.country ?? "");
    setCompanyName(user.company_name ?? "");
    setEmployerSector(user.employer_sector ?? "");
    setAnnualIncome(user.annual_income != null ? String(user.annual_income) : "");
    setMonthlyInvest(user.monthly_investable != null ? String(user.monthly_investable) : "");
    setNetWorth(user.net_worth_outside != null ? String(user.net_worth_outside) : "");
    setRetirementAge(user.retirement_target_age != null ? String(user.retirement_target_age) : "");
    setHasDependents(user.has_dependents ?? null);
    setRiskTolerance(user.risk_tolerance ?? 3);
    setExperience(user.experience_level ?? "");
    setTimeHorizon(user.time_horizon ?? "");
    const goals = user.investing_goals ?? [];
    setSelectedGoals(goals.map((g) => g.id));
    const wMap: Record<string, number> = {};
    goals.forEach((g) => { wMap[g.id] = g.weight; });
    setGoalWeights(wMap);
    setSectors(user.sectors_to_avoid ?? []);
    setApiKey(user.anthropic_api_key ?? "");
    setSaved(false);
  }, [open, user]);

  function toggleGoal(id: string) {
    setSelectedGoals((prev) => {
      const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
      const even = next.length > 0 ? Math.floor(100 / next.length) : 0;
      const newW: Record<string, number> = {};
      next.forEach((g, i) => { newW[g] = i === 0 ? 100 - even * (next.length - 1) : even; });
      setGoalWeights(newW);
      return next;
    });
  }

  function toggleSector(s: string) {
    setSectors((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function handleSave() {
    setSaving(true);
    const goals: InvestingGoal[] = selectedGoals.map((id) => ({
      id,
      label: GOAL_OPTIONS.find((g) => g.id === id)?.label ?? id,
      weight: goalWeights[id] ?? 0,
    }));
    await updateUser({
      first_name:            firstName.trim() || undefined,
      last_name:             lastName.trim() || undefined,
      date_of_birth:         dob || undefined,
      country:               country.trim() || undefined,
      company_name:          companyName.trim() || undefined,
      employer_sector:       employerSector.trim() || undefined,
      annual_income:         annualIncome ? parseFloat(annualIncome) : undefined,
      monthly_investable:    monthlyInvest ? parseFloat(monthlyInvest) : undefined,
      net_worth_outside:     netWorth ? parseFloat(netWorth) : undefined,
      retirement_target_age: retirementAge ? parseInt(retirementAge) : undefined,
      has_dependents:        hasDependents ?? undefined,
      risk_tolerance:        riskTolerance,
      experience_level:      experienceLevel || undefined,
      time_horizon:          timeHorizon || undefined,
      investing_goals:       goals.length > 0 ? goals : undefined,
      sectors_to_avoid:      sectorsToAvoid.length > 0 ? sectorsToAvoid : undefined,
      anthropic_api_key:     apiKey.trim() || undefined,
    }).catch(() => {});
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!user) return null;

  const hasKey = !!user.anthropic_api_key || !!getStoredApiKey();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex items-center justify-center w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] hover:border-[#444] transition-colors"
      >
        <User size={14} className="text-[#8a8a8a]" />
        {hasKey && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#00c805] border border-[#0a0a0a]" />
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="relative bg-[#111] border border-[#1e1e1e] rounded-2xl w-[480px] max-h-[85vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e1e1e]">
              <div>
                <p className="text-white font-semibold text-sm">{user.first_name} {user.last_name}</p>
                <p className="text-[#555] text-xs">{user.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { logout(); setOpen(false); }}
                  className="flex items-center gap-1.5 text-[#555] hover:text-red-400 text-xs transition-colors px-2 py-1"
                >
                  <LogOut size={13} />Sign out
                </button>
                <button onClick={() => setOpen(false)} className="text-[#444] hover:text-white transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-0.5 px-6 pt-3">
              {(["profile", "investing", "ai"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    tab === t ? "bg-[#1e1e1e] text-white" : "text-[#555] hover:text-[#8a8a8a]"
                  }`}
                >
                  {t === "profile" ? "Profile" : t === "investing" ? "Investing" : "AI Setup"}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {tab === "profile" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="First name" value={firstName} onChange={setFirstName} />
                    <Field label="Last name"  value={lastName}  onChange={setLastName} />
                  </div>
                  <Field label="Date of birth" value={dob} onChange={setDob} type="date" />
                  <Field label="Country" value={country} onChange={setCountry} placeholder="e.g. United States" />
                  <Field label="Employer / company" value={companyName} onChange={setCompanyName} placeholder="e.g. Google" />
                  <Field label="Employer sector" value={employerSector} onChange={setEmployerSector} placeholder="e.g. Technology" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Annual income (USD)" value={annualIncome} onChange={setAnnualIncome} type="number" placeholder="150000" />
                    <Field label="Monthly investable (USD)" value={monthlyInvest} onChange={setMonthlyInvest} type="number" placeholder="2000" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Net worth outside portfolio" value={netWorth} onChange={setNetWorth} type="number" placeholder="50000" />
                    <Field label="Target retirement age" value={retirementAge} onChange={setRetirementAge} type="number" placeholder="55" />
                  </div>
                  <div>
                    <label className="text-[#555] text-xs block mb-2">Financial dependents</label>
                    <div className="flex gap-2">
                      {([true, false] as const).map((v) => (
                        <button key={String(v)} onClick={() => setHasDependents(v)}
                          className={`flex-1 py-1.5 rounded-lg border text-sm transition-colors ${
                            hasDependents === v ? "border-[#4f8ef7] bg-[#4f8ef7]/10 text-white" : "border-[#2a2a2a] text-[#555]"
                          }`}
                        >{v ? "Yes" : "No"}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {tab === "investing" && (
                <>
                  <div>
                    <label className="text-[#555] text-xs block mb-2">Experience level</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: "beginner", label: "Beginner", sub: "< 1 year" },
                        { id: "2-5y",     label: "Intermediate", sub: "2–5 years" },
                        { id: "5-10y",    label: "Experienced", sub: "5–10 years" },
                        { id: "10+y",     label: "Expert", sub: "10+ years" },
                      ].map((e) => (
                        <button key={e.id} onClick={() => setExperience(e.id)}
                          className={`p-2.5 rounded-xl border text-left transition-colors ${
                            experienceLevel === e.id ? "border-[#4f8ef7] bg-[#4f8ef7]/10" : "border-[#2a2a2a] hover:border-[#3a3a3a]"
                          }`}
                        >
                          <p className="text-white text-sm">{e.label}</p>
                          <p className="text-[#555] text-xs">{e.sub}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[#555] text-xs block mb-2">Time horizon</label>
                    <div className="flex flex-wrap gap-2">
                      {["<1y","1-3y","3-7y","7-15y","15+y"].map((h) => (
                        <button key={h} onClick={() => setTimeHorizon(h)}
                          className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                            timeHorizon === h ? "border-[#4f8ef7] bg-[#4f8ef7]/10 text-white" : "border-[#2a2a2a] text-[#555]"
                          }`}
                        >{h}</button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[#555] text-xs block mb-2">
                      Risk tolerance — <span className="text-white">{["","Very conservative","Conservative","Moderate","Aggressive","Very aggressive"][riskTolerance]}</span>
                    </label>
                    <input type="range" min={1} max={5} value={riskTolerance}
                      onChange={(e) => setRiskTolerance(parseInt(e.target.value))}
                      className="w-full accent-[#4f8ef7]"
                    />
                  </div>

                  <div>
                    <label className="text-[#555] text-xs block mb-2">Investing goals</label>
                    <div className="space-y-2">
                      {GOAL_OPTIONS.map((g) => {
                        const active = selectedGoals.includes(g.id);
                        return (
                          <div key={g.id} onClick={() => toggleGoal(g.id)}
                            className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-colors ${
                              active ? "border-[#4f8ef7] bg-[#4f8ef7]/10" : "border-[#2a2a2a] hover:border-[#3a3a3a]"
                            }`}
                          >
                            <p className="text-white text-sm">{g.label}</p>
                            {active && (
                              <input type="number" min={0} max={100} value={goalWeights[g.id] ?? 0}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setGoalWeights((prev) => ({ ...prev, [g.id]: parseInt(e.target.value) || 0 }))}
                                className="w-14 bg-[#0a0a0a] border border-[#333] rounded-lg px-2 py-0.5 text-white text-sm text-center outline-none"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {selectedGoals.length > 0 && (
                      <p className={`text-xs mt-2 ${
                        Object.values(goalWeights).reduce((s,v)=>s+v,0) === 100 ? "text-green-400" : "text-amber-400"
                      }`}>
                        Total: {Object.values(goalWeights).reduce((s,v)=>s+v,0)}%
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-[#555] text-xs block mb-2">Sectors to avoid</label>
                    <div className="flex flex-wrap gap-1.5">
                      {SECTORS.map((s) => (
                        <button key={s} onClick={() => toggleSector(s)}
                          className={`px-2.5 py-1 rounded-lg border text-xs transition-colors ${
                            sectorsToAvoid.includes(s)
                              ? "border-red-500/50 bg-red-500/10 text-red-400"
                              : "border-[#2a2a2a] text-[#555] hover:border-[#3a3a3a]"
                          }`}
                        >{s}</button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {tab === "ai" && (
                <div className="space-y-3">
                  <label className="text-[#555] text-xs block">Anthropic API key</label>
                  <p className="text-[#333] text-xs leading-relaxed">
                    Required for AI Buy Analysis, Advisor, Popi Sim, and Earnings Intelligence.
                    Stored in your account — synced across sessions.
                  </p>
                  <div className="relative">
                    <input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-ant-api03-..."
                      className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 pr-9 py-2.5 text-white text-sm font-mono outline-none focus:border-[#444] placeholder:font-sans placeholder:text-[#333]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#444] hover:text-[#8a8a8a]"
                    >
                      {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[#1e1e1e] flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-white text-black font-semibold text-sm px-4 py-2 rounded-lg hover:bg-[#ddd] transition-colors disabled:opacity-50"
              >
                {saved ? <><Check size={14} />Saved</> : saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder = "",
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[#555] text-xs block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333] [color-scheme:dark]"
      />
    </div>
  );
}
