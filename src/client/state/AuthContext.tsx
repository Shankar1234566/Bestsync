import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getToken, setToken } from '../api/client';
import type { ProfileSummary, PublicUser } from '../../shared';

interface AuthContextValue {
  user: PublicUser | null;
  profile: ProfileSummary | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: {
    username: string;
    email: string;
    password: string;
    country?: string;
  }) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(getToken() !== null);

  const refreshProfile = useCallback(async () => {
    if (!getToken()) return;
    try {
      const me = await api.me();
      setUser(me.user);
      setProfile(me.profile);
    } catch {
      // Expired/invalid token — clear it so the UI shows signed-out state.
      setToken(null);
      setUser(null);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    void refreshProfile().finally(() => setLoading(false));
  }, [refreshProfile]);

  const login = useCallback(async (identifier: string, password: string) => {
    const result = await api.login({ identifier, password });
    setToken(result.token);
    setUser(result.user);
    const me = await api.me();
    setProfile(me.profile);
  }, []);

  const register = useCallback(
    async (input: { username: string; email: string; password: string; country?: string }) => {
      const result = await api.register(input);
      setToken(result.token);
      setUser(result.user);
      const me = await api.me();
      setProfile(me.profile);
    },
    [],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setProfile(null);
  }, []);

  const value = useMemo(
    () => ({ user, profile, loading, login, register, logout, refreshProfile }),
    [user, profile, loading, login, register, logout, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
