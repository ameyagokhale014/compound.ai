import { useState, useRef, useEffect } from "react";
import { X, Send, Sparkles, Loader2 } from "lucide-react";
import { askAdvisor } from "../api";

interface Message {
  role: "user" | "assistant";
  content: string;
  loading?: boolean;
}

function MarkdownText({ text }: { text: string }) {
  // Minimal markdown: bold, headers, bullets, code
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) {
          return <div key={i} className="text-white font-semibold text-sm mt-2">{line.slice(4)}</div>;
        }
        if (line.startsWith("## ")) {
          return <div key={i} className="text-white font-bold text-sm mt-3">{line.slice(3)}</div>;
        }
        if (line.startsWith("# ")) {
          return <div key={i} className="text-white font-bold text-base mt-3">{line.slice(2)}</div>;
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={i} className="flex gap-2 text-xs text-[#ccc]">
              <span className="text-[#555] shrink-0 mt-0.5">•</span>
              <span dangerouslySetInnerHTML={{ __html: formatInline(line.slice(2)) }} />
            </div>
          );
        }
        if (line.match(/^\d+\./)) {
          return (
            <div key={i} className="flex gap-2 text-xs text-[#ccc]">
              <span className="text-[#555] shrink-0">{line.match(/^\d+/)![0]}.</span>
              <span dangerouslySetInnerHTML={{ __html: formatInline(line.replace(/^\d+\.\s*/, "")) }} />
            </div>
          );
        }
        if (line === "") return <div key={i} className="h-1" />;
        return (
          <div key={i} className="text-xs text-[#ccc] leading-relaxed"
            dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
        );
      })}
    </div>
  );
}

function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<span class="text-white font-semibold">$1</span>')
    .replace(/`(.+?)`/g, '<code class="bg-[#2a2a2a] px-1 rounded text-[#4f8ef7] text-[11px]">$1</code>')
    .replace(/\*(.+?)\*/g, '<em class="text-[#8a8a8a]">$1</em>');
}

export default function AdvisorPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function openPanel() {
    setOpen(true);
    if (messages.length === 0) {
      await fetchAdvice();
    }
  }

  async function fetchAdvice(question?: string) {
    setLoading(true);
    const placeholder: Message = { role: "assistant", content: "", loading: true };
    setMessages((prev) => [...prev, placeholder]);

    try {
      const { response } = await askAdvisor(question);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: response },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: "⚠️ Failed to get advice. Make sure ANTHROPIC_API_KEY is set in your backend environment." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    await fetchAdvice(q);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={openPanel}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-white text-black font-semibold text-sm px-4 py-2.5 rounded-full shadow-lg hover:bg-[#f0f0f0] transition-colors"
      >
        <Sparkles size={15} />
        AI Advice
      </button>

      {/* Slide-in panel */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="fixed right-0 top-0 bottom-0 z-50 w-[420px] bg-[#111] border-l border-[#2a2a2a] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a]">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-[#4f8ef7]" />
                <span className="text-white font-semibold text-sm">AI Advisor</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-[#555] hover:text-white">
                <X size={18} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {messages.length === 0 && !loading && (
                <div className="text-center py-16 text-[#555] text-sm">
                  <Sparkles size={28} className="mx-auto mb-3 text-[#333]" />
                  Loading your portfolio analysis…
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={msg.role === "user" ? "flex justify-end" : ""}>
                  {msg.role === "user" ? (
                    <div className="bg-[#1e1e1e] border border-[#333] rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%] text-white text-xs">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="bg-[#0f1a2e] border border-[#1a3060] rounded-2xl rounded-tl-sm px-4 py-3">
                      {msg.loading ? (
                        <div className="flex items-center gap-2 text-[#4f8ef7] text-xs">
                          <Loader2 size={13} className="animate-spin" />
                          Analyzing your portfolio…
                        </div>
                      ) : (
                        <MarkdownText text={msg.content} />
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Suggested questions */}
            {messages.length > 0 && !loading && (
              <div className="px-5 pb-2 flex flex-wrap gap-1.5">
                {[
                  "What should I sell?",
                  "Where to deploy my cash?",
                  "Biggest risks?",
                  "Rebalance advice",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); setTimeout(() => handleSend(), 0); }}
                    className="text-[10px] border border-[#2a2a2a] text-[#8a8a8a] hover:text-white hover:border-[#444] rounded-full px-2.5 py-1 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="px-5 py-4 border-t border-[#2a2a2a]">
              <div className="flex items-center gap-2 bg-[#1a1a1a] border border-[#333] rounded-xl px-3 py-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                  placeholder="Ask anything about your portfolio…"
                  className="flex-1 bg-transparent text-white text-xs outline-none placeholder-[#444]"
                  disabled={loading}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className="text-[#4f8ef7] hover:opacity-80 disabled:opacity-30"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
