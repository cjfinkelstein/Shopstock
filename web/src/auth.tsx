import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { ApiError, api, getToken, setToken, setUnauthorizedHandler } from "./api";
import type { TechDashboard, User } from "./types";

const USER_CACHE_KEY = "shopstock_user";

/** Last-known identity, used only when we're offline and can't reach
 * /auth/me to confirm the session -- lets a tech who reopens the app with
 * no signal land back in the app instead of at tap-in. */
function cachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function cacheUser(u: User | null) {
  try {
    if (u) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_CACHE_KEY);
  } catch {
    /* storage unavailable -- just no offline identity fallback */
  }
}

interface AuthState {
  user: User | null;
  loading: boolean;
  myTruck: TechDashboard["my_truck"];
  tapIn: (userId: number, pin?: string) => Promise<User>;
  adminLogin: (email: string, password: string) => Promise<User>;
  resetPassword: (token: string, newPassword: string) => Promise<User>;
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
    setUnauthorizedHandler(() => {
      setUser(null);
      cacheUser(null);
    });
    if (getToken()) {
      api<User>("/auth/me")
        .then((u) => {
          setUser(u);
          cacheUser(u);
          if (u.role === "tech") loadTruck();
        })
        .catch((e) => {
          // A real 401 already cleared the session via the handler above.
          // Anything else (offline, DNS, 5xx) just means we couldn't
          // confirm the session right now -- fall back to the last-known
          // identity instead of bouncing to tap-in.
          if (e instanceof ApiError && e.status === 401) return;
          const cached = cachedUser();
          if (cached) {
            setUser(cached);
            if (cached.role === "tech") loadTruck();
          } else {
            setUser(null);
          }
        })
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
    cacheUser(r.user);
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
    cacheUser(r.user);
    return r.user;
  };

  const resetPassword = async (token: string, newPassword: string) => {
    const r = await api<{ access_token: string; user: User }>("/auth/reset-password", {
      method: "POST",
      body: { token, new_password: newPassword },
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
    cacheUser(null);
    // Drop the offline browse cache so a shared phone's next tech doesn't
    // briefly see this tech's cached recently-used items or truck stock.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_DATA_CACHE" });
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, myTruck, tapIn, adminLogin, resetPassword, logout, refreshTruck: loadTruck }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
