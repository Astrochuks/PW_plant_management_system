'use client';

/**
 * Authentication Provider
 * Manages auth state across the application
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
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
  refreshToken as apiRefreshToken,
} from '@/lib/api/auth';
import { getErrorMessage } from '@/lib/api/client';

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

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Schedule a proactive token refresh before the access token expires
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
        const response = await apiRefreshToken();
        saveAuthData(response);
        if (response.user) {
          setUser(response.user);
        }
        // Schedule the next refresh
        scheduleRefresh();
      } catch {
        // Refresh failed — user will be logged out on next 401
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
      router.replace('/');
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
