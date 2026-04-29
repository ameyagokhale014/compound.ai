import { useState } from "react";
import { ChevronRight, ChevronLeft, Check, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import type { InvestingGoal } from "../api";

interface Props { onDone: () => void; }

const GOAL_OPTIONS = [
  { id: "preservation",   label: "Capital preservation",    desc: "Protect what I have" },
  { id: "income",         label: "Dividend income",         desc: "Regular cash flow" },
  { id: "growth",         label: "Steady growth",           desc: "Beat inflation + index" },
  { id: "hyper_growth",   label: "Hyper growth",            desc: "Maximize long-term returns" },
  { id: "value",          label: "Value investing",         desc: "Buy undervalued businesses" },
  { id: "retirement",     label: "Retirement planning",     desc: "Build a retirement nest egg" },
  { id: "speculation",    label: "Speculation",             desc: "High-risk, high-reward bets" },
];

const SECTORS = [
  "Fossil Fuels", "Tobacco", "Alcohol", "Gambling", "Defense / Weapons",
  "Cannabis", "Adult Content", "Animal Testing", "Pharmaceuticals", "Social Media",
];

const EXPERIENCE_OPTIONS = [
  { id: "beginner", label: "Beginner", desc: "< 1 year" },
  { id: "2-5y",     label: "Intermediate", desc: "2–5 years" },
  { id: "5-10y",    label: "Experienced", desc: "5–10 years" },
  { id: "10+y",     label: "Expert", desc: "10+ years" },
];

const HORIZON_OPTIONS = [
  { id: "<1y",   label: "< 1 year" },
  { id: "1-3y",  label: "1–3 years" },
  { id: "3-7y",  label: "3–7 years" },
  { id: "7-15y", label: "7–15 years" },
  { id: "15+y",  label: "15+ years" },
];

const STEPS = ["Investing goals", "Your profile", "Financial context", "Preferences", "AI setup"];

export default function SetupWizard({ onDone }: Props) {
  const { updateUser, user } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 0 — goals
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [goalWeights, setGoalWeights] = useState<Record<string, number>>({});

  // Step 1 — profile
  const [experienceLevel, setExperienceLevel] = useState("");
  const [timeHorizon, setTimeHorizon] = useState("");
  const [riskTolerance, setRiskTolerance] = useState(3);
  const [country, setCountry] = useState("");

  // Step 2 — financial context
  const [annualIncome, setAnnualIncome] = useState("");
  const [monthlyInvestable, setMonthlyInvestable] = useState("");
  const [netWorthOutside, setNetWorthOutside] = useState("");
  const [retirementAge, setRetirementAge] = useState("");
  const [hasDependents, setHasDependents] = useState<boolean | null>(null);

  // Step 3 — work + preferences
  const [companyName, setCompanyName] = useState("");
  const [employerSector, setEmployerSector] = useState("");
  const [sectorsToAvoid, setSectorsToAvoid] = useState<string[]>([]);

  // Step 4 — API key
  const [apiKey, setApiKey] = useState(user?.anthropic_api_key ?? "");

  function toggleGoal(id: string) {
    setSelectedGoals((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((g) => g !== id);
        // redistribute weights evenly
        const even = next.length > 0 ? Math.floor(100 / next.length) : 0;
        const newW: Record<string, number> = {};
        next.forEach((g, i) => { newW[g] = i === 0 ? 100 - even * (next.length - 1) : even; });
        setGoalWeights(newW);
        return next;
      }
      const next = [...prev, id];
      const even = Math.floor(100 / next.length);
      const newW: Record<string, number> = {};
      next.forEach((g, i) => { newW[g] = i === 0 ? 100 - even * (next.length - 1) : even; });
      setGoalWeights(newW);
      return next;
    });
  }

  function setWeight(id: string, val: number) {
    setGoalWeights((prev) => ({ ...prev, [id]: val }));
  }

  function totalWeight() { return Object.values(goalWeights).reduce((s, v) => s + v, 0); }

  function toggleSector(s: string) {
    setSectorsToAvoid((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function handleFinish() {
    setSaving(true);
    const goals: InvestingGoal[] = selectedGoals.map((id) => ({
      id,
      label: GOAL_OPTIONS.find((g) => g.id === id)?.label ?? id,
      weight: goalWeights[id] ?? 0,
    }));
    await updateUser({
      investing_goals:       goals.length > 0 ? goals : undefined,
      experience_level:      experienceLevel || undefined,
      time_horizon:          timeHorizon || undefined,
      risk_tolerance:        riskTolerance,
      country:               country || undefined,
      annual_income:         annualIncome ? parseFloat(annualIncome) : undefined,
      monthly_investable:    monthlyInvestable ? parseFloat(monthlyInvestable) : undefined,
      net_worth_outside:     netWorthOutside ? parseFloat(netWorthOutside) : undefined,
      retirement_target_age: retirementAge ? parseInt(retirementAge) : undefined,
      has_dependents:        hasDependents ?? undefined,
      company_name:          companyName || undefined,
      employer_sector:       employerSector || undefined,
      sectors_to_avoid:      sectorsToAvoid.length > 0 ? sectorsToAvoid : undefined,
      anthropic_api_key:     apiKey.trim() || undefined,
      setup_complete:        true,
    }).catch(() => {});
    setSaving(false);
    onDone();
  }

  const isLast = step === STEPS.length - 1;

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-6 text-center">
          <p className="text-[#555] text-sm mb-1">Optional setup — personalises your AI advisor</p>
          <h1 className="text-white text-xl font-semibold">{STEPS[step]}</h1>
        </div>

        {/* Progress */}
        <div className="flex gap-1 mb-8">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-0.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-[#4f8ef7]" : "bg-[#1e1e1e]"}`}
            />
          ))}
        </div>

        <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-7">
          {/* Step 0 — Investing goals */}
          {step === 0 && (
            <div>
              <p className="text-[#555] text-sm mb-4">Choose what matters to you. Weights must sum to 100.</p>
              <div className="space-y-2">
                {GOAL_OPTIONS.map((g) => {
                  const active = selectedGoals.includes(g.id);
                  return (
                    <div
                      key={g.id}
                      onClick={() => toggleGoal(g.id)}
                      className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${
                        active ? "border-[#4f8ef7] bg-[#4f8ef7]/10" : "border-[#2a2a2a] hover:border-[#3a3a3a]"
                      }`}
                    >
                      <div>
                        <p className="text-white text-sm font-medium">{g.label}</p>
                        <p className="text-[#555] text-xs">{g.desc}</p>
                      </div>
                      {active && (
                        <input
                          type="number"
                          min={0} max={100}
                          value={goalWeights[g.id] ?? 0}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setWeight(g.id, parseInt(e.target.value) || 0)}
                          className="w-14 bg-[#0a0a0a] border border-[#333] rounded-lg px-2 py-1 text-white text-sm text-center outline-none"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {selectedGoals.length > 0 && (
                <p className={`text-xs mt-3 ${totalWeight() === 100 ? "text-green-400" : "text-amber-400"}`}>
                  Total: {totalWeight()}% {totalWeight() !== 100 && "(should be 100%)"}
                </p>
              )}
            </div>
          )}

          {/* Step 1 — Profile */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="text-[#555] text-xs block mb-2">Experience level</label>
                <div className="grid grid-cols-2 gap-2">
                  {EXPERIENCE_OPTIONS.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setExperienceLevel(e.id)}
                      className={`p-2.5 rounded-xl border text-left transition-colors ${
                        experienceLevel === e.id ? "border-[#4f8ef7] bg-[#4f8ef7]/10" : "border-[#2a2a2a] hover:border-[#3a3a3a]"
                      }`}
                    >
                      <p className="text-white text-sm">{e.label}</p>
                      <p className="text-[#555] text-xs">{e.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[#555] text-xs block mb-2">Investment time horizon</label>
                <div className="flex flex-wrap gap-2">
                  {HORIZON_OPTIONS.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => setTimeHorizon(h.id)}
                      className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                        timeHorizon === h.id ? "border-[#4f8ef7] bg-[#4f8ef7]/10 text-white" : "border-[#2a2a2a] text-[#555] hover:border-[#3a3a3a]"
                      }`}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[#555] text-xs block mb-2">
                  Risk tolerance — <span className="text-white">{["", "Very conservative", "Conservative", "Moderate", "Aggressive", "Very aggressive"][riskTolerance]}</span>
                </label>
                <input
                  type="range" min={1} max={5} value={riskTolerance}
                  onChange={(e) => setRiskTolerance(parseInt(e.target.value))}
                  className="w-full accent-[#4f8ef7]"
                />
                <div className="flex justify-between text-[#333] text-xs mt-0.5">
                  <span>Very conservative</span><span>Very aggressive</span>
                </div>
              </div>

              <div>
                <label className="text-[#555] text-xs block mb-1">Country</label>
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. United States"
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
                />
              </div>
            </div>
          )}

          {/* Step 2 — Financial context */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#555] text-xs block mb-1">Annual income (USD)</label>
                  <input
                    type="number" value={annualIncome}
                    onChange={(e) => setAnnualIncome(e.target.value)}
                    placeholder="e.g. 150000"
                    className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
                  />
                </div>
                <div>
                  <label className="text-[#555] text-xs block mb-1">Monthly investable (USD)</label>
                  <input
                    type="number" value={monthlyInvestable}
                    onChange={(e) => setMonthlyInvestable(e.target.value)}
                    placeholder="e.g. 2000"
                    className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#555] text-xs block mb-1">Net worth outside portfolio</label>
                  <input
                    type="number" value={netWorthOutside}
                    onChange={(e) => setNetWorthOutside(e.target.value)}
                    placeholder="e.g. 50000"
                    className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
                  />
                </div>
                <div>
                  <label className="text-[#555] text-xs block mb-1">Target retirement age</label>
                  <input
                    type="number" value={retirementAge}
                    onChange={(e) => setRetirementAge(e.target.value)}
                    placeholder="e.g. 55"
                    className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[#555] text-xs block mb-2">Do you have financial dependents?</label>
                <div className="flex gap-2">
                  {([true, false] as const).map((v) => (
                    <button
                      key={String(v)}
                      onClick={() => setHasDependents(v)}
                      className={`flex-1 py-2 rounded-lg border text-sm transition-colors ${
                        hasDependents === v ? "border-[#4f8ef7] bg-[#4f8ef7]/10 text-white" : "border-[#2a2a2a] text-[#555] hover:border-[#3a3a3a]"
                      }`}
                    >
                      {v ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Work + preferences */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[#555] text-xs block mb-1">Employer / company</label>
                  <input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Google"
                    className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
                  />
                </div>
                <div>
                  <label className="text-[#555] text-xs block mb-1">Employer sector</label>
                  <input
                    value={employerSector}
                    onChange={(e) => setEmployerSector(e.target.value)}
                    placeholder="e.g. Technology"
                    className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[#555] text-xs block mb-2">Sectors to avoid in portfolio</label>
                <div className="flex flex-wrap gap-2">
                  {SECTORS.map((s) => (
                    <button
                      key={s}
                      onClick={() => toggleSector(s)}
                      className={`px-2.5 py-1 rounded-lg border text-xs transition-colors ${
                        sectorsToAvoid.includes(s)
                          ? "border-red-500/50 bg-red-500/10 text-red-400"
                          : "border-[#2a2a2a] text-[#555] hover:border-[#3a3a3a] hover:text-[#8a8a8a]"
                      }`}
                    >
                      {sectorsToAvoid.includes(s) ? <><X size={10} className="inline mr-1" />{s}</> : s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4 — API key */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <label className="text-[#555] text-xs block mb-1">Anthropic API key</label>
                <p className="text-[#333] text-xs mb-3 leading-relaxed">
                  Powers AI Buy Price Analysis, the Advisor, Popi, Earnings Intelligence, and all other AI features.
                  Stored securely in your account — no longer just browser storage.
                </p>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm font-mono outline-none focus:border-[#444] placeholder:font-sans placeholder:text-[#333]"
                />
              </div>
              <div className="bg-[#1a1a1a] rounded-xl p-4">
                <p className="text-[#8a8a8a] text-xs font-medium mb-2">What you've set up:</p>
                <ul className="space-y-1">
                  {[
                    selectedGoals.length > 0 && `${selectedGoals.length} investing goals`,
                    experienceLevel && "Experience level",
                    timeHorizon && "Time horizon",
                    annualIncome && "Annual income",
                    country && `Country: ${country}`,
                  ].filter(Boolean).map((item) => (
                    <li key={String(item)} className="flex items-center gap-2 text-[#555] text-xs">
                      <Check size={11} className="text-green-400" />{item}
                    </li>
                  ))}
                  {selectedGoals.length === 0 && !experienceLevel && !timeHorizon && !annualIncome && !country && (
                    <li className="text-[#333] text-xs">Nothing yet — that's fine, you can skip this wizard.</li>
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <div className="flex items-center justify-between mt-5">
          <button
            onClick={step === 0 ? onDone : () => setStep((s) => s - 1)}
            className="flex items-center gap-1 text-[#555] text-sm hover:text-[#8a8a8a] transition-colors"
          >
            {step === 0 ? (
              <span>Skip setup</span>
            ) : (
              <><ChevronLeft size={16} />Back</>
            )}
          </button>

          {isLast ? (
            <button
              onClick={handleFinish}
              disabled={saving}
              className="flex items-center gap-2 bg-[#4f8ef7] text-white font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-[#6fa8ff] transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : <><Check size={15} />Save & finish</>}
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="flex items-center gap-1 bg-[#1e1e1e] text-white font-medium text-sm px-4 py-2.5 rounded-xl hover:bg-[#2a2a2a] transition-colors"
            >
              Next<ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
