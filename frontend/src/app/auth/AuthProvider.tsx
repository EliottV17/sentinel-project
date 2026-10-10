import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { tokenStore } from "../api/token";
import { setUnauthorizedHandler } from "../api/client";
import { demoLogin as demoLoginEndpoint, login as loginEndpoint } from "../api/endpoints";
import { decodeJwtPayload, isExpiringSoon } from "./jwt";

export interface AuthContextValue {
  isAuthenticated: boolean;
  user: string | null;
  isDemo: boolean;
  login(username: string, password: string): Promise<void>;
  demoLogin(): Promise<void>;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}

/** Slow proactive-expiry watcher cadence (design §4.2). */
const EXP_WATCH_INTERVAL_MS = 30_000;

function isPublicRoute(pathname: string): boolean {
  return (
    matchPath({ path: "/status", end: true }, pathname) !== null ||
    matchPath({ path: "/register", end: true }, pathname) !== null
  );
}

interface AuthSnapshot {
  isAuthenticated: boolean;
  user: string | null;
  isDemo: boolean;
  expiringSoon: boolean;
}

function snapshot(): AuthSnapshot {
  const token = tokenStore.get();
  if (token === null) {
    return { isAuthenticated: false, user: null, isDemo: false, expiringSoon: false };
  }
  const payload = decodeJwtPayload(token);
  return {
    isAuthenticated: true,
    user: payload?.sub ?? null,
    isDemo: payload?.is_demo === true,
    expiringSoon: payload ? isExpiringSoon(payload, new Date()) : false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [auth, setAuth] = useState<AuthSnapshot>(() => snapshot());

  // Latest navigate/location without re-registering effects.
  const navigateRef = useRef(navigate);
  const locationRef = useRef(location);
  navigateRef.current = navigate;
  locationRef.current = location;

  // Register the client's unauthorized handler once: clear → /login?next=….
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (isPublicRoute(locationRef.current.pathname)) return;
      tokenStore.clear();
      setAuth(snapshot());
      navigateRef.current(
        `/login?next=${encodeURIComponent(locationRef.current.pathname)}`,
      );
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Proactive expiry: auto-logout before the wall of 401s.
  useEffect(() => {
    const id = setInterval(() => {
      const snap = snapshot();
      if (isPublicRoute(locationRef.current.pathname)) {
        setAuth(snap);
        return;
      }
      if (snap.isAuthenticated && snap.expiringSoon) {
        tokenStore.clear();
        setAuth(snapshot());
        navigateRef.current("/login");
        return;
      }
      setAuth(snap);
    }, EXP_WATCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { access_token } = await loginEndpoint(username, password);
    tokenStore.set(access_token);
    setAuth(snapshot());
  }, []);

  const demoLogin = useCallback(async () => {
    const { access_token } = await demoLoginEndpoint();
    tokenStore.set(access_token);
    setAuth(snapshot());
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setAuth(snapshot());
    navigateRef.current("/login");
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated: auth.isAuthenticated,
      user: auth.user,
      isDemo: auth.isDemo,
      login,
      demoLogin,
      logout,
    }),
    [auth, login, demoLogin, logout],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}
