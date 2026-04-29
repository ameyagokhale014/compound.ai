import type { Portfolio, RealEstateProperty, CachedBuyTarget } from "../types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PillarScore {
  key: string;
  name: string;
  icon: string;
  score: number;
  maxScore: number;
  details: string[];   // what's working
  gaps: string[];      // what's missing
}

export interface Recommendation {
  id: string;
  emoji: string;
  title: string;
  detail: string;
  potentialGain: number; // estimated score pts to gain
  pillar: string;
  priority: "high" | "medium" | "low";
}

export interface WealthScoreResult {
  total: number;          // 0-100
  grade: string;          // A / B / C / D / F
  gradeLabel: string;
  gradeColor: string;
  pillars: PillarScore[];
  recommendations: Recommendation[];
  summary: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RETIREMENT_TYPES = new Set(["roth_ira", "traditional_ira", "401k"]);

const SIGNAL_WEIGHT: Record<string, number> = {
  strong_buy: 1.0,
  buy: 0.75,
  near_target: 0.5,
  above_target: 0.0,
};

function fmtUSD(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n);
}

// ─── Scoring rubric ──────────────────────────────────────────────────────────
//
//  PILLAR 1 — Diversification          25 pts
//    ↳ Asset class spread (stocks, RE, retirement, crypto)  10 pts
//    ↳ Sector diversity within equities                      9 pts
//    ↳ Single-holding concentration risk                     6 pts
//
//  PILLAR 2 — Cash Management          20 pts
//    ↳ Idle cash as % of total net worth (ideal 3-8%)       20 pts
//
//  PILLAR 3 — Buy Discipline           20 pts
//    ↳ Weighted % of portfolio value at/below buy targets   20 pts
//
//  PILLAR 4 — Retirement Readiness     20 pts
//    ↳ Has retirement accounts (base)                        6 pts
//    ↳ Retirement % of total investable assets              14 pts
//
//  PILLAR 5 — Portfolio Health         15 pts
//    ↳ Real estate equity                                    5 pts
//    ↳ Positive overall unrealized gains                     6 pts
//    ↳ Multi-account structure (retirement + non-ret)        4 pts
//
//  TOTAL                              100 pts
//
//  Grade scale: A ≥85 · B ≥70 · C ≥55 · D ≥40 · F <40

