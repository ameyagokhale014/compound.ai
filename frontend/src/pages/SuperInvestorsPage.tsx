import { useState, useEffect } from "react";
import {
  RefreshCw, TrendingUp, TrendingDown, Users, Zap,
  ChevronDown, ChevronUp, BarChart2, Star, ArrowUpRight,
  ArrowDownRight, Minus, Globe,
} from "lucide-react";
import {
  getSuperInvestorManagers, getSuperInvestorPortfolio,
  getSuperInvestorActivity, getSuperInvestorConsensus,
  fetchAllSuperInvestorPortfolios, analyzeSuperInvestorThemes,
} from "../api";
import type {
  ManagerMeta, ConsensusData, ConsensusStock,
  ActivityItem, InvestorPortfolio, ThemesData, HolderInfo,
} from "../api";

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtB = (v: number | null) => {
  if (v == null) return "—";
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}B`;
  return `$${v.toFixed(0)}M`;
};

const fmtNum = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 0 });

// ── Activity badge ────────────────────────────────────────────────────────────
const ACT_STYLE: Record<string, { bg: string; text: string; icon: React.ReactNode; label: string }> = {
  new:      { bg: "bg-[#0a2a0a]", text: "text-[#00c805]", icon: <Star size={9} />,          label: "New Position" },
  add:      { bg: "bg-[#061a06]", text: "text-[#4dbb50]", icon: <TrendingUp size={9} />,     label: "Added"        },
  hold:     { bg: "bg-[#141414]", text: "text-[#555]",    icon: <Minus size={9} />,           label: "Hold"         },
  reduce:   { bg: "bg-[#2a1400]", text: "text-[#f7944f]", icon: <TrendingDown size={9} />,   label: "Reduced"      },
  sold_out: { bg: "bg-[#2a0a0a]", text: "text-[#ff5000]", icon: <ArrowDownRight size={9} />, label: "Sold Out"     },
};

function ActivityBadge({ act, pct }: { act: string; pct?: number | null }) {
  const s = ACT_STYLE[act] ?? ACT_STYLE.hold;
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded ${s.bg} ${s.text}`}>
      {s.icon} {s.label}{pct != null ? ` ${pct > 0 ? "+" : ""}${pct.toFixed(0)}%` : ""}
    </span>
  );
}

// ── Conviction badge ──────────────────────────────────────────────────────────
const CONV: Record<string, { color: string; bg: string }> = {
  high:   { color: "text-[#00c805]", bg: "bg-[#061a06] border-[#1a3a1a]" },
  medium: { color: "text-[#f7c44f]", bg: "bg-[#1a1400] border-[#3a2a00]" },
  low:    { color: "text-[#8a8a8a]", bg: "bg-[#141414] border-[#2a2a2a]" },
};

