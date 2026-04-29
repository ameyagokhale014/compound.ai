import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { searchSymbols } from "../api";
import type { SearchResult } from "../types";

interface Props {
  onSelect: (result: SearchResult) => void;
}

const TYPE_LABELS: Record<string, string> = {
  stock: "Stock",
  etf: "ETF",
  mutual_fund: "Fund",
  crypto: "Crypto",
};

export default function StockSearch({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchSymbols(query);
        setResults(res);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [query]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(r: SearchResult) {
    onSelect(r);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-2 gap-2">
        <Search size={16} className="text-[#555]" />
        <input
          className="bg-transparent text-white text-sm flex-1 outline-none placeholder-[#555]"
          placeholder="Search stocks, ETFs, crypto..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {query && (
          <button onClick={() => { setQuery(""); setOpen(false); }}>
            <X size={14} className="text-[#555] hover:text-white" />
          </button>
        )}
        {loading && (
          <div className="w-3 h-3 border border-[#555] border-t-white rounded-full animate-spin" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden z-50 shadow-xl max-h-72 overflow-y-auto">
          {results.map((r) => (
            <button
              key={`${r.symbol}-${r.type}`}
              className="w-full flex items-center px-4 py-3 hover:bg-[#222] transition-colors text-left"
              onClick={() => handleSelect(r)}
            >
              <div className="flex-1">
                <div className="text-white text-sm font-medium">{r.symbol}</div>
                <div className="text-[#8a8a8a] text-xs truncate">{r.name}</div>
              </div>
              <span className="text-xs text-[#555] bg-[#222] px-2 py-0.5 rounded ml-2">
                {TYPE_LABELS[r.type] ?? r.type}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && !loading && results.length === 0 && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-3 text-[#555] text-sm z-50">
          No results found
        </div>
      )}
    </div>
  );
}
