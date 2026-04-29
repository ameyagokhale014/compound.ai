import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { getAchievements, recordActivity } from "../api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Badge {
  key: string;
  emoji: string;
  name: string;
  desc: string;
  category: string;
  rarity: "common" | "uncommon" | "rare" | "legendary";
  earned: boolean;
  progress: number;        // 0–1
  progress_label: string;
}

interface Streaks { login: number; news: number; recs: number; }

interface AchievementsData {
  streaks: Streaks;
  badges: Badge[];
  earned_count: number;
  total_count: number;
  next_up: Badge[];
}

// ─── Rarity colours ───────────────────────────────────────────────────────────
const RARITY_STYLE: Record<string, { ring: string; glow: string; label: string; labelColor: string }> = {
  common:    { ring: "border-[#333]",    glow: "",                              label: "",           labelColor: "" },
  uncommon:  { ring: "border-[#4f8ef7]", glow: "shadow-[0_0_8px_#4f8ef740]",   label: "Uncommon",   labelColor: "text-[#4f8ef7]" },
  rare:      { ring: "border-[#a78bfa]", glow: "shadow-[0_0_10px_#a78bfa50]",  label: "Rare",       labelColor: "text-[#a78bfa]" },
  legendary: { ring: "border-[#f7c44f]", glow: "shadow-[0_0_14px_#f7c44f60]",  label: "Legendary",  labelColor: "text-[#f7c44f]" },
};

// ─── Flame animation for active streaks ──────────────────────────────────────
function StreakFlame({ days, label, emoji }: { days: number; label: string; emoji: string }) {
  if (days === 0) return null;
  const isHot   = days >= 7;
  const isOnFire = days >= 30;
  return (
    <div className={`flex items-center gap-3 bg-[#0d0d0d] border rounded-2xl px-4 py-3 min-w-[130px] ${
      isOnFire ? "border-[#f7c44f] shadow-[0_0_12px_#f7c44f30]" :
      isHot    ? "border-[#ff8800] shadow-[0_0_8px_#ff880030]" : "border-[#2a2a2a]"
    }`}>
      <div className="text-2xl select-none" style={{ filter: isHot ? "drop-shadow(0 0 4px #ff8800)" : "none" }}>
        {emoji}
      </div>
      <div>
        <div className={`text-2xl font-bold tabular-nums leading-none ${
          isOnFire ? "text-[#f7c44f]" : isHot ? "text-[#ff8800]" : "text-white"
        }`}>
          {days}
        </div>
        <div className="text-[10px] text-[#555] mt-0.5 whitespace-nowrap">
          {label} · {days === 1 ? "day" : "days"}
        </div>
      </div>
    </div>
  );
}

