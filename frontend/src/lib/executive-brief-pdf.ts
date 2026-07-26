/**
 * The executive brief — one A4 page, built as a real PDF file.
 *
 * Written for a reader who will not log in: what our clients are holding,
 * where the projects stand, and the few things that need a decision. It
 * downloads as a file so it can be forwarded, printed, or put on a desk.
 *
 * Everything on the page comes from figures the executive summary is
 * already showing (so the brief and the screen can never disagree) plus
 * the findings endpoint, which supplies facts only — the sentences are
 * composed here, where the naira formatting lives.
 */

import {
  getExecutiveBrief, type BriefFinding, type PortfolioProject, type RepeatRun,
} from '@/lib/api/projects'
import { fmtDate, isoWeek, naira, num, pctFmt } from '@/lib/format'

/* eslint-disable @typescript-eslint/no-explicit-any */

const GOLD = '#ffbf36'
const INK = '#101415'
const BODY = '#2b2f31'
const MUTED = '#6b6f70'
const HAIR = '#d9d6cf'
const WASH = '#faf7f0'
const RED = '#a32020'

const WIDTH = 523 // A4 portrait less 36pt margins

const wk = (year?: number | null, week?: number | null): string =>
  year && week ? `W${String(week).padStart(2, '0')} ${year}` : '—'

const signedPct = (v: number | null | undefined): string =>
  v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`

// ── finding → prose ───────────────────────────────────────────────────
// The backend hands over facts; the wording lives here. Each card ends in
// something the reader can actually decide.

interface Card { title: string; figure: string; body: string; decision: string }

const repeatSentence = (p: string, r: RepeatRun): string =>
  `For ${r.weeks} straight stored weeks — ${wk(r.from_year, r.from_week)} to ` +
  `${wk(r.to_year, r.to_week)} — ${p}'s per-machine fuel sheet is identical: ` +
  `the same ${r.plants} machines, the same ${num(r.litres)} litres, week after week.`

function composeFinding(f: BriefFinding): Card {
  const x = f.facts
  const p = f.project

  if (f.kind === 'fuel_unattributed') {
    const worth = naira(f.impact_naira, true)
    return {
      title: x.repeat ? 'The fuel record is a photocopy' : 'Fuel we cannot trace to a machine',
      figure: worth,
      body:
        (x.repeat ? repeatSentence(p, x.repeat) + ' ' : '') +
        `Against that, the Cost Report shows ${num(x.charged_litres)} litres bought ` +
        `across ${x.weeks} stored weeks and ${num(x.logged_litres)} logged to a machine. ` +
        `${num(x.gap_litres)} litres — ${pctFmt(x.gap_share, 0)} of the fuel, ${worth} at the ` +
        `price we paid — is diesel no machine is recorded as burning.`,
      decision:
        'Fuel logged per machine every week, entered at site so last week’s sheet ' +
        'cannot be sent again — or we keep buying fuel we cannot trace.',
    }
  }

  if (f.kind === 'fuel_repeated_log' && x.repeat) {
    return {
      title: 'The fuel record is a photocopy',
      figure: `${x.repeat.weeks} weeks`,
      body:
        repeatSentence(p, x.repeat) +
        ' Nothing moved, nothing broke down, nothing drew a different litre. ' +
        'The sheet is being carried forward, not filled in.',
      decision: 'Fuel logged per machine every week, entered at site.',
    }
  }

  if (f.kind === 'diesel_price') {
    return {
      title: `Diesel rose ${signedPct(x.rate_pct)} in one week`,
      // no arrow glyph: the embedded font has no U+2192 and prints a box
      figure: `${naira(x.from_rate)}/L to ${naira(x.to_rate)}/L`,
      body:
        `Between ${wk(x.from_year, x.from_week)} and ${wk(x.to_year, x.to_week)} the diesel ` +
        `spend rose ${signedPct(x.spend_pct)} while the litres delivered rose only ` +
        `${signedPct(x.litres_pct)}. The rest is price. At the volume we buy, that swing is ` +
        `${naira(x.extra_naira, true)} on a single week — against ${naira(x.ago_spend, true)} ` +
        `of AGO in the record, the largest line in our cost report.`,
      decision:
        'Who approved the new rate, and is it one supplier? Confirm the price ' +
        'before the next delivery is drawn.',
    }
  }

  if (f.kind === 'never_reported') {
    return {
      title: `${p} has never reported`,
      figure: 'No data',
      body:
        `${p} is on the register but no weekly workbook has ever arrived, so it ` +
        'contributes nothing to any figure on this page.',
      decision: 'Confirm whether the site is running, and who owns its weekly return.',
    }
  }

  // stale_reporting, single project
  return {
    title: `${p} is reporting late`,
    figure: `${x.days} days`,
    body:
      `Its last workbook covers the week ending ${fmtDate(x.week_ending)} ` +
      `(${wk(x.year, x.week)}), ${x.weeks_received} week${x.weeks_received === 1 ? '' : 's'} ` +
      'stored in all. Every figure on this page for that site is true as at that date.',
    decision: 'Instruct the site to resume the weekly return.',
  }
}

