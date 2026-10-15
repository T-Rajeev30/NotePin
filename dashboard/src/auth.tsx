import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { User } from "./types";

type AuthConfig = {
  signup: "open" | "invite" | "closed";
  needsBootstrap: boolean;
};
type Ctx = {
  user: User | null | undefined;
  config: AuthConfig | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (f: {
    email: string;
    password: string;
    name: string;
    invite: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
};
const AuthCtx = createContext<Ctx>(null as never);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [config, setConfig] = useState<AuthConfig | null>(null);

  useEffect(() => {
    api
      .get<{ user: User }>("/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
    api
      .get<AuthConfig>("/api/auth/config")
      .then(setConfig)
      .catch(() => setConfig(null));
    const out = () => setUser(null);
    window.addEventListener("np-unauth", out);
    return () => window.removeEventListener("np-unauth", out);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setUser(
      (await api.post<{ user: User }>("/api/auth/login", { email, password }))
        .user,
    );
  }, []);
  const signup = useCallback(
    async (f: {
      email: string;
      password: string;
      name: string;
      invite: string;
    }) => {
      setUser((await api.post<{ user: User }>("/api/auth/signup", f)).user);
    },
    [],
  );
  const logout = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      config,
      login,
      signup,
      logout,
      setUser: (u: User) => setUser(u),
    }),
    [user, config, login, signup, logout],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
