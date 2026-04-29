export const SECTOR_COLORS: Record<string, string> = {
  "Technology":              "#4f8ef7",
  "Healthcare":              "#00c805",
  "Financial Services":      "#f7c44f",
  "Consumer Cyclical":       "#ff8800",
  "Communication Services":  "#a78bfa",
  "Industrials":             "#4dbb50",
  "Consumer Defensive":      "#00b4d8",
  "Energy":                  "#ff5000",
  "Basic Materials":         "#e76f51",
  "Real Estate":             "#2ec4b6",
  "Utilities":               "#c77dff",
  "Unknown":                 "#444444",
};

const FALLBACK_COLORS = [
  "#4f8ef7","#00c805","#f7c44f","#ff8800","#a78bfa",
  "#4dbb50","#00b4d8","#ff5000","#e76f51","#2ec4b6","#c77dff",
];

export function getSectorColor(sector: string): string {
  if (SECTOR_COLORS[sector]) return SECTOR_COLORS[sector];
  const idx = Math.abs(sector.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[idx];
}

export function normalizeSector(sector: string | null | undefined): string {
  return sector?.trim() || "Unknown";
}
