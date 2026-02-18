'use client';

/**
 * Authentication Provider
 * Manages auth state across the application
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
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

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Restore auth state from localStorage on mount (no network call)
  useEffect(() => {
    const savedUser = getSavedUser();
    if (savedUser && checkIsAuthenticated()) {
      setUser(savedUser);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    // Don't set isLoading here — it triggers the dashboard's full-screen spinner.
    // The login page has its own loading state for the button.
    try {
      const response = await apiLogin(credentials);
      saveAuthData(response);
      setUser(response.user);
      router.replace('/'); // replace so login page isn't in back-history
    } catch (error) {
      throw new Error(getErrorMessage(error));
    }
  }, [router]);

  const logout = useCallback(() => {
    apiLogout(); // Fire-and-forget (clears localStorage + sends server request)
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
