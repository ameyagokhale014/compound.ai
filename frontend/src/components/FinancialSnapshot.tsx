import { useEffect, useState } from "react";
import { getStockFinancials } from "../api";
import type { QuarterlyFinancials } from "../api";
import { RefreshCw } from "lucide-react";

interface Props {
  symbol: string;
}

function fmtB(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null || !isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}

function fmtEPS(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function growthPct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  if (prev < 0 && cur < 0) return ((cur - prev) / Math.abs(prev)) * 100;
  if (prev < 0 || cur < 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[#444] text-[10px]">—</span>;
  const up = pct >= 0;
  return (
    <span className={`text-[10px] font-semibold ${up ? "text-[#00c805]" : "text-[#ff5000]"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

interface RowProps {
  label: string;
  sublabel?: string;
  values: (string | null)[];
  qoq: number | null;
  yoy: number | null;
  isMargin?: boolean;
  highlight?: boolean;
}

function Row({ label, sublabel, values, qoq, yoy, isMargin, highlight }: RowProps) {
  return (
    <tr className={`border-b border-[#1a1a1a] ${highlight ? "bg-[#0f1a0f]" : "hover:bg-[#111]"} transition-colors`}>
      <td className="py-2.5 pl-4 pr-2 min-w-[160px]">
        <div className={`text-xs font-medium ${isMargin ? "text-[#555] pl-3" : "text-[#aaa]"}`}>{label}</div>
        {sublabel && <div className="text-[#444] text-[10px] pl-3">{sublabel}</div>}
      </td>
      {values.map((v, i) => (
        <td key={i} className={`py-2.5 px-3 text-right text-xs tabular-nums ${isMargin ? "text-[#555]" : "text-white"}`}>
          {v ?? "—"}
        </td>
      ))}
      <td className="py-2.5 px-3 text-right"><GrowthBadge pct={qoq} /></td>
      <td className="py-2.5 px-3 text-right"><GrowthBadge pct={yoy} /></td>
    </tr>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="border-b border-[#222]">
      <td colSpan={99} className="pt-4 pb-1 pl-4 text-[10px] font-semibold text-[#555] uppercase tracking-widest">
        {label}
      </td>
    </tr>
  );
}

export default function FinancialSnapshot({ symbol }: Props) {
  const [data, setData] = useState<QuarterlyFinancials[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    getStockFinancials(symbol)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-[#555] text-sm">
        <RefreshCw size={13} className="animate-spin" /> Loading financials…
      </div>
    );
  }

  if (!data || data.length === 0) {
    return <div className="py-8 text-center text-[#444] text-sm">No financial data available</div>;
  }

  // Show last 5 quarters (already ordered oldest→newest from backend)
  const qs = data;
  const vals = (key: keyof QuarterlyFinancials) => qs.map((q) => q[key] as number | null);

  const n = qs.length;
  const last = qs[n - 1];
  const prev = n >= 2 ? qs[n - 2] : null;
  const yoyQ = n >= 5 ? qs[n - 5] : null;

  function row(
    label: string,
    key: keyof QuarterlyFinancials,
    fmt: (v: number | null) => string,
    opts: { sublabel?: string; isMargin?: boolean; highlight?: boolean } = {}
  ) {
    const rawVals = vals(key);
    const cur  = last[key] as number | null;
    const pr   = prev ? prev[key] as number | null : null;
    const yoyV = yoyQ ? yoyQ[key] as number | null : null;
    return (
      <Row
        key={label}
        label={label}
        sublabel={opts.sublabel}
        values={rawVals.map(fmt)}
        qoq={growthPct(cur, pr)}
        yoy={growthPct(cur, yoyV)}
        isMargin={opts.isMargin}
        highlight={opts.highlight}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-[#2a2a2a]">
            <th className="py-2 pl-4 text-[#555] font-normal text-[10px] uppercase tracking-widest min-w-[160px]">
              compound.ai snapshot
            </th>
            {qs.map((q) => (
              <th key={q.date} className="py-2 px-3 text-right text-[#8a8a8a] font-semibold text-[10px] whitespace-nowrap">
                {q.label}
              </th>
            ))}
            <th className="py-2 px-3 text-right text-[#555] font-normal text-[10px] whitespace-nowrap">QoQ</th>
            <th className="py-2 px-3 text-right text-[#555] font-normal text-[10px] whitespace-nowrap">YoY</th>
          </tr>
        </thead>
        <tbody>
          <SectionHeader label="💰 Revenue" />
          {row("Revenue", "revenue", fmtB, { highlight: true })}
          {row("Gross Profit", "gross_profit", fmtB)}
          {row("Gross Margin", "gross_margin", (v) => fmtPct(v), { isMargin: true })}

          <SectionHeader label="📈 Profitability" />
          {row("Operating Income", "op_income", fmtB, { highlight: true })}
          {row("Operating Margin", "op_margin", (v) => fmtPct(v), { isMargin: true })}
          {row("Net Income", "net_income", fmtB)}
          {row("Net Margin", "net_margin", (v) => fmtPct(v), { isMargin: true })}
          {row("EPS (diluted)", "eps", fmtEPS)}

          <SectionHeader label="💵 Cash Flow" />
          {row("Operating Cash Flow", "op_cf", fmtB, { highlight: true })}
          {row("CapEx", "capex", fmtB)}
          {row("Free Cash Flow", "fcf", fmtB)}
          {row("FCF Margin", "fcf_margin", (v) => fmtPct(v), { isMargin: true })}

          <SectionHeader label="🏦 Balance Sheet" />
          {row("Cash & Equivalents", "cash", fmtB)}
          {row("Total Debt", "total_debt", fmtB)}
          {row("Net Cash", "net_cash", fmtB, { highlight: true })}
          {row("Debt / Equity", "debt_equity", (v) => v != null ? `${v.toFixed(2)}x` : "—")}
        </tbody>
      </table>

      <div className="mt-3 px-4 text-[#333] text-[10px]">
        QoQ = most recent vs prior quarter · YoY = most recent vs same quarter last year · ▲ growth ▼ decline
      </div>
    </div>
  );
}
