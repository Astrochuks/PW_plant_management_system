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
 * Shown on the sign-in page and pre-filled into the form.
 *
 * Signing out used to be a dead end: the demo has no auth server, so
 * the login form could never succeed and a visitor who clicked "Sign
 * out" was stuck on it. The adapter now answers POST /auth/login, and
 * these are the credentials the page advertises. Any email/password is
 * in fact accepted — there is nothing to authenticate against.
 */
export const DEMO_CREDENTIALS = {
  email: 'demo@pw-plant.example',
  password: 'demo',
} as const

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

  // Not on the sign-in page. Signing out clears sessionStorage and does a
  // full-page redirect to /login, which re-runs this module — so seeding
  // unconditionally would put the session straight back and bounce the
  // visitor to the dashboard, making "Sign out" look broken. Skipping
  // here lets the login screen actually appear, with its credentials
  // pre-filled, and the adapter answers the sign-in that follows.
  if (window.location.pathname.startsWith('/login')) return

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
