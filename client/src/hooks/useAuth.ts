import { useState, useEffect, useCallback } from 'react';
import type { AuthUser } from '../types';

const TOKEN_KEY = 'weconnect_auth_token';
const USER_KEY = 'weconnect_auth_user';
const API_BASE = 'http://localhost:8080';

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem(USER_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY) || null;
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Validate session on mount
  useEffect(() => {
    const checkAuth = async () => {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${storedToken}`,
          },
        });

        if (res.ok) {
          const data = await res.json();
          const currentUser = data.user || { username: data.username };
          setUser(currentUser);
          localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
        } else {
          // Token expired or invalid
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setUser(null);
          setToken(null);
        }
      } catch (err) {
        console.warn('Auth validation network error, preserving offline session if available:', err);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data.error || data.message || 'Login failed. Please check your credentials.';
        setError(msg);
        setIsLoading(false);
        return false;
      }

      const receivedToken = data.token;
      const receivedUser = data.user || { username: username.trim() };

      setToken(receivedToken);
      setUser(receivedUser);
      localStorage.setItem(TOKEN_KEY, receivedToken);
      localStorage.setItem(USER_KEY, JSON.stringify(receivedUser));
      setIsLoading(false);
      return true;
    } catch (err: any) {
      setError(err?.message || 'Server connection error');
      setIsLoading(false);
      return false;
    }
  }, []);

  const register = useCallback(async (username: string, password: string): Promise<boolean> => {
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const msg = data.error || data.message || 'Registration failed.';
        setError(msg);
        setIsLoading(false);
        return false;
      }

      const receivedToken = data.token;
      const receivedUser = data.user || { username: username.trim() };

      setToken(receivedToken);
      setUser(receivedUser);
      localStorage.setItem(TOKEN_KEY, receivedToken);
      localStorage.setItem(USER_KEY, JSON.stringify(receivedUser));
      setIsLoading(false);
      return true;
    } catch (err: any) {
      setError(err?.message || 'Server connection error');
      setIsLoading(false);
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    setToken(null);
    setError(null);
  }, []);

  return {
    user,
    token,
    isLoading,
    error,
    login,
    register,
    logout,
    setError,
  };
}
