import { useState, useCallback, useEffect } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import type { ExtendedPrice } from "./hooks/useWebSocket";
import Home from "./pages/Home";
import PortfolioDetail from "./pages/PortfolioDetail";
import MasterPortfolio from "./pages/MasterPortfolio";
import StockPage from "./pages/StockPage";
import Watchlist from "./pages/Watchlist";
import NewsTab from "./pages/NewsTab";
import RecommendationsHub from "./pages/RecommendationsHub";
import SimulationTab from "./pages/SimulationTab";
import EarningsTab from "./pages/EarningsTab";
import SuperInvestorsPage from "./pages/SuperInvestorsPage";
import ProfileModal from "./components/ProfileModal";
import GlobalSearch from "./components/GlobalSearch";
import AuthPage from "./pages/AuthPage";
import SetupWizard from "./pages/SetupWizard";
import { useAuth } from "./contexts/AuthContext";
import type { Portfolio } from "./types";
import { getPortfolio, getPortfolios, getRealEstate, getStockSectors, recordActivity } from "./api";
import type { RealEstateProperty } from "./types";

type Tab = "dashboard" | "master" | "watchlist" | "news" | "recommendations" | "earnings" | "sim" | "investors";

const TAB_LABELS: Record<Tab, string> = {
  dashboard:       "Dashboard",
  master:          "Master Portfolio",
  watchlist:       "Watchlist",
  news:            "News",
  recommendations: "Recommendations",
  earnings:        "Earnings",
  sim:             "Popi Sim",
  investors:       "Top Investors",
};