/** Every late site reads as one problem, not one card each. */
function composeStale(fs: BriefFinding[]): Card {
  if (fs.length === 1) return composeFinding(fs[0])
  const withDays = fs.filter((f) => f.facts.days != null)
    .sort((a, b) => (b.facts.days ?? 0) - (a.facts.days ?? 0))
  const list = withDays
    .map((f) => `${f.project} last reported ${fmtDate(f.facts.week_ending)} (${f.facts.days} days)`)
    .join('; ')
  const never = fs.filter((f) => f.kind === 'never_reported')
  return {
    title: 'We are steering on old numbers',
    figure: withDays.map((f) => `${f.facts.days}`).join(' & ') + ' days',
    body:
      `${list}.` +
      (never.length ? ` ${never.map((f) => f.project).join(', ')} has never reported at all.` : '') +
      ' Everything on this page is exactly as current as the last workbook each site sent in.',
    decision:
      'Instruct every site to resume the weekly return, and approve site data ' +
      'entry so a report cannot simply be re-sent unchanged.',
  }
}

export function briefCards(findings: BriefFinding[], limit = 3): Card[] {
  const late = findings.filter(
    (f) => f.kind === 'stale_reporting' || f.kind === 'never_reported')
  const priced = findings.filter(
    (f) => f.kind !== 'stale_reporting' && f.kind !== 'never_reported')
  // the backend already ranked `priced` by what each is worth
  return [...priced.map(composeFinding), ...(late.length ? [composeStale(late)] : [])]
    .slice(0, limit)
}

// ── pdfmake furniture ─────────────────────────────────────────────────

const sectionHead = (title: string) => ({
  stack: [
    { text: title.toUpperCase(), bold: true, fontSize: 7, characterSpacing: 1.1, color: INK },
    { canvas: [{ type: 'line', x1: 0, y1: 2, x2: WIDTH, y2: 2, lineWidth: 0.5, lineColor: HAIR }] },
  ],
  margin: [0, 13, 0, 5] as [number, number, number, number],
})

/** A panel with the brand rule down its left edge. */
const goldPanel = (content: any) => ({
  table: { widths: ['*'], body: [[{ stack: [content], fillColor: WASH, margin: [8, 6, 8, 7] }]] },
  layout: {
    hLineWidth: () => 0.5, hLineColor: () => HAIR,
    vLineWidth: (i: number) => (i === 0 ? 3 : 0.5),
    vLineColor: (i: number) => (i === 0 ? GOLD : HAIR),
    paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
  },
})

const decisionBar = (text: string) => ({
  table: {
    widths: ['*'],
    body: [[{
      fillColor: INK, margin: [7, 5, 7, 5],
      text: [
        { text: 'DECISION   ', color: GOLD, bold: true, fontSize: 6.5, characterSpacing: 0.6 },
        { text, color: '#ffffff', fontSize: 7.8 },
      ],
    }]],
  },
  layout: 'noBorders',
  margin: [0, 5, 0, 0] as [number, number, number, number],
})

// ── the document ──────────────────────────────────────────────────────

export interface BriefInput {
  projects: PortfolioProject[]
  totals: {
    contract: number; work: number; cost: number; net: number
    margin: number | null; certified: number; paid: number
    unpaid: number; retention: number
  }
  /** What the page is filtered to — "All projects", a state, or one project. */
  scopeLabel: string
}

