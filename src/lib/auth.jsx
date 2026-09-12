import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const TOKEN_KEY = 'buymepap_token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [creator, setCreator] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    api('/me', { token })
      .then((data) => setCreator(data.creator))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const session = useCallback((data) => {
    localStorage.setItem(TOKEN_KEY, data.token);
    setCreator(data.creator);
  }, []);

  const value = useMemo(
    () => ({
      creator,
      loading,
      token: () => localStorage.getItem(TOKEN_KEY) || undefined,
      login: (email, password) =>
        api('/auth/login', { method: 'POST', body: { email, password } }).then(session),
      signup: (payload) => api('/auth/signup', { method: 'POST', body: payload }).then(session),
      updateProfile: (patch) =>
        api('/me', { method: 'PATCH', token: localStorage.getItem(TOKEN_KEY) || undefined, body: patch }).then(
          (data) => setCreator(data.creator)
        ),
      logout: () => {
        localStorage.removeItem(TOKEN_KEY);
        setCreator(null);
      },
    }),
    [creator, loading, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
