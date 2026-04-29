import axios from "axios";
import type { Portfolio, ChartPoint, SearchResult, Period } from "./types";

const BASE = "http://localhost:8000";
const api = axios.create({ baseURL: BASE });

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

// Attach stored Anthropic key to AI requests
api.interceptors.request.use((config) => {
  const aiRoutes = ["/ai-buy-targets", "/advisor", "/popi", "/earnings", "/simulation"];
  if (aiRoutes.some(r => config.url?.includes(r))) {
    const key = localStorage.getItem("anthropic_api_key");
    if (key) config.headers.set("X-Api-Key", key);
  }
  return config;
});

export const getPortfolios = () => api.get<Portfolio[]>("/portfolios/").then((r) => r.data);
export const getPortfolio = (id: number) => api.get<Portfolio>(`/portfolios/${id}`).then((r) => r.data);
export const createPortfolio = (
  name: string,
  account_type?: string,
  company_name?: string,
  employer_status?: string,
) => api.post<Portfolio>("/portfolios/", { name, account_type, company_name, employer_status }).then((r) => r.data);
export const updatePortfolio = (id: number, name: string, cash_balance?: number) =>
  api.put<Portfolio>(`/portfolios/${id}`, { name, cash_balance }).then((r) => r.data);
export const deletePortfolio = (id: number) => api.delete(`/portfolios/${id}`);

export const addHolding = (
  portfolioId: number,
  data: {
    symbol: string;
    name: string;
    asset_type: string;
    quantity: number;
    buy_price: number;
    purchased_at?: string;
  }
) => api.post<Portfolio>(`/portfolios/${portfolioId}/holdings`, data).then((r) => r.data);

export const addTransaction = (
  portfolioId: number,
  holdingId: number,
  data: { quantity: number; buy_price: number; purchased_at?: string }
) =>
  api
    .post<Portfolio>(`/portfolios/${portfolioId}/holdings/${holdingId}/transactions`, data)
    .then((r) => r.data);

export const deleteHolding = (portfolioId: number, holdingId: number) =>
  api.delete(`/portfolios/${portfolioId}/holdings/${holdingId}`);

export const sellHolding = (
  portfolioId: number,
  holdingId: number,
  data: { quantity: number; sell_price: number }
) => api.post<import("./types").Portfolio>(`/portfolios/${portfolioId}/holdings/${holdingId}/sell`, data).then((r) => r.data);

export const deleteTransaction = (portfolioId: number, holdingId: number, txId: number) =>
  api.delete(`/portfolios/${portfolioId}/holdings/${holdingId}/transactions/${txId}`);

export const getPortfolioHistory = (portfolioId: number, period: Period) =>
  api.get<ChartPoint[]>(`/portfolios/${portfolioId}/history`, { params: { period } }).then((r) => r.data);

export const getTotalHistory = (period: Period) =>
  api.get<ChartPoint[]>("/portfolios/total-history", { params: { period } }).then((r) => r.data);

export const searchSymbols = (q: string) =>
  api.get<SearchResult[]>("/search/", { params: { q } }).then((r) => r.data);

export const getRealEstate = () =>
  api.get<import("./types").RealEstateProperty[]>("/real-estate/").then((r) => r.data);

export const addRealEstate = (data: { address: string; estimated_value: number; ownership_pct: number }) =>
  api.post<import("./types").RealEstateProperty>("/real-estate/", data).then((r) => r.data);

export const updateRealEstate = (
  id: number,
  data: { address?: string; estimated_value?: number; ownership_pct?: number }
) => api.put<import("./types").RealEstateProperty>(`/real-estate/${id}`, data).then((r) => r.data);

export const deleteRealEstate = (id: number) => api.delete(`/real-estate/${id}`);

export const askAdvisor = (question?: string) =>
  api.post<{ response: string }>("/advisor", { question }).then((r) => r.data);

export const askPopi = (data: {
  goals: string[];
  risk_appetite: string;
  follow_up?: string;
  history?: { role: string; content: string }[];
  mode?: string;
}) => api.post<{ response: string; structured?: any }>("/popi", data).then((r) => r.data);