// ── Consensus stock card ──────────────────────────────────────────────────────
function StockConsensusCard({
  stock, mode,
}: {
  stock: ConsensusStock;
  mode: "bought" | "sold" | "held";
}) {
  const [open, setOpen] = useState(false);
  const people = mode === "bought" ? stock.buyers : mode === "sold" ? stock.sellers : stock.holders;
  const countColor =
    mode === "bought" ? "text-[#00c805]" :
    mode === "sold"   ? "text-[#ff5000]" :
                        "text-[#a78bfa]";
  const borderColor =
    mode === "bought" ? "border-[#1a3a1a]" :
    mode === "sold"   ? "border-[#3a1a1a]" :
                        "border-[#2a1a3a]";

  return (
    <div className={`bg-[#111] border ${borderColor} rounded-xl overflow-hidden`}>
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[#1a1a1a] transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {/* Symbol + name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-bold text-sm">{stock.symbol}</span>
            {mode === "bought" && stock.buyers.some(b => b.activity === "new") && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0a2a0a] text-[#00c805] font-semibold border border-[#1a3a1a]">
                New Position
              </span>
            )}
          </div>
          <div className="text-[#555] text-[10px] truncate">{stock.name}</div>
        </div>

        {/* Count */}
        <div className="text-right shrink-0">
          <div className={`text-sm font-bold ${countColor}`}>
            {people.length}
            <span className="text-[#333] text-[10px] font-normal ml-0.5">investor{people.length !== 1 ? "s" : ""}</span>
          </div>
          {stock.avg_pct_portfolio != null && (
            <div className="text-[#444] text-[9px]">avg {stock.avg_pct_portfolio.toFixed(1)}% of port.</div>
          )}
        </div>

        {/* Investor emoji row */}
        <div className="flex gap-0.5 shrink-0">
          {people.slice(0, 5).map((h, i) => (
            <span key={i} title={`${h.manager_name} — ${h.activity_text || h.activity}`} className="text-sm cursor-help">
              {h.emoji}
            </span>
          ))}
          {people.length > 5 && <span className="text-[#444] text-xs">+{people.length - 5}</span>}
        </div>

        {open ? <ChevronUp size={12} className="text-[#444] shrink-0" /> : <ChevronDown size={12} className="text-[#333] shrink-0" />}
      </div>

      {open && (
        <div className="border-t border-[#1a1a1a] px-3 py-2 space-y-1.5 bg-[#0d0d0d]">
          {people.map((h, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">{h.emoji}</span>
                <div>
                  <div className="text-white text-xs font-medium">{h.manager_name}</div>
                  <div className="text-[#444] text-[9px]">{h.firm}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-right">
                {h.pct_portfolio != null && (
                  <span className="text-[#555] text-[10px]">{h.pct_portfolio.toFixed(1)}% of port.</span>
                )}
                <ActivityBadge act={h.activity} pct={h.activity_pct} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Investor profile card ─────────────────────────────────────────────────────
function InvestorCard({
  manager, portfolio, onLoad,
}: {
  manager: ManagerMeta;
  portfolio: InvestorPortfolio | null;
  onLoad: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleExpand() {
    if (!portfolio) {
      setLoading(true);
      try { await onLoad(); } finally { setLoading(false); }
    }
    setOpen(v => !v);
  }

  const recentActivity = portfolio?.holdings.filter(h => h.activity !== "hold") ?? [];
  const topHoldings    = portfolio?.holdings.slice(0, 8) ?? [];

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl overflow-hidden">
      {/* Header */}
      <div
        className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-[#1a1a1a] transition-colors"
        onClick={handleExpand}
      >
        <div className="text-3xl shrink-0 mt-0.5">{manager.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-sm">{manager.display_name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1a1a2a] text-[#4488ff] border border-[#1a1a2a]">
              {manager.style || "Equity"}
            </span>
          </div>
          <div className="text-[#555] text-[10px] mt-0.5">{manager.firm}</div>
          <div className="text-[#333] text-[10px] mt-1 italic">{manager.known_for}</div>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            {manager.portfolio_value_millions != null && (
              <span className="text-[#8a8a8a] text-[10px]">
                AUM <span className="text-white font-semibold">{fmtB(manager.portfolio_value_millions)}</span>
              </span>
            )}
            {manager.num_stocks != null && (
              <span className="text-[#8a8a8a] text-[10px]">
                <span className="text-white font-semibold">{manager.num_stocks}</span> positions
              </span>
            )}
            {manager.reported && (
              <span className="text-[#444] text-[9px]">as of {manager.reported}</span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {loading
            ? <RefreshCw size={14} className="text-[#555] animate-spin" />
            : open
              ? <ChevronUp size={14} className="text-[#555]" />
              : <ChevronDown size={14} className="text-[#555]" />
          }
        </div>
      </div>

      {/* Expanded portfolio */}
      {open && portfolio && !portfolio.error && (
        <div className="border-t border-[#1e1e1e] bg-[#0d0d0d]">
          {/* Recent activity strip */}
          {recentActivity.length > 0 && (
            <div className="px-4 py-3 border-b border-[#1a1a1a]">
              <div className="text-[#555] text-[9px] uppercase tracking-widest mb-2">Recent Activity</div>
              <div className="flex flex-wrap gap-1.5">
                {recentActivity.slice(0, 10).map((h, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-[#141414] border border-[#2a2a2a] rounded-lg px-2 py-1">
                    <span className="text-white text-[10px] font-semibold">{h.symbol}</span>
                    <ActivityBadge act={h.activity} pct={h.activity_pct} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top holdings */}
          <div className="px-4 py-3">
            <div className="text-[#555] text-[9px] uppercase tracking-widest mb-2">
              Top Holdings
              {portfolio.aum && <span className="ml-2 text-[#333] normal-case">Portfolio value: {portfolio.aum}</span>}
            </div>
            <div className="space-y-1">
              {topHoldings.map((h, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-[#1a1a1a] last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[#444] text-[10px] w-4 text-right">{i + 1}.</span>
                    <div>
                      <span className="text-white text-xs font-semibold">{h.symbol}</span>
                      <span className="text-[#555] text-[10px] ml-1.5 truncate max-w-[120px] inline-block align-bottom">{h.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {h.pct_portfolio != null && (
                      <div className="text-right">
                        <div className="text-white text-xs font-medium">{h.pct_portfolio.toFixed(1)}%</div>
                        <div className="w-12 bg-[#1a1a1a] rounded-full h-1 mt-0.5">
                          <div
                            className="bg-[#4f8ef7] h-1 rounded-full"
                            style={{ width: `${Math.min(h.pct_portfolio * 2.5, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {h.activity !== "hold" && <ActivityBadge act={h.activity} pct={h.activity_pct} />}
                    {h.value_millions != null && (
                      <span className="text-[#444] text-[9px]">{fmtB(h.value_millions)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {portfolio.holdings.length > 8 && (
              <div className="text-[#333] text-[10px] mt-2 text-center">
                +{portfolio.holdings.length - 8} more positions
              </div>
            )}
          </div>
        </div>
      )}

      {open && portfolio?.error && (
        <div className="border-t border-[#1e1e1e] px-4 py-3 text-[#ff5000] text-xs bg-[#0d0d0d]">
          {portfolio.error}
        </div>
      )}
    </div>
  );
}

// ── Activity feed item ────────────────────────────────────────────────────────
function ActivityFeedItem({ item }: { item: ActivityItem }) {
  const isAdd  = item.activity_type === "new" || item.activity_type === "add";
  const isSell = item.activity_type === "reduce" || item.activity_type === "sold_out";
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[#1a1a1a] last:border-0">
      <span className="text-2xl shrink-0">{item.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-white text-xs font-semibold">{item.manager_name}</span>
          <span className={`text-[10px] font-bold ${isAdd ? "text-[#00c805]" : isSell ? "text-[#ff5000]" : "text-[#555]"}`}>
            {isAdd ? "▲ bought" : isSell ? "▼ sold" : "—"}
          </span>
          <span className="text-white text-xs font-bold">{item.symbol}</span>
          {item.stock_name && <span className="text-[#444] text-[10px] truncate">{item.stock_name}</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[#444] text-[9px]">{item.date}</span>
          {item.pct_portfolio != null && (
            <span className="text-[#333] text-[9px]">{item.pct_portfolio.toFixed(1)}% of portfolio</span>
          )}
        </div>
      </div>
      <div className="shrink-0">
        <ActivityBadge act={item.activity_type} pct={item.change_pct} />
      </div>
    </div>
  );
}

// ── Themes panel ──────────────────────────────────────────────────────────────
function ThemesPanel({ consensus }: { consensus: ConsensusData | null }) {
  const [themes, setThemes]     = useState<ThemesData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [fetched, setFetched]   = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await analyzeSuperInvestorThemes();
      setThemes(data as ThemesData);
    } finally {
      setLoading(false);
      setFetched(true);
    }
  }

  const SENT: Record<string, { color: string; label: string; emoji: string }> = {
    bullish:       { color: "text-[#00c805]", label: "Bullish",       emoji: "🐂" },
    cautious:      { color: "text-[#f7c44f]", label: "Cautious",      emoji: "⚠️" },
    defensive:     { color: "text-[#8a8a8a]", label: "Defensive",     emoji: "🛡️" },
    opportunistic: { color: "text-[#4f8ef7]", label: "Opportunistic", emoji: "🎯" },
  };

  if (!fetched && !loading) {
    return (
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 flex flex-col items-center gap-3">
        <Zap size={24} className="text-[#a78bfa]" />
        <div className="text-white font-semibold">AI Theme Analysis</div>
        <div className="text-[#555] text-xs text-center max-w-xs">
          Claude analyses the consensus holdings to identify the dominant macro themes smart money is positioning for
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#a78bfa] hover:bg-[#9370f0] text-white text-xs font-semibold transition-colors"
        >
          <Zap size={12} /> Analyse Themes
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-8 flex flex-col items-center gap-3">
        <RefreshCw size={20} className="text-[#a78bfa] animate-spin" />
        <div className="text-[#555] text-sm">Analysing smart money positioning…</div>
      </div>
    );
  }

  if (!themes || (themes as any).error) {
    return (
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-4">
        <p className="text-[#ff5000] text-xs mb-3">{(themes as any)?.error || "Analysis failed"}</p>
        <button onClick={load} className="text-[#555] text-xs hover:text-[#888] flex items-center gap-1">
          <RefreshCw size={10} /> Retry
        </button>
      </div>
    );
  }

  const sent = SENT[themes.overall_sentiment] ?? SENT.cautious;

  return (
    <div className="space-y-4">
      {/* Overall sentiment */}
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl px-4 py-3 flex items-start gap-3">
        <span className="text-2xl shrink-0">{sent.emoji}</span>
        <div>
          <div className={`text-sm font-bold ${sent.color}`}>Smart Money is {sent.label}</div>
          <p className="text-[#8a8a8a] text-xs mt-0.5 leading-relaxed">{themes.sentiment_reasoning}</p>
        </div>
        <button onClick={load} className="ml-auto text-[#2a2a2a] hover:text-[#555] shrink-0">
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Themes grid */}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
        {themes.themes.map((theme, i) => {
          const cv = CONV[theme.conviction] ?? CONV.medium;
          return (
            <div key={i} className={`border rounded-2xl p-4 ${cv.bg}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{theme.emoji}</span>
                  <div>
                    <div className="text-white font-semibold text-sm">{theme.name}</div>
                    <div className={`text-[9px] uppercase tracking-widest ${cv.color}`}>{theme.conviction} conviction</div>
                  </div>
                </div>
              </div>
              <p className="text-[#8a8a8a] text-xs leading-relaxed mb-2">{theme.headline}</p>
              <p className="text-[#555] text-[10px] leading-relaxed mb-3">{theme.macro_driver}</p>
              {/* Stocks */}
              <div className="flex flex-wrap gap-1 mb-2">
                {theme.stocks.map(s => (
                  <span key={s} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#aaa] border border-[#2a2a2a]">
                    {s}
                  </span>
                ))}
              </div>
              {/* Investors */}
              <div className="text-[#333] text-[9px]">
                Backed by: {theme.investors.join(", ")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Rotating out of */}
      {themes.rotating_out_of && (
        <div className="bg-[#1a0808] border border-[#3a1a1a] rounded-2xl p-4">
          <div className="text-[#ff5000] text-[9px] uppercase tracking-widest mb-1.5 flex items-center gap-1">
            <TrendingDown size={10} /> Smart Money Rotating Out Of
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {themes.rotating_out_of.sectors.map(s => (
              <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-[#2a0a0a] text-[#cc4444] border border-[#3a1a1a]">{s}</span>
            ))}
          </div>
          <p className="text-[#cc4444] text-xs leading-relaxed">{themes.rotating_out_of.reasoning}</p>
        </div>
      )}

      {/* Retail ideas */}
      {themes.retail_ideas?.length > 0 && (
        <div>
          <div className="text-[#555] text-[9px] uppercase tracking-widest mb-2">📌 Actionable Ideas for Retail Investors</div>
          <div className="space-y-2">
            {themes.retail_ideas.map((idea, i) => (
              <div key={i} className="bg-[#141414] border border-[#2a2a2a] rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-white font-bold text-sm">{idea.symbol}</span>
                    <span className="text-[#555] text-xs ml-2">{idea.name}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {idea.backed_by.slice(0, 2).map((inv, j) => (
                      <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-[#1a1a2a] text-[#4488ff]">{inv}</span>
                    ))}
                  </div>
                </div>
                <p className="text-[#7a7a7a] text-xs mt-1 leading-relaxed">{idea.thesis}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SuperInvestorsPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "managers" | "activity">("overview");
  const [managers,   setManagers]   = useState<ManagerMeta[]>([]);
  const [consensus,  setConsensus]  = useState<ConsensusData | null>(null);
  const [activity,   setActivity]   = useState<ActivityItem[]>([]);
  const [portfolios, setPortfolios] = useState<Record<string, InvestorPortfolio>>({});
  const [loading,    setLoading]    = useState(true);
  const [fetching,   setFetching]   = useState(false);
  const [actFilter,  setActFilter]  = useState<"all" | "new" | "add" | "reduce" | "sold_out">("all");

  useEffect(() => {
    Promise.all([
      getSuperInvestorManagers(),
      getSuperInvestorConsensus(),
    ]).then(([mgrs, cons]) => {
      setManagers(mgrs);
      setConsensus(cons);
    }).finally(() => setLoading(false));
  }, []);

  // Lazy-load activity only when that tab is opened
  useEffect(() => {
    if (activeTab === "activity" && activity.length === 0) {
      getSuperInvestorActivity().then(setActivity).catch(() => {});
    }
  }, [activeTab]);

  async function handleFetchAll() {
    setFetching(true);
    try {
      await fetchAllSuperInvestorPortfolios();
      const [mgrs, cons] = await Promise.all([
        getSuperInvestorManagers(),
        getSuperInvestorConsensus(),
      ]);
      setManagers(mgrs);
      setConsensus(cons);
    } finally {
      setFetching(false);
    }
  }

  async function loadPortfolio(code: string) {
    if (portfolios[code]) return;
    const data = await getSuperInvestorPortfolio(code);
    setPortfolios(prev => ({ ...prev, [code]: data }));
    // Refresh consensus with new data
    const cons = await getSuperInvestorConsensus();
    setConsensus(cons);
  }

  // Aggregate stats
  const totalAUM = managers.reduce((s, m) => s + (m.portfolio_value_millions ?? 0), 0);
  const featuredMgrs = managers.filter(m => m.featured);

  const filteredActivity = actFilter === "all"
    ? activity
    : activity.filter(a => a.activity_type === actFilter);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={20} className="text-[#555] animate-spin" />
          <div className="text-[#555] text-sm">Loading smart money data…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">

      {/* ── Header ── */}
      <div className="bg-[#141414] border-b border-[#2a2a2a] px-6 py-5">
        <div className="max-w-[1300px] mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#1a1a2a] flex items-center justify-center">
                <Globe size={16} className="text-[#a78bfa]" />
              </div>
              <div>
                <div className="text-white font-bold text-lg">Smart Money Tracker</div>
                <div className="text-[#555] text-xs">
                  13F filings from the world's most successful fund managers · via Dataroma
                </div>
              </div>
            </div>
            <button
              onClick={handleFetchAll}
              disabled={fetching}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#2a2a2a] text-[#555] text-xs hover:text-[#8a8a8a] hover:border-[#444] transition-colors disabled:opacity-40"
            >
              <RefreshCw size={12} className={fetching ? "animate-spin" : ""} />
              {fetching ? "Fetching…" : "Refresh All"}
            </button>
          </div>

          {/* Stats strip */}
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="text-[#555] text-[10px] uppercase tracking-widest">Investors Tracked</div>
              <div className="text-white font-bold text-xl">{managers.length}</div>
            </div>
            <div className="w-px h-8 bg-[#2a2a2a]" />
            <div>
              <div className="text-[#555] text-[10px] uppercase tracking-widest">Total AUM</div>
              <div className="text-white font-bold text-xl">{fmtB(totalAUM)}</div>
            </div>
            <div className="w-px h-8 bg-[#2a2a2a]" />
            <div>
              <div className="text-[#555] text-[10px] uppercase tracking-widest">Unique Positions</div>
              <div className="text-white font-bold text-xl">
                {consensus?.total_unique_stocks ?? "—"}
              </div>
            </div>
            <div className="w-px h-8 bg-[#2a2a2a]" />
            <div>
              <div className="text-[#555] text-[10px] uppercase tracking-widest">Most Held</div>
              <div className="text-[#a78bfa] font-bold text-xl">
                {consensus?.most_held?.[0]?.symbol ?? "—"}
              </div>
            </div>
            {consensus?.needs_fetch && (
              <div className="ml-auto flex items-center gap-2 bg-[#1a1400] border border-[#3a2a00] rounded-xl px-3 py-2">
                <span className="text-[#f7c44f] text-xs">No portfolio data cached yet.</span>
                <button
                  onClick={handleFetchAll}
                  disabled={fetching}
                  className="text-[#f7c44f] text-xs font-semibold hover:text-white transition-colors disabled:opacity-40"
                >
                  {fetching ? "Fetching…" : "Fetch Now →"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="border-b border-[#1a1a1a] px-6 bg-[#0d0d0d]">
        <div className="max-w-[1300px] mx-auto flex gap-1 py-2">
          {([
            { key: "overview",  label: "📊 Overview",  desc: "Consensus buys, sells & themes" },
            { key: "managers",  label: "👤 Managers",  desc: "Individual investor portfolios" },
            { key: "activity",  label: "⚡ Activity",   desc: "Recent 13F moves" },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === key
                  ? "bg-[#222] text-white"
                  : "text-[#555] hover:text-[#8a8a8a]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-[1300px] mx-auto px-6 py-6">

        {/* ══ OVERVIEW TAB ══ */}
        {activeTab === "overview" && (
          <div className="space-y-8">

            {/* ── Conviction Buys (new positions — highest signal) ── */}
            {consensus?.conviction_buys?.length ? (
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-[#00c805] flex items-center gap-1.5">
                    <Star size={12} className="fill-[#00c805]" /> New Conviction Positions
                  </div>
                  <div className="flex-1 h-px bg-[#1a3a1a]" />
                  <span className="text-[#333] text-[10px]">Fresh buys this quarter — highest signal</span>
                </div>
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                  {consensus.conviction_buys.slice(0, 9).map(s => (
                    <StockConsensusCard key={s.symbol} stock={s} mode="bought" />
                  ))}
                </div>
              </section>
            ) : null}

            {/* ── Smart Money Buying ── */}
            {consensus?.most_bought?.length ? (
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-[#4dbb50] flex items-center gap-1.5">
                    <TrendingUp size={12} /> Smart Money is Adding
                  </div>
                  <div className="flex-1 h-px bg-[#1a2a1a]" />
                  <span className="text-[#333] text-[10px]">Stocks where multiple managers increased position size</span>
                </div>
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                  {consensus.most_bought.slice(0, 12).map(s => (
                    <StockConsensusCard key={s.symbol} stock={s} mode="bought" />
                  ))}
                </div>
              </section>
            ) : null}

            {/* ── Most Widely Held ── */}
            {consensus?.most_held?.length ? (
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-[#a78bfa] flex items-center gap-1.5">
                    <Users size={12} /> Most Widely Held
                  </div>
                  <div className="flex-1 h-px bg-[#2a1a3a]" />
                  <span className="text-[#333] text-[10px]">Stocks held by the most legendary investors simultaneously</span>
                </div>
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                  {consensus.most_held.slice(0, 12).map(s => (
                    <StockConsensusCard key={s.symbol} stock={s} mode="held" />
                  ))}
                </div>
              </section>
            ) : null}

            {/* ── Smart Money Selling ── */}
            {consensus?.most_sold?.length ? (
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-xs font-bold uppercase tracking-widest text-[#ff5000] flex items-center gap-1.5">
                    <TrendingDown size={12} /> Smart Money is Exiting
                  </div>
                  <div className="flex-1 h-px bg-[#3a1a1a]" />
                  <span className="text-[#333] text-[10px]">Stocks being reduced or sold by multiple managers</span>
                </div>
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                  {consensus.most_sold.slice(0, 9).map(s => (
                    <StockConsensusCard key={s.symbol} stock={s} mode="sold" />
                  ))}
                </div>
              </section>
            ) : null}

            {/* ── AI Themes ── */}
            <section>
              <div className="flex items-center gap-3 mb-4">
                <div className="text-xs font-bold uppercase tracking-widest text-[#a78bfa] flex items-center gap-1.5">
                  <Zap size={12} /> AI Investment Themes
                </div>
                <div className="flex-1 h-px bg-[#2a1a3a]" />
                <span className="text-[#333] text-[10px]">Claude synthesises macro themes from what smart money is buying</span>
              </div>
              <ThemesPanel consensus={consensus} />
            </section>

            {/* Empty state */}
            {!consensus?.most_held?.length && !consensus?.needs_fetch && (
              <div className="text-center py-20">
                <Globe size={32} className="text-[#2a2a2a] mx-auto mb-3" />
                <div className="text-[#555] text-sm">No portfolio data yet</div>
                <div className="text-[#333] text-xs mt-1 mb-4">Click "Refresh All" to fetch the latest 13F holdings from Dataroma</div>
                <button
                  onClick={handleFetchAll}
                  disabled={fetching}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#a78bfa] hover:bg-[#9370f0] text-white text-sm font-semibold mx-auto transition-colors disabled:opacity-40"
                >
                  <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
                  {fetching ? "Fetching portfolios…" : "Fetch Smart Money Portfolios"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══ MANAGERS TAB ══ */}
        {activeTab === "managers" && (
          <div className="space-y-6">
            {/* Featured investors */}
            <div>
              <div className="text-[#555] text-[9px] uppercase tracking-widest mb-3">
                Curated Legends ({featuredMgrs.length})
              </div>
              <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
                {featuredMgrs.map(m => (
                  <InvestorCard
                    key={m.code}
                    manager={m}
                    portfolio={portfolios[m.code] ?? null}
                    onLoad={() => loadPortfolio(m.code)}
                  />
                ))}
              </div>
            </div>

            {/* All other managers */}
            {managers.filter(m => !m.featured).length > 0 && (
              <div>
                <div className="text-[#555] text-[9px] uppercase tracking-widest mb-3">
                  All Tracked Managers ({managers.filter(m => !m.featured).length})
                </div>
                <div className="grid gap-2 grid-cols-1 xl:grid-cols-2">
                  {managers.filter(m => !m.featured).slice(0, 30).map(m => (
                    <InvestorCard
                      key={m.code}
                      manager={m}
                      portfolio={portfolios[m.code] ?? null}
                      onLoad={() => loadPortfolio(m.code)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ ACTIVITY TAB ══ */}
        {activeTab === "activity" && (
          <div className="space-y-4">
            {/* Filter bar */}
            <div className="flex items-center gap-2 pb-2 border-b border-[#1a1a1a]">
              <span className="text-[#444] text-[10px]">Filter:</span>
              {([
                { key: "all",      label: "All" },
                { key: "new",      label: "🌟 New" },
                { key: "add",      label: "📈 Added" },
                { key: "reduce",   label: "📉 Reduced" },
                { key: "sold_out", label: "❌ Sold Out" },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActFilter(key)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                    actFilter === key ? "bg-[#222] text-white" : "text-[#555] hover:text-[#8a8a8a]"
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="ml-auto text-[#333] text-[10px]">{filteredActivity.length} moves</span>
            </div>

            {filteredActivity.length === 0 ? (
              <div className="text-center py-16">
                <BarChart2 size={28} className="text-[#2a2a2a] mx-auto mb-3" />
                <div className="text-[#555] text-sm">No activity data</div>
                <div className="text-[#333] text-xs mt-1">Click "Refresh All" to load the latest 13F activity</div>
              </div>
            ) : (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl px-4 py-2">
                {filteredActivity.slice(0, 100).map((item, i) => (
                  <ActivityFeedItem key={i} item={item} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-[1300px] mx-auto px-6 pb-10">
        <div className="bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-3 flex items-start gap-2">
          <span className="text-[#333] text-xs shrink-0">ℹ</span>
          <p className="text-[#333] text-[10px] leading-relaxed">
            Data sourced from Dataroma, which aggregates public 13F filings. 13F filings are submitted quarterly
            and reflect holdings as of the end of each quarter with a 45-day reporting delay. This is not financial
            advice. Past portfolio holdings do not guarantee future returns.
          </p>
        </div>
      </div>
    </div>
  );
}
