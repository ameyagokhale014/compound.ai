import { useState } from "react";
import { Eye, EyeOff, TrendingUp } from "lucide-react";
import { authSignup, authLogin } from "../api";
import { useAuth } from "../contexts/AuthContext";

interface Props {
  onSignupComplete: () => void;
}

export default function AuthPage({ onSignupComplete }: Props) {
  const { login } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    email: "", password: "", first_name: "", last_name: "", date_of_birth: "",
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "signup") {
        const res = await authSignup({
          email: form.email,
          password: form.password,
          first_name: form.first_name,
          last_name: form.last_name,
          date_of_birth: form.date_of_birth || undefined,
        });
        login(res.access_token, res.user);
        onSignupComplete();
      } else {
        const res = await authLogin(form.email, form.password);
        login(res.access_token, res.user);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? "Something went wrong. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 justify-center">
          <TrendingUp size={20} className="text-[#4f8ef7]" />
          <span className="text-white font-semibold text-lg">compound.ai</span>
        </div>

        <div className="bg-[#111] border border-[#1e1e1e] rounded-2xl p-7 shadow-2xl">
          {/* Mode toggle */}
          <div className="flex bg-[#0a0a0a] rounded-lg p-0.5 mb-6">
            {(["login", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); }}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  mode === m ? "bg-[#1e1e1e] text-white" : "text-[#555] hover:text-[#8a8a8a]"
                }`}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[#555] text-xs block mb-1">First name</label>
                  <input
                    required
                    value={form.first_name}
                    onChange={(e) => set("first_name", e.target.value)}
                    placeholder="Jane"
                    className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[#555] text-xs block mb-1">Last name</label>
                  <input
                    required
                    value={form.last_name}
                    onChange={(e) => set("last_name", e.target.value)}
                    placeholder="Doe"
                    className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-[#555] text-xs block mb-1">Email</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
              />
            </div>

            <div>
              <label className="text-[#555] text-xs block mb-1">Password</label>
              <div className="relative">
                <input
                  required
                  type={showPass ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder={mode === "signup" ? "Min 8 characters" : "••••••••"}
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 pr-9 py-2 text-white text-sm outline-none focus:border-[#444] placeholder:text-[#333]"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#444] hover:text-[#8a8a8a]"
                >
                  {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>

            {mode === "signup" && (
              <div>
                <label className="text-[#555] text-xs block mb-1">Date of birth <span className="text-[#333]">(optional)</span></label>
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => set("date_of_birth", e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#444] [color-scheme:dark]"
                />
              </div>
            )}

            {error && (
              <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black font-semibold text-sm py-2.5 rounded-lg hover:bg-[#e8e8e8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
            >
              {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>

        <p className="text-[#333] text-xs text-center mt-5">
          Your data stays local. AI features require an Anthropic API key.
        </p>
      </div>
    </div>
  );
}
