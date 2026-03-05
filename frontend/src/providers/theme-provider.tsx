'use client';

/**
 * Theme Provider
 * Handles dark/light mode switching with per-tab isolation.
 *
 * next-themes syncs theme across tabs via `storage` events on window.
 * We add a capture-phase listener that calls stopImmediatePropagation()
 * for our theme key, blocking next-themes' bubble-phase listener from
 * ever seeing events that originated in other tabs.
 *
 * Result: toggling dark mode in Tab A has zero effect on Tab B.
 */

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: string;
  storageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'pw-theme',
  ...props
}: ThemeProviderProps) {
  React.useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === storageKey) {
        // Storage events only fire in OTHER tabs (not the one that wrote the value).
        // Stopping propagation here prevents next-themes from reacting to another
        // tab's theme change and applying it to this tab.
        e.stopImmediatePropagation();
      }
    };
    // Capture phase ensures we run before next-themes' default bubble-phase listener.
    window.addEventListener('storage', handler, true);
    return () => window.removeEventListener('storage', handler, true);
  }, [storageKey]);

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={defaultTheme}
      enableSystem
      disableTransitionOnChange={false}
      storageKey={storageKey}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