// ─── Single badge tile ────────────────────────────────────────────────────────
function BadgeTile({ badge, size = "md" }: { badge: Badge; size?: "sm" | "md" }) {
  const [hovered, setHovered] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const [above, setAbove] = useState(true);
  const tileRef = useRef<HTMLDivElement>(null);
  const rs = RARITY_STYLE[badge.rarity] ?? RARITY_STYLE.common;
  const sz = size === "sm" ? "w-10 h-10 text-xl" : "w-12 h-12 text-2xl";

  const handleMouseEnter = () => {
    if (tileRef.current) {
      const rect = tileRef.current.getBoundingClientRect();
      const tooltipH = 120; // approximate tooltip height
      const spaceAbove = rect.top;
      const showAbove = spaceAbove > tooltipH + 8;
      setAbove(showAbove);
      setTooltipStyle({
        position: "fixed",
        left: rect.left + rect.width / 2,
        top: showAbove ? rect.top - 8 : rect.bottom + 8,
        transform: showAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
        zIndex: 9999,
        pointerEvents: "none",
      });
    }
    setHovered(true);
  };

  return (
    <div
      ref={tileRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Tile */}
      <div className={`${sz} rounded-xl border-2 flex items-center justify-center transition-all duration-200 ${
        badge.earned
          ? `${rs.ring} ${rs.glow} bg-[#0d0d0d] cursor-default`
          : "border-[#1e1e1e] bg-[#0a0a0a] grayscale opacity-35 cursor-default"
      } ${hovered && badge.earned ? "scale-110" : ""}`}>
        <span className="select-none">{badge.emoji}</span>
      </div>

      {/* Tooltip — rendered in a portal so it's never clipped */}
      {hovered && createPortal(
        <div style={tooltipStyle}>
          {/* Arrow (above → arrow points down at bottom; below → arrow points up at top) */}
          {!above && (
            <div className="w-2 h-2 bg-[#1a1a1a] border-l border-t border-[#333] rotate-45 mx-auto mb-[-5px] relative z-10" />
          )}
          <div className="bg-[#1a1a1a] border border-[#333] rounded-xl px-3 py-2 w-44 shadow-2xl">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-white text-xs font-semibold">{badge.name}</span>
              {badge.rarity !== "common" && (
                <span className={`text-[9px] font-bold ${rs.labelColor}`}>{rs.label}</span>
              )}
            </div>
            <p className="text-[#666] text-[10px] leading-relaxed">{badge.desc}</p>
            {!badge.earned && badge.progress > 0 && (
              <div className="mt-1.5">
                <div className="flex items-center justify-between text-[9px] mb-0.5">
                  <span className="text-[#555]">Progress</span>
                  <span className="text-[#4f8ef7] tabular-nums">{Math.round(badge.progress * 100)}%</span>
                </div>
                <div className="h-1 bg-[#222] rounded-full overflow-hidden">
                  <div className="h-1 bg-[#4f8ef7] rounded-full" style={{ width: `${badge.progress * 100}%` }} />
                </div>
                {badge.progress_label && (
                  <div className="text-[#444] text-[9px] mt-0.5 text-center">{badge.progress_label}</div>
                )}
              </div>
            )}
            {badge.earned && (
              <div className="text-[#00c805] text-[9px] mt-1 font-semibold">✓ Earned</div>
            )}
          </div>
          {/* Arrow pointing up when tooltip is below the badge */}
          {above && (
            <div className="w-2 h-2 bg-[#1a1a1a] border-r border-b border-[#333] rotate-45 mx-auto mt-[-5px] relative z-10" />
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Next-to-unlock progress row ──────────────────────────────────────────────
function NextUpRow({ badge }: { badge: Badge }) {
  const rs = RARITY_STYLE[badge.rarity] ?? RARITY_STYLE.common;
  return (
    <div className="flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl border-2 flex items-center justify-center text-lg shrink-0 ${rs.ring} bg-[#0d0d0d] opacity-70`}>
        {badge.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-white text-xs font-medium truncate">{badge.name}</span>
            {badge.rarity !== "common" && (
              <span className={`text-[9px] font-bold shrink-0 ${rs.labelColor}`}>{rs.label}</span>
            )}
          </div>
          <span className="text-[#4f8ef7] text-[10px] tabular-nums shrink-0 font-semibold">
            {Math.round(badge.progress * 100)}%
          </span>
        </div>
        <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
          <div
            className="h-1.5 rounded-full transition-all duration-700"
            style={{
              width: `${badge.progress * 100}%`,
              backgroundColor: badge.rarity === "legendary" ? "#f7c44f" :
                               badge.rarity === "rare"      ? "#a78bfa" :
                               badge.rarity === "uncommon"  ? "#4f8ef7" : "#4f8ef7",
            }}
          />
        </div>
        {badge.progress_label && (
          <div className="text-[#444] text-[9px] mt-0.5">{badge.progress_label}</div>
        )}
      </div>
    </div>
  );
}

// ─── Category section ─────────────────────────────────────────────────────────
const CATEGORY_ORDER = ["Foundation", "Wealth", "Diversification", "Discipline", "Optimization", "Streaks"];
const CATEGORY_EMOJI: Record<string, string> = {
  Foundation:      "🏛️",
  Wealth:          "💰",
  Diversification: "🌐",
  Discipline:      "🎯",
  Optimization:    "📊",
  Streaks:         "🔥",
};

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  wealthScore?: number;
  netWorth?: number;
  currentPage?: string;
}

