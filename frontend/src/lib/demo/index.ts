/**
 * Public demo mode.
 *
 * Turned on by NEXT_PUBLIC_DEMO_MODE=true at build time, so it is a
 * property of a SEPARATE Vercel deployment — the production build has
 * no demo code path and the demo build has no backend URL.
 *
 * Two things happen when it is on:
 *   1. axios is given an adapter that answers from synthetic data, so
 *      no request ever leaves the browser (see `adapter.ts`);
 *   2. a demo session is seeded into sessionStorage, so the visitor
 *      lands on the dashboard instead of a login form they cannot pass.
 */

import type { AxiosInstance } from 'axios'

import { DEMO_USER, demoAdapter } from './adapter'

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

export { DEMO_USER }

/**
 * Seed a signed-in session.
 *
 * The auth provider reads these keys on mount, so no change to its
 * logic is needed — it simply finds a user already there. The token is
 * a placeholder string: nothing verifies it, because nothing receives
 * it.
 */
function seedSession(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('access_token', 'demo-token')
    sessionStorage.setItem('refresh_token', 'demo-refresh')
    sessionStorage.setItem('user', JSON.stringify(DEMO_USER))
    // far future, so nothing tries to refresh
    sessionStorage.setItem('token_expires_at', String(Date.now() + 365 * 86400000))
  } catch {
    /* private browsing with storage disabled — the adapter still works */
  }
}

let installed = false

export function installDemoMode(client: AxiosInstance): void {
  if (!IS_DEMO || installed) return
  installed = true
  client.defaults.adapter = demoAdapter
  seedSession()
}
