'use client';

/**
 * Hook to sync filter state with URL search params.
 *
 * When the user navigates to a detail page and presses back,
 * filters are restored from the URL instead of resetting to defaults.
 */

import { useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useMemo, useRef } from 'react';

/**
 * Read a single search param with a default fallback.
 */
export function useUrlFilters<T extends Record<string, string>>(
  defaults: T
): [T, (updates: Partial<T>) => void, () => void] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Use ref to avoid stale closures in callbacks
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const current = useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const val = searchParams.get(key);
      if (val !== null) {
        (result as Record<string, string>)[key] = val;
      }
    }
    return result;
  }, [searchParams, defaults]);

  const setFilters = useCallback(
    (updates: Partial<T>) => {
      const params = new URLSearchParams(searchParamsRef.current.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === null || value === '' || value === defaults[key]) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      }
      const qs = params.toString();
      // Shallow update: window.history keeps useSearchParams in sync
      // (Next 14.1+) WITHOUT a server round-trip per change —
      // router.replace re-rendered the route from the server and made
      // every filter click feel laggy.
      window.history.replaceState(null, '', `${pathname}${qs ? `?${qs}` : ''}`);
    },
    [pathname, defaults]
  );

  const clearFilters = useCallback(() => {
    window.history.replaceState(null, '', pathname);
  }, [pathname]);

  return [current, setFilters, clearFilters];
}
