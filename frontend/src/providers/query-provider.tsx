'use client';

/**
 * React Query Provider
 * Handles data fetching, caching, and synchronization
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is considered fresh for 5 minutes
            staleTime: 5 * 60 * 1000,
            // Cache data for 10 minutes
            gcTime: 10 * 60 * 1000,
            // Retry failed requests 1 time
            retry: 1,
            // Don't auto-refetch on window focus - reduces API calls
            refetchOnWindowFocus: false,
            // Refetch stale queries when the browser regains connectivity
            // (e.g. after laptop sleep / WiFi reconnect)
            refetchOnReconnect: 'always',
          },
          mutations: {
            // Never auto-retry a mutation: a POST that timed out may already
            // have landed (a bill revision, a contract sum), and a retry would
            // record it twice. The user retries deliberately. (2026-10-13)
            retry: 0,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
