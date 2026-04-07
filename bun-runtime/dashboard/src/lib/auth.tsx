import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { api, type LoginResponse } from "./api.ts";

interface AuthContextValue {
  token: string | null;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("auth_token"));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem("auth_username"));
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (u: string, p: string) => {
    setLoading(true);
    try {
      const res: LoginResponse = await api.auth.login(u, p);
      localStorage.setItem("auth_token", res.token);
      localStorage.setItem("auth_username", res.username);
      setToken(res.token);
      setUsername(res.username);
      window.location.hash = "#/";
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    api.auth.logout().catch(() => {});
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_username");
    setToken(null);
    setUsername(null);
    window.location.hash = "#/login";
  }, []);

  return (
    <AuthContext.Provider value={{ token, username, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