export const getBuyTargets = (portfolioId: number, cagr: number) =>
  api.get<import("./types").BuyTarget[]>(`/portfolios/${portfolioId}/buy-targets`, { params: { cagr } }).then((r) => r.data);

export const getAiBuyTargets = (portfolioId: number, cagrMap: Record<string, number>) =>
  api.post<import("./types").AiBuyTarget[]>(`/portfolios/${portfolioId}/ai-buy-targets`, { cagr_map: cagrMap }).then((r) => r.data);

export const getCachedBuyTargets = (symbols: string[]) =>
  api.get<import("./types").CachedBuyTarget[]>("/cached-buy-targets/", { params: { symbols: symbols.join(",") } }).then((r) => r.data);

export const refreshCachedBuyTargets = (symbols?: string[]) =>
  api.post<{ ok: boolean; count: number }>("/cached-buy-targets/refresh", { symbols: symbols ?? null }).then((r) => r.data);

export const getStockData = (symbol: string, refresh = false) =>
  api.get<any>(`/stocks/${symbol}`, { params: refresh ? { refresh: true } : {} }).then((r) => r.data);

export const getStockPriceHistory = (symbol: string, period = "1Y") =>
  api.get<{ date: string; close: number; volume: number }[]>(`/stocks/${symbol}/price-history`, { params: { period } }).then((r) => r.data);

export const getStockSectors = (symbols: string[]) =>
  api.get<Record<string, string>>("/stocks/sectors", { params: { symbols: symbols.join(",") } }).then((r) => r.data);

export const getWatchlist = () =>
  api.get<import("./types").WatchlistItem[]>("/watchlist/").then((r) => r.data);

export const addToWatchlist = (symbol: string, name?: string) =>
  api.post<import("./types").WatchlistItem>("/watchlist/", { symbol, name }).then((r) => r.data);

export const removeFromWatchlist = (id: number) =>
  api.delete(`/watchlist/${id}`);

export const getNews = (symbols: string[], includeRE = false, limit = 100) =>
  api.get<import("./types").NewsItem[]>("/news/", {
    params: { symbols: symbols.join(","), include_re: includeRE, limit },
  }).then((r) => r.data);

export const refreshNews = () =>
  api.post<{ ok: boolean; new_articles: number }>("/news/refresh").then((r) => r.data);

export const getNewsLastRefresh = () =>
  api.get<{ last_refresh: string | null }>("/news/last-refresh").then((r) => r.data);

export const recordActivity = (data: {
  page?: string;
  wealth_score?: number;
  net_worth?: number;
}) => api.post<{ ok: boolean; date: string }>("/achievements/activity", data).then((r) => r.data);

export const getAchievements = () =>
  api.get<{
    streaks: { login: number; news: number; recs: number };
    badges: Array<{
      key: string; emoji: string; name: string; desc: string;
      category: string; rarity: string;
      earned: boolean; progress: number; progress_label: string;
    }>;
    earned_count: number;
    total_count: number;
    next_up: Array<{
      key: string; emoji: string; name: string; desc: string;
      category: string; rarity: string;
      earned: boolean; progress: number; progress_label: string;
    }>;
  }>("/achievements/").then((r) => r.data);

// ── Simulation (Popi as portfolio manager) ────────────────────────────────────
export interface SimGoalIn { name: string; amount: number; years: number; priority?: number; }
export interface SimHoldingOut {
  symbol: string; name: string; quantity: number; avg_cost: number;
  current_price: number; current_value: number; total_cost: number;
  gain_loss: number; gain_loss_pct: number;
  target_pct: number | null; rationale: string | null; asset_class: string | null;
}
export interface SimTradeOut {
  symbol: string; action: "buy" | "sell"; quantity: number;
  price: number; amount: number; reason: string | null; executed_at: string;
}
export interface SimState {
  id: number;
  principal: number; total_contributed: number; cash_balance: number;
  total_value: number; total_invested: number;
  monthly_salary: number | null; risk_appetite: string;
  plan: any | null;
  goals: { id: number; name: string; amount: number; years: number; priority: number }[];
  holdings: SimHoldingOut[];
  trades: SimTradeOut[];
  gain_loss: number; gain_loss_pct: number;
  bench_return_pct: number | null;
  created_at: string; last_traded: string | null;
}