export default function AchievementsCard({ wealthScore, netWorth, currentPage = "dashboard" }: Props) {
  const [data, setData] = useState<AchievementsData | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("All");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getAchievements();
      setData(result);
    } catch { /* silent */ }
  }, []);

  // Record activity + load achievements on mount
  useEffect(() => {
    recordActivity({
      page: currentPage,
      wealth_score: wealthScore,
      net_worth: netWorth,
    }).catch(() => {});
    load();
  }, [currentPage, wealthScore, netWorth, load]);

  if (!data) {
    return (
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl p-6 mb-6 animate-pulse">
        <div className="h-4 bg-[#222] rounded w-40 mb-4" />
        <div className="flex gap-3">
          {[1,2,3].map(i => <div key={i} className="h-14 bg-[#222] rounded-2xl flex-1" />)}
        </div>
      </div>
    );
  }

  const { streaks, badges, earned_count, total_count, next_up } = data;

  // Group badges by category
  const badgesByCategory: Record<string, Badge[]> = {};
  for (const b of badges) {
    if (!badgesByCategory[b.category]) badgesByCategory[b.category] = [];
    badgesByCategory[b.category].push(b);
  }

  // Filter
  const filteredBadges = activeFilter === "All"
    ? badges
    : activeFilter === "Earned"
      ? badges.filter(b => b.earned)
      : badges.filter(b => b.category === activeFilter);

  const activeStreakCount = [streaks.login, streaks.news, streaks.recs].filter(s => s > 0).length;

  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl mb-6">

      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-4 border-b border-[#1e1e1e]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🏆</span>
            <div>
              <h2 className="text-white font-semibold text-sm">Streaks & Badges</h2>
              <p className="text-[#555] text-xs">
                {earned_count} of {total_count} badges earned
                {activeStreakCount > 0 ? ` · ${activeStreakCount} active streak${activeStreakCount > 1 ? "s" : ""}` : ""}
              </p>
            </div>
          </div>
          {/* Overall progress pill */}
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-[#222] rounded-full overflow-hidden">
              <div
                className="h-1.5 bg-gradient-to-r from-[#4f8ef7] to-[#a78bfa] rounded-full transition-all"
                style={{ width: `${(earned_count / total_count) * 100}%` }}
              />
            </div>
            <span className="text-[#555] text-xs tabular-nums">{Math.round((earned_count / total_count) * 100)}%</span>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-5">

        {/* ── Active Streaks ── */}
        {(streaks.login > 0 || streaks.news > 0 || streaks.recs > 0) && (
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-widest mb-2.5">Active Streaks</div>
            <div className="flex flex-wrap gap-2.5">
              <StreakFlame days={streaks.login} label="Daily check-in" emoji="🔥" />
              <StreakFlame days={streaks.news}  label="News reading"   emoji="📰" />
              <StreakFlame days={streaks.recs}  label="Recommendations" emoji="📋" />
            </div>
          </div>
        )}

        {/* ── Badge grid with filter tabs ── */}
        <div>
          {/* Filter row */}
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {["All", "Earned", ...CATEGORY_ORDER].map(f => {
              const count = f === "All" ? badges.length
                : f === "Earned" ? earned_count
                : (badgesByCategory[f]?.length ?? 0);
              if (f !== "All" && f !== "Earned" && count === 0) return null;
              return (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                    activeFilter === f
                      ? "bg-white text-black border-white font-semibold"
                      : "border-[#222] text-[#555] hover:text-[#8a8a8a] hover:border-[#333]"
                  }`}
                >
                  {CATEGORY_EMOJI[f] ?? ""} {f}{f !== "All" ? ` (${count})` : ""}
                </button>
              );
            })}
          </div>

          {/* Badge tiles */}
          <div className="flex flex-wrap gap-2">
            {(showAll ? filteredBadges : filteredBadges.slice(0, 24)).map(b => (
              <BadgeTile key={b.key} badge={b} />
            ))}
          </div>

          {filteredBadges.length > 24 && (
            <button
              onClick={() => setShowAll(v => !v)}
              className="mt-3 text-xs text-[#555] hover:text-[#8a8a8a] transition-colors"
            >
              {showAll ? "↑ Show less" : `↓ Show all ${filteredBadges.length} badges`}
            </button>
          )}
        </div>

        {/* ── Next to unlock ── */}
        {next_up.length > 0 && (
          <div>
            <div className="text-[#555] text-[10px] uppercase tracking-widest mb-3">Next to Unlock</div>
            <div className="space-y-3">
              {next_up.map(b => <NextUpRow key={b.key} badge={b} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