/**
 * The document itself — pure, so the layout can be rendered and read
 * without a browser (see scripts/check-brief.mjs).
 */
export function buildBriefDoc(
  input: BriefInput,
  findings: BriefFinding[],
  logo: string | null,
  now: Date,
): any {
  const { projects, totals, scopeLabel } = input
  const ids = new Set(projects.map((p) => p.id))
  const cards = briefCards(findings.filter((f) => ids.has(f.project_id)))

  const oldestUnpaid = Math.max(
    ...projects
      .filter((p) => p.certified_not_paid && p.days_since_payment != null)
      .map((p) => p.days_since_payment as number),
    -1,
  )
  const held = totals.unpaid + totals.retention
  // A site that has sent no certificate ledger has an UNKNOWN client
  // position, not a nil one — never print ₦0 for something unreported.
  const hasLedger = projects.some((p) => p.certified != null)
  const cash = (v: number) => (hasLedger ? naira(v) : 'Not reported')

  // ── projects table: one row per project, so it grows with the portfolio
  const th = (t: string, right = true) => ({
    text: t, bold: true, fontSize: 7, color: INK,
    alignment: right ? 'right' : 'left', fillColor: GOLD, margin: [2, 3, 2, 3],
  })
  const money = (v: number | null | undefined) => ({
    text: v == null ? '—' : naira(v), alignment: 'right', fontSize: 7,
  })

  // biggest first, the way the page ranks them by default
  const ordered = [...projects].sort((a, b) => b.works_incl_vat - a.works_incl_vat)

  const projectRows = ordered.map((p) => [
    {
      text: p.short_name || p.project_name,
      bold: true, fontSize: 7, color: INK,
    },
    { text: pctFmt(p.pct_complete), alignment: 'right', fontSize: 7 },
    money(p.works_incl_vat),
    money(p.cost),
    { text: naira(p.net), alignment: 'right', fontSize: 7, bold: true },
    { text: pctFmt(p.margin), alignment: 'right', fontSize: 7 },
    money(p.certified_not_paid),
    {
      alignment: 'right', fontSize: 7,
      text: [
        { text: `${wk(p.latest_year, p.latest_week)}\n` },
        {
          text: p.latest_week_ending ? fmtDate(p.latest_week_ending) : 'never reported',
          fontSize: 6,
          color: (p.days_since_report ?? 0) > 21 ? RED : MUTED,
        },
      ],
    },
  ])

  const totalRow = [
    { text: `All ${projects.length} project${projects.length === 1 ? '' : 's'}`, bold: true, fontSize: 7, color: INK },
    { text: '', alignment: 'right' },
    { text: naira(totals.work), alignment: 'right', fontSize: 7, bold: true },
    { text: naira(totals.cost), alignment: 'right', fontSize: 7, bold: true },
    { text: naira(totals.net), alignment: 'right', fontSize: 7, bold: true },
    { text: pctFmt(totals.margin), alignment: 'right', fontSize: 7, bold: true },
    { text: naira(totals.unpaid), alignment: 'right', fontSize: 7, bold: true },
    { text: '', alignment: 'right' },
  ]

  return {
    pageSize: 'A4',
    pageMargins: [36, 30, 36, 30] as [number, number, number, number],
    defaultStyle: { fontSize: 8.4, color: BODY, lineHeight: 1.25 },
    content: [
      // ── masthead ──────────────────────────────────────────────────
      {
        columns: [
          {
            width: 'auto',
            columns: [
              ...(logo ? [{ image: logo, width: 34, margin: [0, 0, 7, 0] }] : []),
              {
                width: 'auto',
                stack: [
                  { text: 'P.W. NIGERIA LTD.', bold: true, fontSize: 10, color: INK },
                  { text: 'CENTRAL REPORTING SYSTEM', fontSize: 6.2, color: MUTED, characterSpacing: 1 },
                ],
                margin: [0, 6, 0, 0],
              },
            ],
          },
          {
            width: '*',
            alignment: 'right',
            stack: [
              { text: 'PROJECTS BRIEF', fontSize: 6.4, color: MUTED, characterSpacing: 1.4 },
              { text: `Week ${isoWeek(now)} · ${now.getFullYear()}`, bold: true, fontSize: 16, color: INK, margin: [0, 1, 0, 0] },
              {
                text: now.toLocaleDateString('en-GB', {
                  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                }),
                fontSize: 7.4, color: MUTED,
              },
            ],
          },
        ],
      },
      { canvas: [{ type: 'rect', x: 0, y: 0, w: WIDTH, h: 6, color: GOLD }], margin: [0, 7, 0, 0] },
      {
        text: `For the Managing Director · ${scopeLabel}. Every figure below is recomputed ` +
              'from the site weekly-report workbooks — nothing is re-keyed by hand.',
        fontSize: 7.2, color: MUTED, margin: [0, 4, 0, 0],
      },

      // ── cash ──────────────────────────────────────────────────────
      sectionHead('What our clients are holding'),
      {
        columns: [
          {
            width: 168,
            stack: [goldPanel({
              stack: [
                { text: 'EARNED, NOT IN THE BANK', fontSize: 6.2, color: MUTED, characterSpacing: 0.9 },
                ...(hasLedger
                  ? [
                      { text: naira(held, true), fontSize: 24, bold: true, color: INK, margin: [0, 3, 0, 1] },
                      { text: naira(held), fontSize: 7.6, color: BODY },
                    ]
                  : [
                      { text: 'Not reported', fontSize: 15, bold: true, color: MUTED, margin: [0, 4, 0, 2] },
                      { text: 'No certificate ledger has reached us', fontSize: 7.4, color: BODY },
                    ]),
                ...(oldestUnpaid >= 0
                  ? [{
                      text: `${oldestUnpaid} days since a payment`,
                      fontSize: 7.6, bold: true, color: RED, margin: [0, 5, 0, 0],
                    }]
                  : []),
              ],
            })],
          },
          {
            width: '*',
            stack: [
              {
                table: {
                  widths: ['*', 'auto'],
                  body: [
                    [
                      {
                        stack: [
                          { text: 'Certified, not yet paid', fontSize: 8 },
                          { text: 'Work the client has signed for and not settled', fontSize: 6.8, color: MUTED },
                        ],
                        border: [false, false, false, true],
                      },
                      { text: cash(totals.unpaid), alignment: 'right', bold: true, fontSize: 8.6, color: hasLedger ? INK : MUTED, border: [false, false, false, true] },
                    ],
                    [
                      {
                        stack: [
                          { text: 'Retention held', fontSize: 8 },
                          { text: 'Deducted from certificates, releasable on completion', fontSize: 6.8, color: MUTED },
                        ],
                        border: [false, false, false, true],
                      },
                      { text: cash(totals.retention), alignment: 'right', bold: true, fontSize: 8.6, color: hasLedger ? INK : MUTED, border: [false, false, false, true] },
                    ],
                    [
                      {
                        stack: [
                          { text: 'Certified to date', fontSize: 8 },
                          { text: hasLedger ? `Against ${naira(totals.paid)} received in payments (gross)` : 'No payment ledger received either', fontSize: 6.8, color: MUTED },
                        ],
                        border: [false, false, false, false],
                      },
                      { text: cash(totals.certified), alignment: 'right', bold: true, fontSize: 8.6, color: hasLedger ? INK : MUTED, border: [false, false, false, false] },
                    ],
                  ],
                },
                layout: {
                  hLineWidth: () => 0.5, hLineColor: () => HAIR, vLineWidth: () => 0,
                  paddingLeft: () => 0, paddingRight: () => 0,
                  paddingTop: () => 3.5, paddingBottom: () => 3.5,
                },
              },
              decisionBar(
                !hasLedger
                  ? 'No certificate or payment ledger has reached us for the work shown — ' +
                    'the client position cannot be stated until it does.'
                  : oldestUnpaid >= 0
                    ? `Chase the outstanding certificates. The oldest has been unpaid ${oldestUnpaid} days.`
                    : 'No certificate is outstanding on the projects shown.',
              ),
            ],
          },
        ],
        columnGap: 12,
      },

      // ── projects ──────────────────────────────────────────────────
      sectionHead('Where the projects stand'),
      {
        table: {
          headerRows: 1,
          widths: [110, 30, 72, 68, 68, 34, 68, 55],
          body: [
            [
              th('Project', false), th('% Compl.'), th('Work done (Incl. VAT)'),
              th('Cost'), th('Net'), th('Margin'), th('Certified, not paid'),
              th('Last report'),
            ],
            ...projectRows,
            ...(projects.length > 1 ? [totalRow] : []),
          ],
        },
        layout: {
          hLineWidth: (i: number, node: any) =>
            i === 1 ? 0 : i === node.table.body.length - (projects.length > 1 ? 1 : 0) ? 0.9 : 0.5,
          hLineColor: (i: number, node: any) =>
            i === node.table.body.length - (projects.length > 1 ? 1 : 0) ? INK : HAIR,
          vLineWidth: () => 0,
          paddingLeft: () => 2, paddingRight: () => 2,
          paddingTop: () => 3, paddingBottom: () => 3,
        },
      },

      // ── decisions ─────────────────────────────────────────────────
      ...(cards.length
        ? [
            sectionHead(
              cards.length === 1
                ? 'One thing that needs your decision'
                : `${cards.length === 2 ? 'Two' : 'Three'} things that need your decision`,
            ),
            {
              columns: cards.map((c) => ({
                width: '*',
                stack: [
                  { canvas: [{ type: 'rect', x: 0, y: 0, w: 163, h: 3, color: GOLD }] },
                  { text: c.title, bold: true, fontSize: 8.4, color: INK, margin: [0, 5, 0, 2] },
                  { text: c.figure, bold: true, fontSize: 12, color: INK, margin: [0, 0, 0, 3] },
                  { text: c.body, fontSize: 7.3 },
                  {
                    text: [
                      { text: 'DECISION\n', fontSize: 6.2, color: MUTED, bold: true, characterSpacing: 0.6 },
                      { text: c.decision, fontSize: 7.2, color: INK },
                    ],
                    margin: [0, 4, 0, 0],
                  },
                ],
              })),
              columnGap: 12,
            },
          ]
        : []),

      // ── footer ────────────────────────────────────────────────────
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: WIDTH, y2: 0, lineWidth: 0.5, lineColor: HAIR }],
        margin: [0, 13, 0, 5],
      },
      {
        text: [
          { text: 'One caveat, stated plainly. ', bold: true, color: INK },
          {
            text: 'Contractual completion dates are quoted from the register. Where a ' +
                  'project still carries its workbook’s default date, months overdue are ' +
                  'not stated on this page — the award letter is needed to correct it. ' +
                  'A project that has sent no certificate or payment ledger shows its ' +
                  'certified and retention position as unknown, not as nil.',
          },
        ],
        fontSize: 6.9, color: BODY,
      },
      {
        text:
          'Computed by the P.W. Central Reporting System from the stored site weeks · ' +
          'works valued at BEME rates and grossed at 7.5% VAT · costs from the site Cost ' +
          'Report · certificates and payments from the site ledgers · every figure drills ' +
          'down to the week, the bill and the machine behind it.',
        fontSize: 6.6, color: MUTED, margin: [0, 3, 0, 0],
      },
    ],
  }

}

export const briefFileName = (now: Date): string =>
  `PW_Executive_Brief_W${isoWeek(now)}_${now.toISOString().slice(0, 10)}.pdf`

/** Fetch the findings, build the page, hand the reader a file. */
export async function downloadExecutiveBrief(input: BriefInput): Promise<void> {
  const brief = await getExecutiveBrief()

  let logo: string | null = null
  try {
    const buf = await (await fetch('/images/logo.png')).arrayBuffer()
    const bin = Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join('')
    logo = `data:image/png;base64,${btoa(bin)}`
  } catch {
    // the logo is decoration — never block the brief over it
  }

  const now = new Date()
  const doc = buildBriefDoc(input, brief.findings, logo, now)

  const pdfMakeMod: any = await import('pdfmake/build/pdfmake')
  const pdfMake = pdfMakeMod.default ?? pdfMakeMod
  const vfsMod: any = await import('pdfmake/build/vfs_fonts')
  pdfMake.addVirtualFileSystem(vfsMod.default ?? vfsMod)

  pdfMake.createPdf(doc).download(briefFileName(now))
}
