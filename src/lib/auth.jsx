import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

/**
 * Session lives in an httpOnly cookie; nothing token-shaped is stored in the
 * browser. `creator` is null until GET /auth/session says otherwise.
 */
export function AuthProvider({ children }) {
  const [creator, setCreator] = useState(null);
  const [activation, setActivation] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api('/auth/session');
      setCreator(data.creator);
      return data.creator;
    } catch {
      setCreator(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const applySession = useCallback((data) => {
    setCreator(data.creator);
    if (data.activation) setActivation(data.activation);
  }, []);

  const value = useMemo(
    () => ({
      creator,
      activation,
      loading,
      refresh,
      applySession,
      logout: async () => {
        await api('/auth/logout', { method: 'POST' });
        setCreator(null);
        setActivation(null);
      },
      updateProfile: (patch) =>
        api('/me', { method: 'PATCH', body: patch }).then((data) => {
          setCreator(data.creator);
          return data;
        }),
    }),
    [creator, activation, loading, refresh, applySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
