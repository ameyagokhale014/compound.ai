import { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Trash2, Search, X } from "lucide-react";
import type { WatchlistItem, SearchResult, CachedBuyTarget } from "../types";
import {
  getWatchlist, addToWatchlist, removeFromWatchlist,
  getStockSectors, getCachedBuyTargets, refreshCachedBuyTargets,
} from "../api";
import { getSectorColor } from "../utils/sectors";
import SectorPieChart from "../components/SectorPieChart";
import axios from "axios";

interface Props {
  onViewStock?: (symbol: string) => void;
}

const SIGNAL_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  strong_buy:   { bg: "bg-[#0a2a0a]",  text: "text-[#00c805]", label: "Strong Buy" },
  buy:          { bg: "bg-[#0d1f0d]",  text: "text-[#4dbb50]", label: "Buy" },
  near_target:  { bg: "bg-[#261f00]",  text: "text-[#f7c44f]", label: "Near Target" },
  above_target: { bg: "bg-[#2a0a0a]",  text: "text-[#ff5000]", label: "Above Target" },
};

const SIGNAL_ORDER: Record<string, number> = {
  strong_buy: 0, buy: 1, near_target: 2, above_target: 3,
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function Watchlist({ onViewStock }: Props) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [sectors, setSectors] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getWatchlist().then(setItems);
  }, []);

  // Fetch sectors whenever watchlist changes
  useEffect(() => {
    const syms = items.map((i) => i.symbol).filter((s) => !(s in sectors));
    if (!syms.length) return;
    getStockSectors(syms).then((s) => setSectors((prev) => ({ ...prev, ...s })));
  }, [items]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      axios.get<SearchResult[]>(`http://localhost:8000/search/?q=${encodeURIComponent(query)}`)
        .then((r) => setResults(r.data.slice(0, 8)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleAdd(symbol: string, name?: string) {
    setAdding(symbol);
    try {
      const item = await addToWatchlist(symbol, name);
      setItems((prev) => prev.find((i) => i.symbol === symbol) ? prev : [item, ...prev]);
    } finally {
      setAdding(null);
      setQuery("");
      setResults([]);
      setSearchOpen(false);
    }
  }

  async function handleRemove(id: number) {
    await removeFromWatchlist(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  const [buyTargets, setBuyTargets] = useState<Map<string, CachedBuyTarget>>(new Map());
  const [computingTargets, setComputingTargets] = useState(false);

  const symbols = useMemo(() => items.map((i) => i.symbol), [items]);

  useEffect(() => {
    if (!symbols.length) return;
    let cancelled = false;

    async function loadTargets() {
      // 1. Fetch whatever is already cached
      const cached = await getCachedBuyTargets(symbols);
      if (cancelled) return;

      const map = new Map<string, CachedBuyTarget>();
      for (const t of cached) map.set(t.symbol, t);
      setBuyTargets(new Map(map));

      // 2. Find symbols with no data at all
      const missing = symbols.filter((s) => !map.has(s) || map.get(s)!.base_buy_price == null);
      if (!missing.length) return;

      // 3. Compute on-demand for the missing ones
      setComputingTargets(true);
      try {
        await refreshCachedBuyTargets(missing);
        if (cancelled) return;
        const fresh = await getCachedBuyTargets(symbols);
        if (cancelled) return;
        const freshMap = new Map<string, CachedBuyTarget>();
        for (const t of fresh) freshMap.set(t.symbol, t);
        setBuyTargets(freshMap);
      } catch {
        // silent — best effort
      } finally {
        if (!cancelled) setComputingTargets(false);
      }
    }

    loadTargets();
    return () => { cancelled = true; };
  }, [symbols.join(",")]);

  // Sort by signal then by symbol
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const sa = SIGNAL_ORDER[buyTargets.get(a.symbol)?.signal ?? ""] ?? 99;
      const sb = SIGNAL_ORDER[buyTargets.get(b.symbol)?.signal ?? ""] ?? 99;
      if (sa !== sb) return sa - sb;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [items, buyTargets]);

  // Sector breakdown for pie chart (use live prices from buy targets)
  const sectorData = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) {
      const sector = sectors[item.symbol] || "Unknown";
      const price = buyTargets.get(item.symbol)?.current_price ?? 0;
      map.set(sector, (map.get(sector) ?? 0) + price);
    }
    return Array.from(map.entries()).map(([sector, value]) => ({ sector, value }));
  }, [items, sectors, buyTargets]);

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-[1400px] mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Watchlist</h1>
            <div className="flex items-center gap-3 mt-0.5">
              <p className="text-[#555] text-sm">{items.length} stock{items.length !== 1 ? "s" : ""} watched</p>
              {computingTargets && (
                <span className="text-[#f7c44f] text-xs animate-pulse">Computing buy targets…</span>
              )}
            </div>
          </div>

          {/* Add stock search */}
          <div className="relative" ref={searchRef}>
            <div className="flex items-center gap-2 bg-[#141414] border border-[#2a2a2a] rounded-xl px-3 py-2 w-64">
              <Search size={14} className="text-[#555] shrink-0" />
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => query && setSearchOpen(true)}
                placeholder="Add a stock…"
                className="flex-1 bg-transparent text-white text-sm outline-none placeholder-[#444]"
              />
              {query && (
                <button onClick={() => { setQuery(""); setResults([]); }}>
                  <X size={13} className="text-[#555]" />
                </button>
              )}
            </div>
            {searchOpen && results.length > 0 && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-[#1a1a1a] border border-[#333] rounded-xl overflow-hidden z-50 shadow-xl">
                {results.map((r) => (
                  <button
                    key={r.symbol}
                    onClick={() => handleAdd(r.symbol, r.name)}
                    disabled={adding === r.symbol || !!items.find((i) => i.symbol === r.symbol)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#252525] transition-colors text-left disabled:opacity-50"
                  >
                    <div>
                      <div className="text-white text-sm font-medium">{r.symbol}</div>
                      <div className="text-[#555] text-xs truncate max-w-[180px]">{r.name}</div>
                    </div>
                    {items.find((i) => i.symbol === r.symbol)
                      ? <span className="text-[#555] text-xs">Added</span>
                      : <Plus size={14} className="text-[#4f8ef7] shrink-0" />
                    }
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-5 items-start">
          {/* Main table */}
          <div className="flex-1 min-w-0">
            {items.length === 0 ? (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-16 text-center">
                <div className="text-[#444] text-4xl mb-3">👁</div>
                <div className="text-white font-semibold mb-1">Nothing on your watchlist yet</div>
                <div className="text-[#555] text-sm">Search for a stock above to start watching it.</div>
              </div>
            ) : (
              <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl overflow-hidden">
                {/* Column headers */}
                <div className="grid px-5 py-3 border-b border-[#2a2a2a] text-[#555] text-xs"
                  style={{ gridTemplateColumns: "1fr 110px 120px 140px 150px 40px" }}>
                  <div>Stock</div>
                  <div>Sector</div>
                  <div>Price</div>
                  <div>Buy Target</div>
                  <div>Signal</div>
                  <div />
                </div>

                <div className="divide-y divide-[#1a1a1a]">
                  {sorted.map((item) => {
                    const bt = buyTargets.get(item.symbol);
                    const sector = sectors[item.symbol] || "—";
                    const dayUp = bt && bt.current_price ? true : true; // placeholder
                    const signal = bt?.signal;
                    const signalStyle = signal ? SIGNAL_STYLE[signal] : null;
                    const distPct = bt?.current_price && bt?.base_buy_price
                      ? ((bt.current_price - bt.base_buy_price) / bt.base_buy_price) * 100
                      : null;

                    return (
                      <div key={item.id} className="grid px-5 py-3.5 items-center hover:bg-[#1a1a1a] transition-colors"
                        style={{ gridTemplateColumns: "1fr 110px 120px 140px 150px 40px" }}>

                        {/* Symbol + name */}
                        <div>
                          <span
                            className={`text-white font-semibold text-sm ${onViewStock ? "cursor-pointer hover:text-[#4f8ef7] transition-colors" : ""}`}
                            onClick={() => onViewStock?.(item.symbol)}
                          >{item.symbol}</span>
                          {item.name && <div className="text-[#555] text-xs truncate mt-0.5 max-w-[200px]">{item.name}</div>}
                        </div>

                        {/* Sector */}
                        <div className="flex items-center gap-1.5">
                          {sector !== "—" && (
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: getSectorColor(sector) }} />
                          )}
                          <span className="text-[#8a8a8a] text-xs truncate">{sector}</span>
                        </div>

                        {/* Price */}
                        <div>
                          {bt?.current_price
                            ? <div className="text-white text-sm">{fmt(bt.current_price)}</div>
                            : <div className="text-[#444] text-xs">—</div>
                          }
                        </div>

                        {/* Buy Target */}
                        <div>
                          {bt?.base_buy_price
                            ? <>
                                <div className="text-white text-sm">{fmt(bt.base_buy_price)}</div>
                                {distPct !== null && (
                                  <div className={`text-xs ${distPct < 0 ? "text-[#00c805]" : "text-[#ff5000]"}`}>
                                    {distPct < 0 ? "" : "+"}{distPct.toFixed(1)}% away
                                  </div>
                                )}
                              </>
                            : <div className="text-[#444] text-xs">—</div>
                          }
                        </div>

                        {/* Signal */}
                        <div>
                          {signalStyle
                            ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${signalStyle.bg} ${signalStyle.text}`}>
                                {signalStyle.label}
                              </span>
                            : <span className="text-[#444] text-xs">—</span>
                          }
                        </div>

                        {/* Remove */}
                        <button onClick={() => handleRemove(item.id)} className="text-[#333] hover:text-[#ff5000] transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right sidebar — sector pie */}
          {sectorData.length > 0 && (
            <div className="w-72 shrink-0 sticky top-6">
              <SectorPieChart data={sectorData} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
