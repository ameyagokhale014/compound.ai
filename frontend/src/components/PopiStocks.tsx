import { useState, useRef, useEffect } from "react";
import { Send, RotateCcw, Loader2 } from "lucide-react";
import { askPopi } from "../api";

const GOALS = [
  { id: "growth",      label: "Maximise returns",         emoji: "📈" },
  { id: "dividend",    label: "Dividend income",          emoji: "💰" },
  { id: "diversify",   label: "Better diversification",   emoji: "🎯" },
  { id: "reduce_risk", label: "Reduce concentration",     emoji: "🛡️" },
  { id: "sector",      label: "Sector rebalancing",       emoji: "⚖️" },
  { id: "tax",         label: "Tax loss harvesting",      emoji: "📋" },
];

const SUGGESTIONS = [
  "Analyse my stock portfolio",
  "What changes should I be making to my stocks?",
  "Which positions are overweight and should I trim?",
  "Where am I most exposed to risk?",
  "How's my sector diversification?",
  "Which underperformers should I consider cutting?",
];

interface PophiAnalysis {
  health_score: number;
  health_summary: string;
  strengths: string[];
  risks: string[];
  goal_alignment: string;
  recommendations: string[];
  cash_insight?: string | null;
}

interface Message {
  role: "popi" | "user";
  text: string;
  structured?: PophiAnalysis;
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 8 ? "#00c805" : score >= 6 ? "#f7c44f" : "#ff5000";
  const label = score >= 8 ? "Strong" : score >= 6 ? "Solid" : "Needs work";
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-14 h-14 shrink-0">
        <svg viewBox="0 0 44 44" className="w-full h-full -rotate-90">
          <circle cx="22" cy="22" r="18" fill="none" stroke="#222" strokeWidth="4" />
          <circle cx="22" cy="22" r="18" fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={`${(score / 10) * 113} 113`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-bold text-lg leading-none">{score}</span>
        </div>
      </div>
      <div>
        <div className="text-[#4f8ef7] text-[10px] uppercase tracking-wide font-semibold">Portfolio Health</div>
        <div style={{ color }} className="text-xs font-semibold">{label}</div>
      </div>
    </div>
  );
}

