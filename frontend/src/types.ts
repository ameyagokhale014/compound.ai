export type AssetType = "stock" | "etf" | "mutual_fund" | "crypto" | "cash";

export interface Transaction {
  id: number;
  quantity: number;
  buy_price: number;
  purchased_at: string;
}

export interface Holding {
  id: number;
  symbol: string;
  name: string;
  asset_type: AssetType;
  transactions: Transaction[];
  total_quantity: number;
  avg_cost: number;
  current_price: number;
  current_value: number;
  total_cost: number;
  gain_loss: number;
  gain_loss_pct: number;
  day_change: number;
  day_change_pct: number;
  day_change_value: number;
}

export interface Portfolio {
  id: number;
  name: string;
  account_type: string;
  company_name?: string | null;
  employer_status?: string | null;
  cash_balance: number;
  holdings: Holding[];
  total_value: number;
  total_cost: number;
  total_gain_loss: number;
  total_gain_loss_pct: number;
  created_at: string;
}

export interface ChartPoint {
  timestamp: string;
  value: number;
}

export interface SearchResult {
  symbol: string;
  name: string;
  type: AssetType;
}

export type Period = "1D" | "1M" | "3M" | "6M" | "1Y" | "ALL";

export interface RealEstateProperty {
  id: number;
  address: string;
  estimated_value: number;
  ownership_pct: number;
  equity: number;
  created_at: string;
  updated_at: string;
}

export interface HistoricalPoint {
  year: number;
  value: number | null;
  yoy: number | null;
}

export interface AiBuyScenario {
  annual_revenue_growth: number;
  annual_eps_growth: number;
  exit_pe: number;
  buy_price: number;
  rationale: string;
}

export interface AiBuyTarget {
  symbol: string;
  current_price: number;
  forward_eps_used?: number;
  bear: AiBuyScenario;
  base: AiBuyScenario;
  bull: AiBuyScenario;
  bear_buy_price: number;
  base_buy_price: number;
  bull_buy_price: number;
  distance_from_base_pct: number;
  signal: "strong_buy" | "buy" | "near_target" | "above_target";
  management_outlook: string;
  key_risks: string;
  cagr_used: number;
  eps_history: HistoricalPoint[];
  pe_history: HistoricalPoint[];
}

export interface CachedBuyTarget {
  symbol: string;
  base_buy_price: number | null;
  forward_eps: number | null;
  eps_cagr_pct: number | null;
  exit_pe: number | null;
  current_price: number | null;
  signal: "strong_buy" | "buy" | "near_target" | "above_target" | null;
  last_updated: string | null;
}

export interface WatchlistItem {
  id: number;
  symbol: string;
  name: string | null;
  notes: string | null;
  added_at: string;
}

export interface NewsItem {
  id: number;
  symbol: string;
  asset_type: "stock" | "real_estate";
  title: string;
  publisher: string | null;
  url: string;
  published_at: string;
  impact_score: number | null;       // -10 to +10
  impact_label: string | null;       // Very Bullish / Bullish / Neutral / Bearish / Very Bearish
  impact_summary: string | null;
  action_required: string | null;    // consider_buying | monitor | consider_selling | null
  fetched_at: string | null;
}

export interface BuyTarget {
  holding_id: number;
  symbol: string;
  current_price: number;
  ideal_buy_low?: number;
  ideal_buy_mean?: number;
  ideal_buy_high?: number;
  analyst_target_mean?: number;
  analyst_target_low?: number;
  analyst_target_high?: number;
  upside_from_analyst_pct?: number;
  signal: "strong_buy" | "fair" | "overvalued" | "no_data";
  recommendation?: string;
  num_analysts?: number;
  cagr_used: number;
}