export default function App() {
  const { user, loading } = useAuth();
  const [showWizard, setShowWizard] = useState(false);

  const [tab, setTab]             = useState<Tab>("dashboard");
  const [selected, setSelected]   = useState<Portfolio | null>(null);
  const [stockSymbol, setStockSymbol] = useState<string | null>(null);
  const [prices, setPrices]           = useState<Record<string, number>>({});
  const [extendedPrices, setExtended] = useState<Record<string, ExtendedPrice>>({});
  const [session, setSession]         = useState<string>("closed");
  const [marketOpen, setMarketOpen]   = useState(false);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [properties, setProperties] = useState<RealEstateProperty[]>([]);
  const [sectors, setSectors]     = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([getPortfolios(), getRealEstate()]).then(([ps, re]) => {
      setPortfolios(ps);
      setProperties(re);
    });
  }, [prices]);

  // Pre-fetch sectors globally so News + Recs pages have them immediately
  useEffect(() => {
    const syms = new Set<string>();
    for (const p of portfolios) {
      for (const h of p.holdings) {
        if (h.asset_type !== "cash") syms.add(h.symbol);
      }
    }
    if (syms.size > 0) {
      getStockSectors(Array.from(syms)).then(s => setSectors(prev => ({ ...prev, ...s })));
    }
  }, [portfolios]);

  const handlePriceUpdate = useCallback(
    async (newPrices: Record<string, number>) => {
      setPrices((prev) => ({ ...prev, ...newPrices }));
      if (selected) {
        const symbols = selected.holdings.map((h) => h.symbol);
        const hasUpdate = symbols.some((s) => s in newPrices);
        if (hasUpdate) {
          const updated = await getPortfolio(selected.id);
          setSelected(updated);
        }
      }
    },
    [selected],
  );

  useWebSocket(handlePriceUpdate, (ext, sess) => {
    setExtended(ext);
    setSession(sess);
  });

  useEffect(() => {
    const checkMarket = () =>
      fetch("http://localhost:8000/health")
        .then((r) => r.json())
        .then((d) => {
          setMarketOpen(d.market_open);
          setSession(d.session ?? (d.market_open ? "regular" : "closed"));
        })
        .catch(() => {});
    checkMarket();
    const interval = setInterval(checkMarket, 60000);
    return () => clearInterval(interval);
  }, []);

  function handleViewStock(symbol: string) {
    setStockSymbol(symbol.toUpperCase());
  }

  function handleBackFromStock() {
    setStockSymbol(null);
  }

  function switchTab(t: Tab) {
    setSelected(null);
    setStockSymbol(null);
    setTab(t);
    if (t === "news" || t === "recommendations") {
      recordActivity({ page: t === "news" ? "news" : "recommendations" }).catch(() => {});
    }
  }

  // Show a blank screen while checking stored token
  if (loading) {
    return <div className="min-h-screen bg-[#0a0a0a]" />;
  }

  // Not logged in — show auth page
  if (!user) {
    return (
      <AuthPage
        onSignupComplete={() => setShowWizard(true)}
      />
    );
  }

  // First-time signup — show setup wizard
  if (showWizard || (user && !user.setup_complete)) {
    return (
      <SetupWizard onDone={() => setShowWizard(false)} />
    );
  }

  const isMainView = !selected && !stockSymbol;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* ── Nav bar ── */}
      <div className="sticky top-0 z-50 bg-[#0a0a0a] border-b border-[#1a1a1a] px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5">
          <button
            onClick={() => switchTab("dashboard")}
            className="text-white font-semibold text-sm hover:opacity-80 transition-opacity shrink-0"
          >
            compound.ai
          </button>
          <div className="flex gap-0.5">
            {(["dashboard", "master", "watchlist", "news", "recommendations", "earnings", "sim", "investors"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  isMainView && tab === t
                    ? "bg-[#222] text-white"
                    : t === "recommendations"
                      ? "text-[#4f8ef7] hover:text-[#7ab0ff]"
                      : t === "earnings"
                        ? "text-[#a78bfa] hover:text-[#c4b5fd]"
                        : t === "sim"
                          ? "text-[#a78bfa] hover:text-[#c4b5fd]"
                          : t === "investors"
                            ? "text-[#f7c44f] hover:text-[#fde68a]"
                            : "text-[#555] hover:text-[#8a8a8a]"
                }`}
              >
                {t === "recommendations" ? "✦ " : t === "earnings" ? "📅 " : t === "sim" ? "🤖 " : t === "investors" ? "🏆 " : ""}{TAB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Global search */}
        <GlobalSearch onSelect={handleViewStock} />

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${
              session === "regular"    ? "bg-[#00c805]" :
              session === "pre_market" ? "bg-[#f7c44f] animate-pulse" :
              session === "post_market"? "bg-[#a78bfa] animate-pulse" :
              "bg-[#555]"
            }`} />
            <span className="text-[#8a8a8a] text-xs">
              {session === "regular"     ? "Market Open" :
               session === "pre_market"  ? "Pre-Market" :
               session === "post_market" ? "After Hours" :
               "Market Closed"}
            </span>
          </div>
          <ProfileModal />
        </div>
      </div>

      {/* ── Page routing ── */}
      {stockSymbol ? (
        <StockPage
          symbol={stockSymbol}
          onBack={handleBackFromStock}
          portfolios={portfolios}
        />
      ) : selected ? (
        <PortfolioDetail
          portfolio={selected}
          onBack={() => setSelected(null)}
          onUpdate={setSelected}
          onViewStock={handleViewStock}
          extendedPrices={extendedPrices}
          session={session}
        />
      ) : tab === "watchlist" ? (
        <Watchlist onViewStock={handleViewStock} />
      ) : tab === "news" ? (
        <NewsTab
          portfolios={portfolios}
          properties={properties}
          onViewStock={handleViewStock}
        />
      ) : tab === "recommendations" ? (
        <RecommendationsHub
          portfolios={portfolios}
          properties={properties}
          sectors={sectors}
          onViewStock={handleViewStock}
        />
      ) : tab === "master" ? (
        <MasterPortfolio
          portfolios={portfolios}
          properties={properties}
          onViewStock={handleViewStock}
        />
      ) : tab === "earnings" ? (
        <EarningsTab portfolios={portfolios} />
      ) : tab === "sim" ? (
        <SimulationTab />
      ) : tab === "investors" ? (
        <SuperInvestorsPage />
      ) : (
        <Home
          onSelect={setSelected}
          prices={prices}
          extendedPrices={extendedPrices}
          session={session}
          onViewStock={handleViewStock}
        />
      )}
    </div>
  );
}