export const getSimulation     = () =>
  api.get<SimState | null>("/simulation/").then((r) => r.data);

export const createSimulation  = (data: {
  principal: number; monthly_salary?: number; monthly_contribution?: number;
  risk_appetite: string; goals: SimGoalIn[];
}) => api.post<SimState | { error: string }>("/simulation/", data).then((r) => r.data);

export const resetSimulation   = () =>
  api.delete("/simulation/").then((r) => r.data);

export const popiTrade         = () =>
  api.post<{ popi_comment: string; should_rebalance: boolean; trades_executed: any[]; state: SimState } | { error: string }>
  ("/simulation/trade").then((r) => r.data);

export const contribute        = (amount: number) =>
  api.post<{ popi_comment: string; state: SimState } | { error: string }>
  ("/simulation/contribute", { amount }).then((r) => r.data);

export const updateSimSettings = (data: {
  risk_appetite?: string;
  goals?: SimGoalIn[];
  monthly_salary?: number | null;
}) => api.post<{ popi_comment: string; state: SimState } | { error: string }>
  ("/simulation/settings", data).then((r) => r.data);

export interface ProposedTrade {
  symbol: string;
  action: "buy" | "sell";
  amount_usd: number;
  reason: string;
}

export const suggestChanges = (message: string) =>
  api.post<{
    popi_comment: string;
    proposed_trades: ProposedTrade[];
    no_change_needed: boolean;
  } | { error: string }>("/simulation/suggest", { message }).then((r) => r.data);

export const executeProposedTrades = (trades: ProposedTrade[]) =>
  api.post<{ state: SimState } | { error: string }>
    ("/simulation/execute-trades", { trades }).then((r) => r.data);

// ── Earnings Intelligence ─────────────────────────────────────────────────────
export interface EarningsSurprise {
  date: string; eps_estimate: number; eps_actual: number; surprise_pct: number;
}
export interface EarningsAI {
  what_to_watch: string[];
  price_move_prediction: "likely_up" | "likely_down" | "neutral" | "volatile";
  predicted_move_range: string;
  action: "buy_before" | "hold" | "trim" | "avoid";
  setup_quality: "strong" | "mixed" | "weak";
  confidence: number;
  reasoning: string;
  key_risk: string;
  key_catalyst: string;
  // Bridge fields — last call → this call
  guidance_delivered?: "on_track" | "ahead_of_guidance" | "behind_guidance" | "unknown";
  guidance_check_reasoning?: string;
  beat_probability?: { eps: string; revenue: string };
  error?: string;
}
export interface EarningsItem {
  symbol: string; name: string; source: "portfolio" | "watchlist";
  next_earnings_date: string | null; earnings_time: string;
  eps_estimate: number | null; revenue_estimate: number | null;
  surprise_history: EarningsSurprise[];
  current_price: number | null; analyst_target: number | null;
  forward_pe: number | null; sector: string | null; long_name: string;
  ai_analysis: EarningsAI | null;
  last_fetched: string | null; last_analyzed: string | null;
}

export const getEarnings = () =>
  api.get<EarningsItem[]>("/earnings/").then((r) => r.data);

export const refreshEarnings = () =>
  api.post<{ ok: boolean; count: number }>("/earnings/refresh").then((r) => r.data);

export const analyzeEarnings = (
  symbol: string,
  position?: { quantity?: number; avg_cost?: number; gain_loss?: number; gain_loss_pct?: number }
) => api.post<EarningsAI | { error: string }>(`/earnings/${symbol}/analyze`, position ?? {})
       .then((r) => r.data);

export interface EarningsCallSummary {
  quarter: string;
  call_date: string;
  headline: string;
  what_happened: string;
  vs_estimates: string;
  management_tone: "optimistic" | "cautious" | "neutral" | "mixed";
  key_highlights: string[];
  guidance: string;
  near_term_outlook: string;
  long_term_outlook: string;
  price_reaction_pct: number | null;
  eps_surprise_pct: number | null;
  action: "buy" | "hold" | "trim" | "sell";
  action_reasoning: string;
  risk: string;
  error?: string;
}