export function computeWealthScore(
  portfolios: Portfolio[],
  properties: RealEstateProperty[],
  buyTargets: Map<string, CachedBuyTarget>,
  sectors: Record<string, string>,
): WealthScoreResult {

  // ── Base aggregates ───────────────────────────────────────────────────────
  const totalCash = portfolios.reduce((s, p) => s + p.cash_balance, 0);

  const totalStockValue = portfolios.reduce(
    (s, p) => s + p.holdings.reduce(
      (hs, h) => hs + (h.asset_type !== "cash" ? h.current_value : 0), 0,
    ), 0,
  );

  const totalCost       = portfolios.reduce((s, p) => s + p.total_cost, 0);
  const totalGainLoss   = portfolios.reduce((s, p) => s + p.total_gain_loss, 0);
  const totalREEquity   = properties.reduce((s, p) => s + p.equity, 0);
  const totalNetWorth   = totalStockValue + totalCash + totalREEquity;
  const totalInvestable = totalStockValue + totalCash;   // RE excluded for ret% calc

  const retirementPortfolios  = portfolios.filter(p => RETIREMENT_TYPES.has(p.account_type));
  const nonRetirementPortfolios = portfolios.filter(p => !RETIREMENT_TYPES.has(p.account_type));
  const retirementValue       = retirementPortfolios.reduce((s, p) => s + p.total_value, 0);

  const hasCrypto     = portfolios.some(p => p.holdings.some(h => h.asset_type === "crypto"));
  const hasStocks     = totalStockValue > 0;
  const hasRealEstate = totalREEquity > 0;
  const hasRetirement = retirementPortfolios.length > 0;
  const hasNonRetirement = nonRetirementPortfolios.length > 0;

  // Unique sectors
  const uniqueSectors = new Set<string>();
  for (const p of portfolios) {
    for (const h of p.holdings) {
      if (h.asset_type === "cash" || h.current_value <= 0) continue;
      const sec = sectors[h.symbol];
      if (sec && sec !== "Unknown") uniqueSectors.add(sec);
    }
  }
  const nSectors = uniqueSectors.size;

  // Top single-holding concentration
  const holdingMap = new Map<string, number>();
  for (const p of portfolios) {
    for (const h of p.holdings) {
      if (h.asset_type === "cash") continue;
      holdingMap.set(h.symbol, (holdingMap.get(h.symbol) ?? 0) + h.current_value);
    }
  }
  const sortedHoldings = [...holdingMap.entries()].sort((a, b) => b[1] - a[1]);
  const topHoldingValue  = sortedHoldings[0]?.[1] ?? 0;
  const topHoldingSymbol = sortedHoldings[0]?.[0] ?? null;
  const topHoldingPct    = totalStockValue > 0 ? (topHoldingValue / totalStockValue) * 100 : 0;

  // ── PILLAR 1: DIVERSIFICATION (25 pts) ───────────────────────────────────
  let div_score = 0;
  const div_details: string[] = [];
  const div_gaps: string[] = [];

  // Sub-pillar 1a: Asset class spread (10 pts)
  let asset_pts = 0;
  if (hasStocks)     { asset_pts += 3; div_details.push("Stock portfolio established"); }
  if (hasRealEstate) { asset_pts += 3; div_details.push("Real estate equity building"); }
  if (hasRetirement) { asset_pts += 2; div_details.push("Retirement accounts active"); }
  if (hasCrypto)     { asset_pts += 2; div_details.push("Alternative assets (crypto) present"); }
  if (!hasRealEstate) div_gaps.push("No real estate — consider property or REIT ETFs");
  if (!hasRetirement) div_gaps.push("No retirement accounts detected");
  if (!hasCrypto)     div_gaps.push("No alternative assets (crypto, commodities)");

  // Sub-pillar 1b: Sector diversity (9 pts)
  let sector_pts = 0;
  if (nSectors === 0)      { sector_pts = 0; }
  else if (nSectors === 1) { sector_pts = 1; div_gaps.push("Concentrated in only 1 sector"); }
  else if (nSectors === 2) { sector_pts = 3; div_gaps.push("Only 2 sectors — broaden your exposure"); }
  else if (nSectors <= 4)  { sector_pts = 6; div_details.push(`${nSectors} sectors covered`); div_gaps.push("Add 1-2 more sectors for stronger diversification"); }
  else                     { sector_pts = 9; div_details.push(`Well spread across ${nSectors} sectors`); }

  // Sub-pillar 1c: Concentration risk (6 pts)
  let conc_pts = 0;
  if (totalStockValue === 0) {
    conc_pts = 0;
  } else if (topHoldingPct > 50) {
    conc_pts = 0;
    div_gaps.push(`${topHoldingSymbol} is ${topHoldingPct.toFixed(0)}% of your portfolio — dangerously concentrated`);
  } else if (topHoldingPct > 35) {
    conc_pts = 2;
    div_gaps.push(`${topHoldingSymbol} is ${topHoldingPct.toFixed(0)}% of your stock portfolio — consider trimming`);
  } else if (topHoldingPct > 20) {
    conc_pts = 4;
    div_details.push("Single-stock concentration within acceptable range");
  } else {
    conc_pts = 6;
    div_details.push("No dangerous single-stock concentration");
  }

  div_score = asset_pts + sector_pts + conc_pts;

  // ── PILLAR 2: CASH MANAGEMENT (20 pts) ───────────────────────────────────
  let cash_score = 0;
  const cash_details: string[] = [];
  const cash_gaps: string[] = [];
  const cashPct = totalNetWorth > 0 ? (totalCash / totalNetWorth) * 100 : 0;

  if      (cashPct < 1)   { cash_score = 4;  cash_gaps.push("Almost no liquidity — severely under-reserved"); cash_gaps.push("Build a cash buffer equal to 3-8% of net worth"); }
  else if (cashPct < 3)   { cash_score = 9;  cash_gaps.push(`Cash at ${cashPct.toFixed(1)}% — slightly low, target 3-8%`); }
  else if (cashPct <= 8)  { cash_score = 20; cash_details.push(`Cash at ${cashPct.toFixed(1)}% of net worth — ideal range (3-8%)`); }
  else if (cashPct <= 15) { cash_score = 14; cash_details.push(`Cash at ${cashPct.toFixed(1)}%`); cash_gaps.push("Slightly elevated — consider deploying excess into investments"); }
  else if (cashPct <= 25) { cash_score = 8;  cash_gaps.push(`${cashPct.toFixed(1)}% in cash — meaningful drag on returns`); }
  else if (cashPct <= 40) { cash_score = 4;  cash_gaps.push(`${cashPct.toFixed(1)}% in cash — losing ground to inflation`); }
  else                    { cash_score = 1;  cash_gaps.push(`${cashPct.toFixed(1)}% in cash — critical drag, deploy capital`); }

  // ── PILLAR 3: BUY DISCIPLINE (20 pts) ────────────────────────────────────
  let buy_score = 10; // neutral until data loads
  const buy_details: string[] = [];
  const buy_gaps: string[] = [];
  let aboveTargetPct = 0;

  let weightedSum = 0;
  let totalWeight = 0;
  let aboveTargetValue = 0;

  for (const p of portfolios) {
    for (const h of p.holdings) {
      if (h.asset_type === "cash" || h.current_value <= 0) continue;
      const bt = buyTargets.get(h.symbol);
      if (bt?.signal) {
        const w = SIGNAL_WEIGHT[bt.signal] ?? 0;
        weightedSum  += h.current_value * w;
        totalWeight  += h.current_value;
        if (bt.signal === "above_target") aboveTargetValue += h.current_value;
      }
    }
  }

  if (totalWeight > 0) {
    aboveTargetPct = (aboveTargetValue / totalWeight) * 100;
    const weightedAvg = weightedSum / totalWeight;
    buy_score = Math.round(weightedAvg * 20);

    if (buy_score >= 16)      { buy_details.push("Most holdings at/below buy targets — excellent entry discipline"); }
    else if (buy_score >= 12) { buy_details.push("Good mix of positions at or below targets"); buy_gaps.push("Some holdings above buy target — hold off on adding to those"); }
    else if (buy_score >= 8)  { buy_gaps.push(`${aboveTargetPct.toFixed(0)}% of portfolio is above buy targets`); buy_gaps.push("DCA into holdings at/below target price"); }
    else                      { buy_gaps.push(`${aboveTargetPct.toFixed(0)}% of portfolio is above buy targets`); buy_gaps.push("Consider waiting for pullbacks before new buys"); }
  } else {
    buy_details.push("Buy target signals loading…");
  }

  // ── PILLAR 4: RETIREMENT READINESS (20 pts) ──────────────────────────────
  let ret_score = 0;
  const ret_details: string[] = [];
  const ret_gaps: string[] = [];

  if (!hasRetirement) {
    ret_gaps.push("No retirement accounts — open an IRA or maximize your 401k");
    ret_gaps.push("Tax-advantaged compounding is one of the most powerful wealth tools");
  } else {
    ret_score += 6;
    ret_details.push("Retirement accounts established");

    const retPct = totalInvestable > 0 ? (retirementValue / totalInvestable) * 100 : 0;
    if      (retPct < 5)  { ret_score += 3;  ret_gaps.push(`Only ${retPct.toFixed(0)}% of investments in retirement — significantly underfunded`); }
    else if (retPct < 15) { ret_score += 7;  ret_gaps.push("Increase contributions to 15-30% of total investable assets"); ret_details.push(`${retPct.toFixed(0)}% in retirement accounts`); }
    else if (retPct < 30) { ret_score += 11; ret_details.push(`${retPct.toFixed(0)}% in retirement — solid allocation`); }
    else                  { ret_score += 14; ret_details.push(`${retPct.toFixed(0)}% in retirement accounts — excellent`); }
  }

  // ── PILLAR 5: PORTFOLIO HEALTH (15 pts) ──────────────────────────────────
  let health_score = 0;
  const health_details: string[] = [];
  const health_gaps: string[] = [];

  // Real estate (5 pts)
  if (hasRealEstate) {
    health_score += 5;
    health_details.push(`Real estate equity: ${fmtUSD(totalREEquity)}`);
  } else {
    health_gaps.push("No real estate — consider property for long-term equity building");
  }

  // Portfolio returns (up to 6 pts)
  if (totalCost > 0) {
    const gainPct = (totalGainLoss / totalCost) * 100;
    if (totalGainLoss > 0) {
      health_score += gainPct > 20 ? 6 : 4;
      health_details.push(`Portfolio up ${gainPct.toFixed(1)}% unrealized`);
    } else {
      health_gaps.push(`Portfolio down ${Math.abs(gainPct).toFixed(1)}% unrealized`);
    }
  }

  // Multi-account structure (4 pts)
  if (hasRetirement && hasNonRetirement) {
    health_score += 4;
    health_details.push("Balanced retirement + brokerage account structure");
  } else if (portfolios.length > 1) {
    health_score += 2;
  } else {
    health_gaps.push("Add both retirement and non-retirement accounts for tax efficiency");
  }

  health_score = Math.min(health_score, 15);

  // ── Final total ───────────────────────────────────────────────────────────
  const total = Math.min(
    Math.round(div_score + cash_score + buy_score + ret_score + health_score),
    100,
  );

  // ── Grade ─────────────────────────────────────────────────────────────────
  let grade = "F", gradeLabel = "Critical", gradeColor = "#ff4444";
  if      (total >= 85) { grade = "A"; gradeLabel = "Excellent";        gradeColor = "#00c805"; }
  else if (total >= 70) { grade = "B"; gradeLabel = "Good";             gradeColor = "#4dbb50"; }
  else if (total >= 55) { grade = "C"; gradeLabel = "Fair";             gradeColor = "#f7c44f"; }
  else if (total >= 40) { grade = "D"; gradeLabel = "Needs Improvement";gradeColor = "#ff8800"; }

  // ── Recommendations ───────────────────────────────────────────────────────
  const recs: Recommendation[] = [];

  // Cash
  if (cashPct > 25) {
    recs.push({ id: "cash-high", emoji: "💸", title: "Deploy Excess Cash",
      detail: `${cashPct.toFixed(0)}% of your net worth sits in cash. Target 3-8% for liquidity and invest the rest — every idle dollar loses ~3% annually to inflation.`,
      potentialGain: 20 - cash_score, pillar: "Cash Management", priority: "high" });
  } else if (cashPct < 3 && totalNetWorth > 0) {
    recs.push({ id: "cash-low", emoji: "🏦", title: "Build a Cash Buffer",
      detail: "You're below 3% liquid cash. Without reserves, a market downturn may force you to sell investments at the worst time. Aim for 3-8% in accessible savings.",
      potentialGain: 20 - cash_score, pillar: "Cash Management", priority: "high" });
  }

  // Retirement
  if (!hasRetirement) {
    recs.push({ id: "no-retirement", emoji: "🎯", title: "Open a Retirement Account",
      detail: "No IRA or 401k detected. Tax-advantaged compounding is the single most powerful wealth accelerator available. Open a Roth IRA if income-eligible, or maximize your employer 401k match first.",
      potentialGain: 20, pillar: "Retirement Readiness", priority: "high" });
  } else if (ret_score < 15) {
    const retPct = totalInvestable > 0 ? (retirementValue / totalInvestable) * 100 : 0;
    recs.push({ id: "low-retirement", emoji: "📈", title: "Increase Retirement Contributions",
      detail: `Only ${retPct.toFixed(0)}% of your investments are tax-advantaged. Aim for 15-30% — the tax-free or tax-deferred growth compounds dramatically over decades.`,
      potentialGain: 20 - ret_score, pillar: "Retirement Readiness", priority: "high" });
  }

  // Concentration risk
  if (topHoldingPct > 35 && topHoldingSymbol) {
    recs.push({ id: "concentration", emoji: "⚖️", title: `Reduce ${topHoldingSymbol} Concentration`,
      detail: `${topHoldingSymbol} is ${topHoldingPct.toFixed(0)}% of your stock portfolio. A single bad quarter could significantly damage your wealth. Trim toward 15-20% max per holding.`,
      potentialGain: 6 - conc_pts, pillar: "Diversification", priority: topHoldingPct > 50 ? "high" : "medium" });
  }

  // Sector diversity
  if (nSectors < 4) {
    recs.push({ id: "sector-diversity", emoji: "🌐", title: "Diversify Across More Sectors",
      detail: `You have exposure to only ${nSectors || 0} sector${nSectors !== 1 ? "s" : ""}. Sector risk means one regulatory change or economic shift can hit your whole portfolio. Add Healthcare, Consumer Staples, Utilities, or Financials.`,
      potentialGain: 9 - sector_pts, pillar: "Diversification", priority: "medium" });
  }

  // Buy discipline
  if (buy_score < 12 && totalWeight > 0) {
    recs.push({ id: "buy-discipline", emoji: "🎯", title: "Improve Entry Discipline",
      detail: `${aboveTargetPct.toFixed(0)}% of your stock value is above its calculated buy target. Avoid adding to overpriced positions. Redirect new capital to holdings flagged as Buy or Strong Buy.`,
      potentialGain: 20 - buy_score, pillar: "Buy Discipline", priority: aboveTargetPct > 60 ? "high" : "medium" });
  }

  // Real estate
  if (!hasRealEstate) {
    recs.push({ id: "no-real-estate", emoji: "🏠", title: "Add Real Estate Exposure",
      detail: "Real estate historically provides inflation protection, passive income, and non-correlated returns. Even a REIT ETF (like VNQ) adds meaningful diversification without property management.",
      potentialGain: 5, pillar: "Portfolio Health", priority: "medium" });
  }

  // Crypto/alternatives
  if (!hasCrypto && totalNetWorth > 50000) {
    recs.push({ id: "no-alternatives", emoji: "₿", title: "Explore Alternative Assets",
      detail: "A modest 2-5% allocation to crypto or commodities improves portfolio diversification and provides exposure to non-correlated return streams. Keep it disciplined and sized accordingly.",
      potentialGain: 2, pillar: "Diversification", priority: "low" });
  }

  // Sort: potential gain desc → priority
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => {
    if (b.potentialGain !== a.potentialGain) return b.potentialGain - a.potentialGain;
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  // Summary sentence
  let summary = "";
  if      (total >= 85) summary = "Your wealth is well-structured across all key pillars. Stay the course.";
  else if (total >= 70) summary = "Solid foundation — a few targeted moves will push you into excellent territory.";
  else if (total >= 55) summary = "Good start with clear gaps. Focused action on the recommendations below will meaningfully improve your score.";
  else if (total >= 40) summary = "Several structural gaps are holding your wealth back. Prioritize the high-impact recommendations below.";
  else                  summary  = "Your portfolio needs significant restructuring. Start with the high-priority actions — they will have the most impact.";

  return {
    total,
    grade,
    gradeLabel,
    gradeColor,
    pillars: [
      { key: "diversification", name: "Diversification",      icon: "🌐", score: div_score,    maxScore: 25, details: div_details,    gaps: div_gaps    },
      { key: "cash",            name: "Cash Management",      icon: "💰", score: cash_score,   maxScore: 20, details: cash_details,   gaps: cash_gaps   },
      { key: "buy_discipline",  name: "Buy Discipline",       icon: "🎯", score: buy_score,    maxScore: 20, details: buy_details,    gaps: buy_gaps    },
      { key: "retirement",      name: "Retirement Readiness", icon: "🏦", score: ret_score,    maxScore: 20, details: ret_details,    gaps: ret_gaps    },
      { key: "health",          name: "Portfolio Health",     icon: "💪", score: health_score, maxScore: 15, details: health_details, gaps: health_gaps },
    ],
    recommendations: recs.slice(0, 6),
    summary,
  };
}
