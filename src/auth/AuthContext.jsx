import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getCurrentUser, login as loginRequest, logout as logoutRequest } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    getCurrentUser({ signal: controller.signal })
      .then(({ user: restoredUser }) => {
        setUser(restoredUser);
        setStatus('authenticated');
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setUser(null);
        setStatus('unauthenticated');
        if (error.status !== 401) setAuthError('Could not verify your session. Sign in again when the API is available.');
      });

    return () => controller.abort();
  }, []);

  const login = useCallback(async (email, password) => {
    setAuthError('');
    const response = await loginRequest(email, password);
    setUser(response.user);
    setStatus('authenticated');
    return response.user;
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setUser(null);
    setStatus('unauthenticated');
    setAuthError('');
  }, []);

  const value = useMemo(() => ({
    user,
    status,
    authError,
    login,
    logout,
  }), [user, status, authError, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