export interface RecentEarningsSummary {
  symbol: string;
  name: string;
  source: "portfolio" | "watchlist";
  call_date: string | null;
  quarter: string | null;
  headline: string | null;
  action: string | null;
  management_tone: string | null;
  eps_surprise_pct: number | null;
  price_reaction_pct: number | null;
  near_term_outlook: string | null;
  last_summarized: string | null;
}

export const getEarningsCallSummary = (symbol: string) => {
  const key = localStorage.getItem("anthropic_api_key");
  return api.post<EarningsCallSummary | { error: string }>(
    `/earnings/${symbol}/call-summary`,
    {},
    { headers: key ? { "X-Api-Key": key } : {} }
  ).then((r) => r.data);
};

export const getRecentEarningsSummaries = () =>
  api.get<RecentEarningsSummary[]>("/earnings/recent-summaries").then((r) => r.data);

// ── Technical Signals ─────────────────────────────────────────────────────────
export interface TechnicalSignal {
  id: string;
  name: string;
  category: string;
  direction: "bullish" | "bearish" | "neutral";
  strength: "strong" | "moderate" | "weak";
  score: number;
  title: string;
  what_it_is: string;
  threshold: string;
  what_it_means_now: string;
  action: string;
  values: Record<string, number | boolean | null>;
}

export interface SignalInsight {
  verdict: "bullish" | "bearish" | "neutral" | "mixed";
  headline: string;
  insight: string;
  key_action: string;
  main_risk: string;
}

export interface ChartRow {
  date: string;
  close: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema9: number | null;
  ema21: number | null;
  rsi: number | null;
  macd: number | null;
  macd_signal: number | null;
  macd_hist: number | null;
  bb_upper: number | null;
  bb_lower: number | null;
  bb_mid: number | null;
  vol_ma20: number | null;
  obv: number | null;
}

export interface SignalsResponse {
  symbol: string;
  name: string;
  score: number;
  signals: TechnicalSignal[];
  chart_data: ChartRow[];
  ai_insight: SignalInsight | null;
  error?: string;
}

export interface SignalAlert {
  symbol: string;
  score: number;
  verdict: "bullish" | "bearish";
  price: number | null;
  top_signals: TechnicalSignal[];
}

export const getSignals = (symbol: string, insight = false) => {
  const key = localStorage.getItem("anthropic_api_key");
  return api.get<SignalsResponse>(`/signals/${symbol}`, {
    params: { insight },
    headers: insight && key ? { "X-Api-Key": key } : {},
  }).then((r) => r.data);
};

export const getSignalAlerts = () =>
  api.get<SignalAlert[]>("/signals/alerts/scan").then((r) => r.data);

// ── Superinvestors ────────────────────────────────────────────────────────────

export interface ManagerMeta {
  code: string;
  name: string;
  display_name: string;
  firm: string;
  known_for: string;
  style: string;
  emoji: string;
  portfolio_value_millions: number | null;
  num_stocks: number | null;
  turnover: string;
  reported: string;
  featured: boolean;
}

export interface HolderInfo {
  manager_code: string;
  manager_name: string;
  firm: string;
  emoji: string;
  pct_portfolio: number | null;
  activity: string;
  activity_pct: number | null;
  activity_text: string;
  num_shares: number | null;
  value_millions: number | null;
}

export interface ConsensusStock {
  symbol: string;
  name: string;
  num_holders: number;
  num_buyers: number;
  num_sellers: number;
  avg_pct_portfolio: number | null;
  holders: HolderInfo[];
  buyers: HolderInfo[];
  sellers: HolderInfo[];
}

export interface ConsensusData {
  most_held: ConsensusStock[];
  most_bought: ConsensusStock[];
  most_sold: ConsensusStock[];
  conviction_buys: ConsensusStock[];
  total_managers: number;
  total_unique_stocks: number;
  needs_fetch?: boolean;
}

