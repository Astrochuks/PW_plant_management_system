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
  logout: () => Promise<void>;
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

  // Check authentication on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        // First check localStorage for saved user
        const savedUser = getSavedUser();
        if (savedUser && checkIsAuthenticated()) {
          setUser(savedUser);
          // Verify token is still valid by fetching current user
          try {
            const currentUser = await getCurrentUser();
            setUser(currentUser);
          } catch {
            // Token invalid, clear auth
            setUser(null);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('access_token');
              localStorage.removeItem('user');
            }
          }
        }
      } catch (error) {
        console.error('Auth init error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setIsLoading(true);
    try {
      const response = await apiLogin(credentials);
      saveAuthData(response);
      setUser(response.user);
      router.push('/'); // Redirect to dashboard
    } catch (error) {
      throw new Error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await apiLogout();
      setUser(null);
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
      // Still clear local state even if API call fails
      setUser(null);
      router.push('/login');
    } finally {
      setIsLoading(false);
    }
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
