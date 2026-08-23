# The public demo

A portfolio link needs to *show* the system, not stop at a login form
nobody can pass. This is that build.

## The rule it exists to keep

**No real P.W. Nigeria data is ever published.** The database holds the
company's commercial information — supplier pricing, purchase orders,
contract values, retention. None of it may sit behind a public link,
even read-only, even anonymised: the figures alone describe PW's cost
base, and Google indexes what it can reach.

So the demo has **no backend and no database**. Every plant, supplier,
price, purchase order and project in it is invented
(`frontend/src/lib/demo/data.ts`), and a standing banner says so.

## How it works

Three pieces, all inert unless `NEXT_PUBLIC_DEMO_MODE=true`:

| File | Does |
|---|---|
| `lib/demo/data.ts` | Generates the synthetic world — seeded, so it looks the same on every visit and every deploy |
| `lib/demo/adapter.ts` | An **axios adapter** that answers every request from that data |
| `lib/demo/index.ts` | Installs the adapter and seeds a signed-in demo session |

Swapping axios' *adapter* rather than adding an interceptor means the
request never reaches the network, one hook covers the entire app (no
page, hook or API module was changed), and a demo build **cannot** call
the real backend by accident.

The SSE hook is the one thing axios doesn't cover — `EventSource` opens
its own connection — so `use-event-stream.ts` is short-circuited in demo
mode too.

Writes return `{ success: true, message: 'Demo mode — not saved' }`, so
buttons respond without pretending to persist.

Anything the adapter doesn't recognise returns an empty success, so a
page nobody thought about degrades to "no data" rather than a stack
trace in front of a visitor.

## Running it

```bash
cd frontend
npm run dev:demo      # localhost:3001
npm run build:demo    # production build
```

> **Delete `.next` before a demo build.** `NEXT_PUBLIC_*` values are
> inlined at compile time and Next caches compiled modules, so a build
> after a normal `next dev` can bake the flag in as `undefined` — the
> app then quietly runs against the real API. `rm -rf .next` first.

## Deploying

A **separate Vercel project** from the same repo:

1. New project → same repository
2. Build command: `npm run build:demo`
3. Environment variable: `NEXT_PUBLIC_DEMO_MODE` = `true`
4. Leave `NEXT_PUBLIC_API_URL` **unset** — nothing should be reachable

Cost is zero: static-plus-client-side, no server, no database, and none
of the ~50s cold start that a free-tier Render backend would add to a
link a recruiter clicks once.

Keep the production project exactly as it is. The two share code but
never share a deployment or an environment.

## What the tour shows

Fleet dashboard · fleet register · plant detail · purchase order (with
the direct/shared split and VAT) · maintenance-cost reporting ·
executive summary.

## Adding to it

The adapter routes on path. To cover another page, add a case in
`route()` and, if it needs new data, a generator in `data.ts`. Capture
the real response *shape* first — keys and types only, never values —
so the page renders exactly as it does in production.
