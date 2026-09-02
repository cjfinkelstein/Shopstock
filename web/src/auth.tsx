import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, getToken, setToken, setUnauthorizedHandler } from "./api";
import type { TechDashboard, User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  myTruck: TechDashboard["my_truck"];
  tapIn: (userId: number, pin?: string) => Promise<User>;
  adminLogin: (email: string, password: string) => Promise<User>;
  logout: () => void;
  refreshTruck: () => void;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [myTruck, setMyTruck] = useState<TechDashboard["my_truck"]>(null);

  const loadTruck = useCallback(() => {
    api<TechDashboard>("/dashboard/tech")
      .then((d) => setMyTruck(d.my_truck))
      .catch(() => setMyTruck(null));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (getToken()) {
      api<User>("/auth/me")
        .then((u) => {
          setUser(u);
          if (u.role === "tech") loadTruck();
        })
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    }
  }, [loadTruck]);

  const tapIn = async (userId: number, pin?: string) => {
    const r = await api<{ access_token: string; user: User }>("/auth/tap", {
      method: "POST",
      body: { user_id: userId, pin },
    });
    setToken(r.access_token);
    setUser(r.user);
    loadTruck();
    return r.user;
  };

  const adminLogin = async (email: string, password: string) => {
    const r = await api<{ access_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setToken(r.access_token);
    setUser(r.user);
    return r.user;
  };

  const logout = () => {
    api("/auth/logout", { method: "POST" }).catch(() => {});
    setToken(null);
    setUser(null);
    setMyTruck(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, myTruck, tapIn, adminLogin, logout, refreshTruck: loadTruck }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
