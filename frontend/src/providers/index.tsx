'use client';

/**
 * Combined Providers
 * Wraps all context providers for the application
 */

import { ThemeProvider } from './theme-provider';
import { QueryProvider } from './query-provider';
import { AuthProvider } from './auth-provider';
import { Toaster } from '@/components/ui/sonner';

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider defaultTheme="light" storageKey="pw-theme">
      <QueryProvider>
        <AuthProvider>
          {children}
          <Toaster 
            position="top-right" 
            richColors 
            closeButton
            toastOptions={{
              duration: 4000,
            }}
          />
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
