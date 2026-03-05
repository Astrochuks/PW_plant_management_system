'use client';

/**
 * SSE hook for real-time data sync.
 *
 * Connects to /api/v1/events/stream and invalidates React Query caches
 * when backend mutations occur — so all connected clients see updates
 * without manual refresh.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Map SSE entity names to ALL React Query key prefixes that should refresh.
 *
 * When a plant is created/updated, the dashboard stats, location stats,
 * site data, reports, and insights all depend on plant data — so we
 * invalidate broadly to keep every view in sync.
 */
const ENTITY_KEY_MAP: Record<string, string[][]> = {
  plants: [
    ['plants'],
    ['dashboard'],
    ['locations'],
    ['reports'],
    ['fleet-types'],
    ['insights'],
    ['site'],
    ['notifications'],
  ],
  transfers: [
    ['transfers'],
    ['plants'],
    ['dashboard'],
    ['locations'],
    ['site'],
    ['notifications'],
  ],
  projects: [
    ['projects'],
    ['dashboard'],
    ['notifications'],
  ],
  uploads: [
    ['submissions'],
    ['uploads'],
    ['plants'],
    ['dashboard'],
    ['locations'],
    ['reports'],
    ['site'],
    ['notifications'],
  ],
  spare_parts: [
    ['spare-parts'],
    ['suppliers'],
    ['dashboard'],
    ['notifications'],
  ],
};

export function useEventStream(isAuthenticated: boolean) {
  const queryClient = useQueryClient();
  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  const cleanup = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      cleanup();
      return;
    }

    function connect() {
      // Always read fresh token on each connect attempt
      const token = sessionStorage.getItem('access_token');
      if (!token) {
        // Token not available yet — retry shortly
        retryRef.current = setTimeout(connect, 1000);
        return;
      }

      // Close any existing connection before opening new one
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }

      const url = `${API_BASE_URL}/api/v1/events/stream?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      sourceRef.current = es;

      es.onopen = () => {
        // Connected — reset retry counter
        retryCountRef.current = 0;
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const entity = data.entity as string;

          // Invalidate matching query keys
          const keys = ENTITY_KEY_MAP[entity];
          if (keys) {
            for (const key of keys) {
              queryClient.invalidateQueries({ queryKey: key });
            }
          } else {
            // Unknown entity — invalidate everything
            queryClient.invalidateQueries();
          }
        } catch {
          // Ignore malformed events
        }
      };

      es.onerror = () => {
        es.close();
        sourceRef.current = null;

        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
        retryCountRef.current++;
        retryRef.current = setTimeout(connect, delay);
      };
    }

    connect();

    // Reconnect with fresh token after visibility change (wake from sleep)
    // The auth provider refreshes the token; we reconnect to use it
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && isAuthenticated) {
        // Small delay to let auth provider refresh the token first
        setTimeout(() => {
          retryCountRef.current = 0;
          connect();
        }, 500);
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cleanup();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, queryClient, cleanup]);
}
