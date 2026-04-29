import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X } from "lucide-react";
import { searchSymbols } from "../api";
import type { SearchResult } from "../types";

interface Props {
  onSelect: (symbol: string) => void;
}

const TYPE_COLOR: Record<string, string> = {
  stock: "text-[#00c805]",
  etf: "text-[#4488ff]",
  mutual_fund: "text-[#cc44ff]",
  crypto: "text-[#ff8800]",
};

export default function GlobalSearch({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    searchSymbols(q)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) { setResults([]); return; }
    debounceRef.current = setTimeout(() => search(query), 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(sym: string) {
    onSelect(sym);
    setQuery("");
    setResults([]);
    setOpen(false);
    setFocused(false);
    inputRef.current?.blur();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
    if (e.key === "Enter" && results.length > 0) handleSelect(results[0].symbol);
  }

  const showDropdown = focused && (results.length > 0 || (query.length > 0 && !loading));

  return (
    <div ref={containerRef} className="relative w-64">
      <div className={`flex items-center gap-2 bg-[#111] border rounded-xl px-3 py-1.5 transition-colors ${
        focused ? "border-[#444]" : "border-[#222]"
      }`}>
        <Search size={13} className="text-[#444] shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onKeyDown={handleKey}
          placeholder="Search stocks, ETFs…"
          className="flex-1 bg-transparent text-white text-xs outline-none placeholder-[#444]"
        />
        {query && (
          <button onClick={() => { setQuery(""); setResults([]); }} className="text-[#444] hover:text-[#888]">
            <X size={12} />
          </button>
        )}
      </div>

      {showDropdown && open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[#141414] border border-[#2a2a2a] rounded-xl shadow-2xl z-50 overflow-hidden max-h-72 overflow-y-auto">
          {loading && (
            <div className="px-3 py-3 text-[#555] text-xs text-center">Searching…</div>
          )}
          {!loading && results.length === 0 && query.length > 0 && (
            <div className="px-3 py-3 text-[#555] text-xs text-center">No results for "{query}"</div>
          )}
          {results.map((r) => (
            <button
              key={r.symbol}
              onClick={() => handleSelect(r.symbol)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#1e1e1e] transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm">{r.symbol}</span>
                  <span className={`text-[9px] font-medium uppercase ${TYPE_COLOR[r.type] ?? "text-[#555]"}`}>
                    {r.type.replace("_", " ")}
                  </span>
                </div>
                <div className="text-[#555] text-xs truncate">{r.name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
