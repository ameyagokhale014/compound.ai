import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ReactNode } from "react";
import type { AuthUser } from "../api";
import { getAuthMe, updateAuthMe } from "../api";

const TOKEN_KEY = "auth_token";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  updateUser: (data: Parameters<typeof updateAuthMe>[1]) => Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken]   = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser]     = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) { setLoading(false); return; }
    getAuthMe(stored)
      .then((u) => {
        setUser(u);
        setToken(stored);
        // Sync API key so AI routes still work
        if (u.anthropic_api_key) {
          localStorage.setItem("anthropic_api_key", u.anthropic_api_key);
        }
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback((tok: string, u: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, tok);
    if (u.anthropic_api_key) {
      localStorage.setItem("anthropic_api_key", u.anthropic_api_key);
    }
    setToken(tok);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback(async (data: Parameters<typeof updateAuthMe>[1]) => {
    if (!token) throw new Error("Not authenticated");
    const updated = await updateAuthMe(token, data);
    setUser(updated);
    if (updated.anthropic_api_key) {
      localStorage.setItem("anthropic_api_key", updated.anthropic_api_key);
    }
    return updated;
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