function AnalysisCards({ data }: { data: PophiAnalysis }) {
  return (
    <div className="space-y-2.5">
      <div className="bg-[#0d1520] border border-[#1a3050] rounded-xl p-3 flex items-center justify-between gap-3">
        <ScoreRing score={data.health_score} />
        <p className="text-[#ccc] text-sm leading-relaxed flex-1">{data.health_summary}</p>
      </div>
      {data.strengths.length > 0 && (
        <div className="bg-[#0a1a0a] border border-[#1a3a1a] rounded-xl p-3">
          <div className="text-[#00c805] text-xs font-semibold uppercase tracking-wide mb-2">What's Working</div>
          <ul className="space-y-2">
            {data.strengths.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-[#aaa]">
                <span className="text-[#00c805] shrink-0 font-bold mt-px">✓</span><span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.risks.length > 0 && (
        <div className="bg-[#1a0a0a] border border-[#3a1a1a] rounded-xl p-3">
          <div className="text-[#ff5000] text-xs font-semibold uppercase tracking-wide mb-2">Risks & Concerns</div>
          <ul className="space-y-2">
            {data.risks.map((r, i) => (
              <li key={i} className="flex gap-2 text-sm text-[#aaa]">
                <span className="text-[#ff5000] shrink-0 font-bold mt-px">!</span><span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-3">
        <div className="text-[#4f8ef7] text-xs font-semibold uppercase tracking-wide mb-1.5">Goal Alignment</div>
        <p className="text-[#aaa] text-sm leading-relaxed">{data.goal_alignment}</p>
      </div>
      {data.cash_insight && (
        <div className="bg-[#1a1500] border border-[#3a3000] rounded-xl p-3">
          <div className="text-[#f7c44f] text-xs font-semibold uppercase tracking-wide mb-1.5">Cash Opportunity</div>
          <p className="text-[#aaa] text-sm leading-relaxed">{data.cash_insight}</p>
        </div>
      )}
      {data.recommendations.length > 0 && (
        <div className="bg-[#0d1520] border border-[#1a3050] rounded-xl p-3">
          <div className="text-white text-xs font-semibold uppercase tracking-wide mb-2">Action Plan</div>
          <ol className="space-y-2.5">
            {data.recommendations.map((rec, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-[#aaa]">
                <span className="text-[#4f8ef7] font-bold shrink-0 w-4">{i + 1}.</span><span>{rec}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function SimpleMarkdown({ text }: { text: string }) {
  return (
    <div className="text-[#ccc] text-sm leading-relaxed space-y-1.5">
      {text.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        if (/^#{1,3}\s/.test(line))
          return <div key={i} className="text-white font-semibold text-sm mt-2">{line.replace(/^#+\s/, "")}</div>;
        if (/^[-*]\s/.test(line))
          return (
            <div key={i} className="flex gap-2">
              <span className="text-[#4f8ef7] shrink-0">•</span>
              <span dangerouslySetInnerHTML={{ __html: line.replace(/^[-*]\s/, "").replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>') }} />
            </div>
          );
        return <p key={i} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white">$1</strong>') }} />;
      })}
    </div>
  );
}

const Avatar = ({ size = "sm" }: { size?: "sm" | "md" }) => (
  <div className={`rounded-full bg-gradient-to-br from-[#4f8ef7] to-[#2563eb] flex items-center justify-center text-white font-bold shadow-lg shadow-blue-900/30 shrink-0 ${size === "md" ? "w-10 h-10 text-base" : "w-6 h-6 text-[10px]"}`}>P</div>
);

export default function PopiStocks() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const inChat = messages.length > 0;

  function toggleGoal(id: string) {
    setSelectedGoals(p => p.includes(id) ? p.filter(g => g !== id) : [...p, id]);
  }

  function reset() {
    setMessages([]); setChatInput(""); setSelectedGoals([]);
  }

  function getGoalLabels() {
    return selectedGoals.map(id => GOALS.find(g => g.id === id)?.label ?? id);
  }

  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? chatInput).trim();
    if (!text || loading) return;
    setChatInput("");
    const history = messages.map(m => ({ role: m.role === "popi" ? "assistant" : "user", content: m.text }));
    setMessages(p => [...p, { role: "user", text }]);
    setLoading(true);
    try {
      const res = await askPopi({
        goals: getGoalLabels(),
        risk_appetite: "moderate",
        follow_up: text,
        history,
        mode: "stocks",
      });
      let structured: PophiAnalysis | undefined;
      try {
        let raw = res.response.trim();
        if (raw.startsWith("```")) { raw = raw.split("```")[1]; if (raw.startsWith("json")) raw = raw.slice(4); }
        const parsed = JSON.parse(raw.trim());
        if (parsed.health_score !== undefined) structured = parsed;
      } catch { /* plain text */ }
      setMessages(p => [...p, { role: "popi", text: res.response, structured: structured ?? res.structured }]);
    } catch {
      setMessages(p => [...p, { role: "popi", text: "⚠️ Something went wrong. Make sure your API key is set in profile settings." }]);
    } finally {
      setLoading(false);
    }
  }

  // ── Idle / search state ────────────────────────────────────────────────────
  if (!inChat) return (
    <div className="bg-gradient-to-b from-[#0d1520] to-[#141414] border border-[#1a3050] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-center gap-3">
        <Avatar size="md" />
        <div>
          <div className="text-white font-semibold">Popi</div>
          <div className="text-[#4f8ef7] text-xs">Your stock analyst</div>
        </div>
      </div>

      <div className="px-5 pb-4">
        <p className="text-[#3a5a8a] text-xs leading-relaxed">
          I can see all your stock and crypto positions. Ask me anything about your holdings — concentration, sector exposure, what to trim, what to add.
        </p>
      </div>

      {/* Goal chips */}
      <div className="px-5 pb-4">
        <div className="text-[#555] text-xs mb-2">What are you focused on? <span className="text-[#1a3050]">(optional)</span></div>
        <div className="flex flex-wrap gap-1.5">
          {GOALS.map(g => (
            <button key={g.id} onClick={() => toggleGoal(g.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-all ${
                selectedGoals.includes(g.id)
                  ? "bg-[#0d1520] border-[#4f8ef7] text-white"
                  : "border-[#2a2a2a] text-[#555] hover:border-[#1a3050] hover:text-[#8a8a8a]"
              }`}>
              {g.emoji} {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search bar */}
      <div className="px-5 pb-4">
        <div className="flex gap-2">
          <textarea
            ref={inputRef as any}
            rows={1}
            value={chatInput}
            onChange={e => { setChatInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Ask Popi about your stocks…"
            className="flex-1 bg-[#111] border border-[#1a2a3a] rounded-2xl px-4 py-3 text-white text-sm outline-none focus:border-[#2563eb] placeholder-[#333] transition-colors resize-none overflow-hidden"
            style={{ minHeight: "44px", maxHeight: "160px" }}
          />
          <button onClick={() => handleSend()} disabled={!chatInput.trim()}
            className="bg-gradient-to-r from-[#2563eb] to-[#4f8ef7] text-white p-3 rounded-2xl hover:opacity-90 disabled:opacity-30 transition-opacity shrink-0">
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* Suggested questions */}
      <div className="px-5 pb-5">
        <div className="text-[#555] text-xs mb-2 uppercase tracking-wide">Try asking</div>
        <div className="space-y-1.5">
          {SUGGESTIONS.map((q, i) => (
            <button key={i} onClick={() => handleSend(q)}
              className="w-full text-left px-3.5 py-2.5 bg-[#111] hover:bg-[#0d1520] border border-[#1a1a1a] hover:border-[#1a3050] rounded-xl text-sm text-[#555] hover:text-[#ccc] transition-all">
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Chat state ─────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#141414] border border-[#2a2a2a] rounded-2xl flex flex-col" style={{ maxHeight: "82vh" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] shrink-0">
        <div className="flex items-center gap-2">
          <Avatar />
          <div>
            <div className="text-white text-sm font-semibold">Popi</div>
            <div className="text-[#3a5a8a] text-[10px]">Your stock analyst</div>
          </div>
        </div>
        <button onClick={reset} className="text-[#555] hover:text-[#8a8a8a] transition-colors" title="New conversation">
          <RotateCcw size={13} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
            {m.role === "popi" && <Avatar />}
            <div className={`max-w-[92%] ${m.role === "user" ? "bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl px-3 py-2" : ""}`}>
              {m.role === "popi" && m.structured
                ? <AnalysisCards data={m.structured} />
                : m.role === "popi"
                  ? <div className="bg-[#0d1520] border border-[#1a3050] rounded-2xl px-3 py-2.5"><SimpleMarkdown text={m.text} /></div>
                  : <p className="text-white text-sm">{m.text}</p>
              }
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-2">
            <Avatar />
            <div className="bg-[#0d1520] border border-[#1a3050] rounded-2xl px-3 py-2.5 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin text-[#4f8ef7]" />
              <span className="text-[#3a5a8a] text-xs">Popi is thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-[#2a2a2a] shrink-0 space-y-2">
        {/* Compact goal chips */}
        <div className="flex flex-wrap gap-1">
          {GOALS.map(g => (
            <button key={g.id} onClick={() => toggleGoal(g.id)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                selectedGoals.includes(g.id)
                  ? "bg-[#0d1520] border-[#4f8ef7] text-[#4f8ef7]"
                  : "border-[#222] text-[#333] hover:border-[#1a3050] hover:text-[#555]"
              }`}>
              {g.emoji} {g.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <textarea rows={1} value={chatInput}
            onChange={e => { setChatInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Ask about your positions…"
            className="flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-[#2563eb] placeholder-[#444] resize-none overflow-hidden"
            style={{ minHeight: "36px", maxHeight: "160px" }} />
          <button onClick={() => handleSend()} disabled={!chatInput.trim() || loading}
            className="bg-gradient-to-r from-[#2563eb] to-[#4f8ef7] text-white p-2 rounded-xl hover:opacity-90 disabled:opacity-40 transition-opacity">
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
