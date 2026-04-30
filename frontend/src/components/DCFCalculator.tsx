import { useEffect, useState, useMemo } from "react";
import { getDCFDefaults } from "../api";
import { RefreshCw, ChevronDown, ChevronUp, Info } from "lucide-react";

interface Props {
  symbol: string;
  currentPrice?: number;
}

function fmtB(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPrice(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

interface SliderInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  tooltip: string;
  color?: string;
}

function SliderInput({ label, value, min, max, step, unit, onChange, tooltip, color = "#4f8ef7" }: SliderInputProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[#8a8a8a] text-xs">{label}</span>
          <div className="group relative">
            <Info size={10} className="text-[#444] cursor-help" />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-2.5 text-[10px] text-[#8a8a8a] leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-xl">
              {tooltip}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
            }}
            className="w-16 text-right bg-[#111] border border-[#2a2a2a] rounded px-1.5 py-0.5 text-white text-xs outline-none focus:border-[#444] tabular-nums"
          />
          <span className="text-[#555] text-xs">{unit}</span>
        </div>
      </div>
      <div className="relative h-1.5 bg-[#1a1a1a] rounded-full cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          const raw = min + ratio * (max - min);
          const stepped = Math.round(raw / step) * step;
          onChange(parseFloat(stepped.toFixed(10)));
        }}
      >
        <div className="absolute top-0 left-0 h-1.5 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-[#0a0a0a] shadow transition-all"
          style={{ left: `${pct}%`, transform: `translate(-50%, -50%)`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function Tooltip({ text }: { text: string }) {
  return (
    <div className="group relative inline-block">
      <Info size={10} className="text-[#444] cursor-help" />
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-52 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-2.5 text-[10px] text-[#8a8a8a] leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 shadow-xl">
        {text}
      </div>
    </div>
  );
}

// ── DCF math ────────────────────────────────────────────────────────────────
function computeDCF(
  ttmFCF: number,
  growthY1to5: number,
  growthY6to10: number,
  terminalRate: number,
  discountRate: number,
  years: number,
  shares: number,
  netCash: number,
  marginOfSafety: number,
) {
  const g1 = growthY1to5 / 100;
  const g2 = growthY6to10 / 100;
  const gT = terminalRate / 100;
  const r  = discountRate / 100;

  let totalPV = 0;
  const yearlyData: { year: number; fcf: number; pv: number }[] = [];
  let fcf = ttmFCF;

  for (let y = 1; y <= years; y++) {
    const growth = y <= 5 ? g1 : g2;
    fcf = fcf * (1 + growth);
    const pv = fcf / Math.pow(1 + r, y);
    totalPV += pv;
    yearlyData.push({ year: y, fcf, pv });
  }

  // Terminal value
  const terminalFCF  = fcf * (1 + gT);
  const terminalVal  = r > gT ? terminalFCF / (r - gT) : 0;
  const terminalPV   = terminalVal / Math.pow(1 + r, years);
  totalPV += terminalPV;

  const equityValue      = totalPV + netCash;
  const intrinsicValue   = shares > 0 ? equityValue / shares : 0;
  const buyPrice         = intrinsicValue * (1 - marginOfSafety / 100);

  return { totalPV, terminalVal, terminalPV, equityValue, intrinsicValue, buyPrice, yearlyData };
}

// ── Learn panel ─────────────────────────────────────────────────────────────
function LearnPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[#2a2a2a] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#111] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">📚</span>
          <span className="text-[#8a8a8a] text-xs font-medium">How to use this DCF calculator</span>
        </div>
        {open ? <ChevronUp size={13} className="text-[#555]" /> : <ChevronDown size={13} className="text-[#555]" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 text-xs text-[#8a8a8a] leading-relaxed border-t border-[#1a1a1a]">
          <div className="pt-3 text-[#555] italic">
            A DCF (Discounted Cash Flow) calculator answers one question: <span className="text-[#8a8a8a]">what is this business worth today, based on the cash it will generate in the future?</span>
          </div>

          <div>
            <div className="text-white text-xs font-semibold mb-1.5">Step 1 — Start with Free Cash Flow</div>
            <p>We auto-fill <span className="text-white">TTM Free Cash Flow</span> (trailing twelve months) — the real cash the company generated after paying for its operations and capital spending. This is your baseline. The DCF projects this number forward.</p>
          </div>

          <div>
            <div className="text-white text-xs font-semibold mb-1.5">Step 2 — Set your growth assumptions</div>
            <p><span className="text-white">Years 1–5 growth</span> is how fast you expect FCF to grow in the near term. For a high-growth company like META, you might use 15–25%. For a mature company like Coca-Cola, 5–8%. Be honest — this is the most impactful input.</p>
            <p className="mt-1"><span className="text-white">Years 6–10 growth</span> assumes the company matures and slows down. Usually set this 5–10 pts lower than Years 1–5.</p>
          </div>

          <div>
            <div className="text-white text-xs font-semibold mb-1.5">Step 3 — Terminal growth rate</div>
            <p>After Year 10, the business grows forever at this rate. Keep it at <span className="text-white">2–3%</span> — roughly US GDP growth. Never go above 4% or the math breaks down (you'd be assuming the company grows faster than the whole economy forever).</p>
          </div>

          <div>
            <div className="text-white text-xs font-semibold mb-1.5">Step 4 — Discount rate (your required return)</div>
            <p>This is the annual return you demand for the risk you're taking. <span className="text-white">10%</span> is the long-run S&P 500 average — a good default. Use <span className="text-white">8%</span> for large blue chips. Use <span className="text-white">12–15%</span> for riskier, smaller companies. A higher discount rate = lower intrinsic value (you're being more conservative).</p>
          </div>

          <div>
            <div className="text-white text-xs font-semibold mb-1.5">Step 5 — Margin of safety</div>
            <p>DCF is based on estimates, and estimates are wrong. A <span className="text-white">20–30% margin of safety</span> means you only buy if the stock trades at least 20–30% below your calculated intrinsic value. This is how Warren Buffett protects against being wrong.</p>
          </div>

          <div className="bg-[#0d1a0d] border border-[#1a3a1a] rounded-lg p-3">
            <div className="text-[#00c805] text-xs font-semibold mb-1">How to read the result</div>
            <p>If <span className="text-white">Intrinsic Value &gt; Current Price</span>, the stock may be undervalued. If your <span className="text-white">Buy Price (with MoS) &gt; Current Price</span>, it's an attractive entry point. If the stock is well above intrinsic value, wait for a better price — or re-examine your growth assumptions.</p>
          </div>

          <div className="bg-[#1a1000] border border-[#3a2a00] rounded-lg p-3">
            <div className="text-[#f7c44f] text-xs font-semibold mb-1">Important caveat</div>
            <p>DCF is highly sensitive to growth assumptions. Small changes in growth rate or discount rate produce large changes in intrinsic value. Run multiple scenarios (bull, base, bear) and treat the output as a <span className="text-white">range, not a precise target</span>. If a stock looks cheap in all three scenarios, that's a strong signal.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DCFCalculator({ symbol, currentPrice }: Props) {
  const [loading, setLoading]   = useState(true);
  const [defaults, setDefaults] = useState<{ ttmFCF: number; shares: number; netCash: number; suggestedGrowth: number } | null>(null);

  // Inputs
  const [ttmFCF,         setTtmFCF]         = useState(0);
  const [shares,         setShares]         = useState(0);
  const [netCash,        setNetCash]        = useState(0);
  const [growthY1to5,    setGrowthY1to5]    = useState(15);
  const [growthY6to10,   setGrowthY6to10]   = useState(10);
  const [terminalRate,   setTerminalRate]   = useState(3);
  const [discountRate,   setDiscountRate]   = useState(10);
  const [years,          setYears]          = useState(10);
  const [marginOfSafety, setMarginOfSafety] = useState(20);

  useEffect(() => {
    setLoading(true);
    getDCFDefaults(symbol).then((d) => {
      if (d.ttm_fcf && d.shares) {
        const fcf = d.ttm_fcf;
        const sh  = d.shares;
        const nc  = d.net_cash ?? 0;
        const sg  = d.suggested_growth ?? 15;
        setTtmFCF(fcf);
        setShares(sh);
        setNetCash(nc);
        setGrowthY1to5(Math.round(sg));
        setGrowthY6to10(Math.max(3, Math.round(sg * 0.6)));
        setDefaults({ ttmFCF: fcf, shares: sh, netCash: nc, suggestedGrowth: sg });
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [symbol]);

  const result = useMemo(() => {
    if (!ttmFCF || !shares) return null;
    return computeDCF(ttmFCF, growthY1to5, growthY6to10, terminalRate, discountRate, years, shares, netCash, marginOfSafety);
  }, [ttmFCF, shares, netCash, growthY1to5, growthY6to10, terminalRate, discountRate, years, marginOfSafety]);

  const price = currentPrice ?? 0;
  const upside = result && price > 0 ? ((result.intrinsicValue - price) / price) * 100 : null;
  const mosUpside = result && price > 0 ? ((result.buyPrice - price) / price) * 100 : null;
  const isUndervalued = result ? result.intrinsicValue > price : false;
  const mosTriggered  = result ? result.buyPrice > price : false;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-[#555] text-sm">
        <RefreshCw size={13} className="animate-spin" /> Loading DCF data…
      </div>
    );
  }

  if (!defaults) {
    return <div className="py-8 text-center text-[#444] text-sm">DCF data not available for this symbol</div>;
  }

  return (
    <div className="space-y-5">
      {/* Learn panel */}
      <LearnPanel />

      {/* Two-col layout: inputs left, results right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Inputs ── */}
        <div className="space-y-4">
          <div className="text-[#555] text-[10px] uppercase tracking-widest font-semibold">Assumptions</div>

          {/* Auto-filled row */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "TTM Free Cash Flow", value: fmtB(ttmFCF), tip: "Trailing twelve months free cash flow — operating cash flow minus capital expenditure. This is the real cash the business generates. Auto-filled from yfinance." },
              { label: "Shares Outstanding", value: `${(shares / 1e9).toFixed(2)}B`, tip: "Total shares of the company in existence. Used to divide enterprise value into a per-share price." },
              { label: "Net Cash", value: fmtB(netCash), tip: "Total cash minus total debt. Positive = fortress balance sheet. Negative = net debt. Added to the DCF enterprise value to get equity value." },
            ].map(({ label, value, tip }) => (
              <div key={label} className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-3">
                <div className="flex items-center gap-1 mb-1">
                  <div className="text-[#444] text-[9px] uppercase tracking-wide">{label}</div>
                  <Tooltip text={tip} />
                </div>
                <div className="text-white text-sm font-semibold tabular-nums">{value}</div>
                <div className="text-[#2a2a2a] text-[9px] mt-0.5">auto-filled</div>
              </div>
            ))}
          </div>

          {/* Sliders */}
          <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-4 space-y-4">
            <SliderInput
              label="FCF Growth — Years 1–5"
              value={growthY1to5} min={0} max={50} step={0.5} unit="%"
              onChange={setGrowthY1to5} color="#4f8ef7"
              tooltip="How fast you expect free cash flow to grow in the next 5 years. Use analyst estimates, recent growth, or your own view. For fast growers like META: 15–25%. For mature companies: 5–10%."
            />
            <SliderInput
              label="FCF Growth — Years 6–10"
              value={growthY6to10} min={0} max={35} step={0.5} unit="%"
              onChange={setGrowthY6to10} color="#a78bfa"
              tooltip="Growth rate for years 6–10 as the business matures. Should be lower than Years 1–5. Most businesses slow down as they get larger."
            />
            <SliderInput
              label="Terminal Growth Rate"
              value={terminalRate} min={0} max={4} step={0.1} unit="%"
              onChange={setTerminalRate} color="#f7c44f"
              tooltip="The perpetual growth rate after year 10. Should be 2–3% (roughly US GDP growth). Never set above 4% — you'd be assuming it grows faster than the whole economy forever."
            />
            <SliderInput
              label="Discount Rate (WACC)"
              value={discountRate} min={6} max={20} step={0.5} unit="%"
              onChange={setDiscountRate} color="#ff8800"
              tooltip="Your required annual return. 10% = S&P 500 historical average. Use 8% for blue-chip stalwarts, 12–15% for riskier companies. Higher discount rate = lower intrinsic value = more conservative."
            />
            <SliderInput
              label="Margin of Safety"
              value={marginOfSafety} min={0} max={50} step={5} unit="%"
              onChange={setMarginOfSafety} color="#00c805"
              tooltip="How much discount you want on the intrinsic value before buying. 20–30% is common. This is your buffer against being wrong on growth assumptions. A 20% MoS means you only buy if the stock is 20% below intrinsic value."
            />

            {/* Projection period toggle */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[#8a8a8a] text-xs">Projection Period</span>
                  <Tooltip text="How many years to project cash flows before calculating terminal value. 10 years is standard. Use 5 years for faster, simpler analysis." />
                </div>
                <div className="flex gap-1">
                  {[5, 10].map(y => (
                    <button key={y} onClick={() => setYears(y)}
                      className={`px-3 py-1 text-xs rounded-lg transition-colors ${years === y ? "bg-[#222] text-white" : "text-[#555] hover:text-[#8a8a8a]"}`}>
                      {y}Y
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Reset button */}
          {defaults && (
            <button
              onClick={() => {
                setTtmFCF(defaults.ttmFCF);
                setShares(defaults.shares);
                setNetCash(defaults.netCash);
                setGrowthY1to5(Math.round(defaults.suggestedGrowth));
                setGrowthY6to10(Math.max(3, Math.round(defaults.suggestedGrowth * 0.6)));
                setTerminalRate(3);
                setDiscountRate(10);
                setMarginOfSafety(20);
                setYears(10);
              }}
              className="text-[#444] text-xs hover:text-[#8a8a8a] transition-colors"
            >
              ↺ Reset to defaults
            </button>
          )}
        </div>

        {/* ── Results ── */}
        <div className="space-y-3">
          <div className="text-[#555] text-[10px] uppercase tracking-widest font-semibold">Results</div>

          {result && (
            <>
              {/* Main verdict card */}
              <div className={`rounded-2xl p-5 border ${
                mosTriggered
                  ? "bg-[#071a07] border-[#1a3a1a]"
                  : isUndervalued
                    ? "bg-[#0d1a00] border-[#2a3a00]"
                    : "bg-[#1a0707] border-[#3a1a1a]"
              }`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-[#555] text-[10px] uppercase tracking-widest mb-1">Intrinsic Value</div>
                    <div className="text-white text-3xl font-bold tabular-nums">{fmtPrice(result.intrinsicValue)}</div>
                    {upside !== null && (
                      <div className={`text-sm font-medium mt-0.5 ${upside >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                        {upside >= 0 ? "+" : ""}{upside.toFixed(1)}% vs current price
                      </div>
                    )}
                  </div>
                  <div className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                    mosTriggered ? "bg-[#0a2a0a] text-[#00c805]" :
                    isUndervalued ? "bg-[#1a2a00] text-[#4dbb50]" :
                    "bg-[#2a0a0a] text-[#ff5000]"
                  }`}>
                    {mosTriggered ? "Strong Buy Zone" : isUndervalued ? "Undervalued" : "Overvalued"}
                  </div>
                </div>

                {/* Buy price with MoS */}
                <div className="border-t border-[#ffffff10] pt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[#555] text-[10px] mb-0.5">Buy Price ({marginOfSafety}% MoS)</div>
                    <div className={`text-lg font-bold tabular-nums ${mosTriggered ? "text-[#00c805]" : "text-[#8a8a8a]"}`}>
                      {fmtPrice(result.buyPrice)}
                    </div>
                    {mosUpside !== null && (
                      <div className={`text-[10px] ${mosUpside >= 0 ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                        {mosUpside >= 0 ? "+" : ""}{mosUpside.toFixed(1)}% vs current
                      </div>
                    )}
                  </div>
                  {price > 0 && (
                    <div>
                      <div className="text-[#555] text-[10px] mb-0.5">Current Price</div>
                      <div className="text-white text-lg font-bold tabular-nums">{fmtPrice(price)}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Breakdown */}
              <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-4 space-y-2.5">
                <div className="text-[#555] text-[10px] uppercase tracking-widest mb-3">Value Breakdown</div>
                {[
                  { label: "PV of projected cash flows", value: fmtB(result.totalPV - result.terminalPV), tip: "Present value of cash flows during the projection period, discounted back to today." },
                  { label: `PV of terminal value (Year ${years}+)`, value: fmtB(result.terminalPV), tip: "Present value of all cash flows beyond the projection period, calculated as a perpetuity." },
                  { label: "Enterprise value (sum)", value: fmtB(result.totalPV), tip: "Total present value of all future cash flows — this is what the business is worth before accounting for debt and cash." },
                  { label: "Net cash adjustment", value: fmtB(netCash), tip: "Cash minus debt. Added to enterprise value because cash is an asset; debt is subtracted because it's a liability." },
                  { label: "Equity value", value: fmtB(result.equityValue), tip: "Enterprise value plus net cash. What belongs to shareholders." },
                  { label: "÷ Shares outstanding", value: `${(shares / 1e9).toFixed(2)}B`, tip: "Divides equity value into a per-share intrinsic value." },
                ].map(({ label, value, tip }) => (
                  <div key={label} className="flex items-center justify-between py-1.5 border-b border-[#111] last:border-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#555] text-xs">{label}</span>
                      <Tooltip text={tip} />
                    </div>
                    <span className="text-white text-xs font-semibold tabular-nums">{value}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[#8a8a8a] text-xs font-semibold">= Intrinsic value per share</span>
                  <span className="text-white text-sm font-bold tabular-nums">{fmtPrice(result.intrinsicValue)}</span>
                </div>
              </div>

              {/* Cash flow projection table */}
              <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1a1a1a]">
                  <div className="text-[#555] text-[10px] uppercase tracking-widest">Projected Cash Flows</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[#111]">
                        <th className="py-2 pl-4 text-left text-[#444] font-normal">Year</th>
                        <th className="py-2 px-3 text-right text-[#444] font-normal">FCF</th>
                        <th className="py-2 px-3 text-right text-[#444] font-normal">PV (discounted)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.yearlyData.map(({ year, fcf, pv }) => (
                        <tr key={year} className="border-b border-[#0a0a0a] hover:bg-[#111]">
                          <td className="py-1.5 pl-4 text-[#555]">
                            Year {year}
                            {year === 5 && <span className="ml-1.5 text-[9px] text-[#2a2a2a]">growth slows</span>}
                          </td>
                          <td className="py-1.5 px-3 text-right text-[#8a8a8a] tabular-nums">{fmtB(fcf)}</td>
                          <td className="py-1.5 px-3 text-right text-white tabular-nums">{fmtB(pv)}</td>
                        </tr>
                      ))}
                      <tr className="border-b border-[#1a1a1a] bg-[#0a0a0a]">
                        <td className="py-1.5 pl-4 text-[#555]">Terminal ({years}Y+)</td>
                        <td className="py-1.5 px-3 text-right text-[#555] tabular-nums">{fmtB(result.terminalVal)}</td>
                        <td className="py-1.5 px-3 text-right text-[#a78bfa] tabular-nums">{fmtB(result.terminalPV)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-[#2a2a2a] text-[10px] text-center">
                Results are estimates based on your assumptions. Small changes in growth or discount rate have a large impact on intrinsic value.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