export interface PortfolioHolding {
  symbol: string;
  name: string;
  pct_portfolio: number | null;
  num_shares: number | null;
  reported_price: number | null;
  value_millions: number | null;
  activity: string;
  activity_pct: number | null;
  activity_text: string;
}

export interface InvestorPortfolio {
  code: string;
  display_name: string;
  firm: string;
  emoji: string;
  known_for: string;
  style: string;
  holdings: PortfolioHolding[];
  aum: string | null;
  reported_date: string | null;
  error?: string;
}

export interface ActivityItem {
  date: string;
  manager_code: string;
  manager_name: string;
  firm: string;
  emoji: string;
  activity_type: string;
  activity_text: string;
  change_pct: number | null;
  symbol: string;
  stock_name: string;
  pct_portfolio: number | null;
  price: number | null;
}

export interface InvestmentTheme {
  name: string;
  emoji: string;
  headline: string;
  stocks: string[];
  investors: string[];
  macro_driver: string;
  conviction: "high" | "medium" | "low";
}

export interface ThemesData {
  themes: InvestmentTheme[];
  rotating_out_of: { sectors: string[]; reasoning: string };
  retail_ideas: { symbol: string; name: string; thesis: string; backed_by: string[] }[];
  overall_sentiment: string;
  sentiment_reasoning: string;
  error?: string;
}

export const getSuperInvestorManagers = () =>
  api.get<ManagerMeta[]>("/superinvestors/managers").then((r) => r.data);

export const getSuperInvestorPortfolio = (code: string) =>
  api.get<InvestorPortfolio>(`/superinvestors/portfolio/${code}`).then((r) => r.data);

export const getSuperInvestorActivity = () =>
  api.get<ActivityItem[]>("/superinvestors/activity").then((r) => r.data);

export const getSuperInvestorConsensus = () =>
  api.get<ConsensusData>("/superinvestors/consensus").then((r) => r.data);

export const fetchAllSuperInvestorPortfolios = () =>
  api.post<{ ok: boolean; fetched: number; total: number }>("/superinvestors/fetch-all").then((r) => r.data);

export const analyzeSuperInvestorThemes = () => {
  const key = localStorage.getItem("anthropic_api_key");
  return api.post<ThemesData>("/superinvestors/analyze-themes", {}, {
    headers: key ? { "X-Api-Key": key } : {},
  }).then((r) => r.data);
};

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface InvestingGoal { id: string; label: string; weight: number; }

export interface AuthUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  company_name: string | null;
  employer_sector: string | null;
  annual_income: number | null;
  monthly_investable: number | null;
  experience_level: string | null;
  time_horizon: string | null;
  risk_tolerance: number | null;
  country: string | null;
  investing_goals: InvestingGoal[] | null;
  net_worth_outside: number | null;
  retirement_target_age: number | null;
  sectors_to_avoid: string[] | null;
  has_dependents: boolean | null;
  anthropic_api_key: string | null;
  setup_complete: boolean;
  created_at: string | null;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export const authSignup = (data: {
  email: string; password: string; first_name: string; last_name: string; date_of_birth?: string;
}) => api.post<AuthResponse>("/auth/signup", data).then((r) => r.data);

export const authLogin = (email: string, password: string) =>
  api.post<AuthResponse>("/auth/login", { email, password }).then((r) => r.data);

export const getAuthMe = (token: string) =>
  api.get<AuthUser>("/auth/me", { headers: authHeaders(token) }).then((r) => r.data);

export const updateAuthMe = (token: string, data: Partial<{
  first_name: string; last_name: string; date_of_birth: string;
  company_name: string; employer_sector: string;
  annual_income: number; monthly_investable: number;
  experience_level: string; time_horizon: string;
  risk_tolerance: number; country: string;
  investing_goals: InvestingGoal[]; net_worth_outside: number;
  retirement_target_age: number; sectors_to_avoid: string[];
  has_dependents: boolean; anthropic_api_key: string;
  setup_complete: boolean;
}>) => api.put<AuthUser>("/auth/me", data, { headers: authHeaders(token) }).then((r) => r.data);
