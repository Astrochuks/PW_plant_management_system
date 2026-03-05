'use client';

/**
 * Authentication Provider
 * Manages auth state across the application
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  User,
  LoginCredentials,
  login as apiLogin,
  logout as apiLogout,
  getCurrentUser,
  saveAuthData,
  getSavedUser,
  isAuthenticated as checkIsAuthenticated,
  getTokenExpiresAt,
} from '@/lib/api/auth';
import { getErrorMessage } from '@/lib/api/client';
import { silentRefreshToken } from '@/lib/api/silent-refresh';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: React.ReactNode;
}

// Refresh the token 5 minutes before it expires
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
// Retry failed refreshes after 30 seconds
const REFRESH_RETRY_MS = 30 * 1000;

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const queryClient = useQueryClient();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against overlapping wake-up refreshes
  const isWakeRefreshingRef = useRef(false);

  // Schedule a proactive token refresh before the access token expires.
  // Uses silentRefreshToken() which bypasses the apiClient interceptors
  // to avoid triggering hardLogout() on refresh token rotation conflicts.
  const scheduleRefresh = useCallback(() => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    const expiresAt = getTokenExpiresAt();
    if (!expiresAt) return;

    const msUntilExpiry = expiresAt - Date.now();
    const msUntilRefresh = msUntilExpiry - REFRESH_BUFFER_MS;

    // If token is already close to expiry or expired, refresh now
    // If it's still fresh, schedule a future refresh
    const delay = Math.max(msUntilRefresh, 0);

    refreshTimerRef.current = setTimeout(async () => {
      try {
        const response = await silentRefreshToken();
        if (response) {
          saveAuthData(response);
          if (response.user) {
            setUser(response.user);
          }
          // Schedule the next refresh based on new token
          scheduleRefresh();
        } else {
          // Refresh returned null (token already rotated by interceptor).
          // Re-read expiry from localStorage (interceptor may have saved new tokens)
          // and reschedule based on whatever is current.
          scheduleRefresh();
        }
      } catch {
        // Refresh failed — retry in 30 seconds instead of giving up
        refreshTimerRef.current = setTimeout(() => scheduleRefresh(), REFRESH_RETRY_MS);
      }
    }, delay);
  }, []);

  // Restore auth state from localStorage on mount (no network call)
  useEffect(() => {
    const savedUser = getSavedUser();
    if (savedUser && checkIsAuthenticated()) {
      setUser(savedUser);
      scheduleRefresh();
    }
    setIsLoading(false);
  }, [scheduleRefresh]);

  // Immediately refresh the token and invalidate all queries so they
  // refetch with the new token. Called on wake / tab-focus / reconnect.
  const refreshAndInvalidate = useCallback(async () => {
    if (!checkIsAuthenticated()) return;
    if (isWakeRefreshingRef.current) return;

    const expiresAt = getTokenExpiresAt();
    // Only refresh if token is expired or within the buffer window
    if (expiresAt && expiresAt - Date.now() > REFRESH_BUFFER_MS) return;

    isWakeRefreshingRef.current = true;
    try {
      const response = await silentRefreshToken();
      if (response) {
        saveAuthData(response);
        if (response.user) setUser(response.user);
      }
      // Reschedule the proactive timer based on the (now fresh) token
      scheduleRefresh();
      // Invalidate all cached queries so they refetch with the new token
      queryClient.invalidateQueries();
    } catch {
      // Network may still be reconnecting — retry once after a short delay
      setTimeout(() => {
        isWakeRefreshingRef.current = false;
        refreshAndInvalidate();
      }, 2000);
      return;
    } finally {
      isWakeRefreshingRef.current = false;
    }
  }, [scheduleRefresh, queryClient]);

  // When the tab becomes visible again (laptop wake / tab switch), immediately
  // refresh the token and invalidate stale queries.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshAndInvalidate();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refreshAndInvalidate]);

  // When the browser regains network connectivity (fires after sleep / WiFi reconnect),
  // refresh the token so queued React Query refetches use a valid token.
  useEffect(() => {
    function handleOnline() {
      refreshAndInvalidate();
    }

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [refreshAndInvalidate]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    try {
      const response = await apiLogin(credentials);
      saveAuthData(response);
      setUser(response.user);
      scheduleRefresh();
      // Site engineers get their own dedicated UI
      if (response.user.role === 'site_engineer') {
        router.replace('/site/dashboard');
      } else {
        router.replace('/');
      }
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  }, [router, scheduleRefresh]);

  const logout = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    apiLogout();
    setUser(null);
    router.push('/login');
  }, [router]);

  const refreshUser = useCallback(async () => {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch (error) {
      console.error('Refresh user error:', error);
      setUser(null);
    }
  }, []);

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
