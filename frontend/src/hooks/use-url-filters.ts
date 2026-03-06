'use client';

/**
 * Hook to sync filter state with URL search params.
 *
 * When the user navigates to a detail page and presses back,
 * filters are restored from the URL instead of resetting to defaults.
 */

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo, useRef } from 'react';

/**
 * Read a single search param with a default fallback.
 */
export function useUrlFilters<T extends Record<string, string>>(
  defaults: T
): [T, (updates: Partial<T>) => void, () => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
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
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [router, pathname, defaults]
  );

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  return [current, setFilters, clearFilters];
}
