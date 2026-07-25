/**
 * Render the executive brief outside the browser, so its layout can be
 * proof-read before anyone clicks the button.
 *
 * Feed it the two JSON payloads the page would hold — the executive
 * summary and the findings — and it writes a real PDF from the SAME
 * buildBriefDoc() the app ships.
 *
 *   node scripts/check-brief.mjs <executive.json> <findings.json> [out.pdf]
 */

import { registerHooks } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const require = createRequire(import.meta.url)

// The app's "@/..." alias, plus a stub for the API module: buildBriefDoc
// never calls it, but it sits at the module's top level.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@/lib/api/projects') {
      return { url: pathToFileURL(path.join(HERE, 'stub-api.mjs')).href, shortCircuit: true }
    }
    if (spec.startsWith('@/')) {
      return { url: pathToFileURL(path.join(SRC, spec.slice(2) + '.ts')).href, shortCircuit: true }
    }
    return next(spec, ctx)
  },
})

const [execPath, findingsPath, outPath = 'brief.pdf'] = process.argv.slice(2)
if (!execPath || !findingsPath) {
  console.error('usage: node scripts/check-brief.mjs <executive.json> <findings.json> [out.pdf]')
  process.exit(1)
}

const { buildBriefDoc } = await import('@/lib/executive-brief-pdf')

const summary = JSON.parse(readFileSync(execPath, 'utf8'))
const findings = JSON.parse(readFileSync(findingsPath, 'utf8'))

// the page shows active projects; totals are summed over what is shown
const projects = (summary.projects ?? []).filter((p) => p.status === 'active')
const sum = (f) => projects.reduce((a, p) => a + (f(p) ?? 0), 0)
const work = sum((p) => p.works_incl_vat)
const cost = sum((p) => p.cost)

const logoPath = path.join(HERE, '..', 'public', 'images', 'logo.png')
const logo = `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`

const doc = buildBriefDoc(
  {
    projects,
    totals: {
      contract: sum((p) => p.contract_sum),
      work, cost, net: work - cost,
      margin: work ? (work - cost) / work : null,
      certified: sum((p) => p.certified),
      paid: sum((p) => p.paid_gross),
      unpaid: sum((p) => p.certified_not_paid),
      retention: sum((p) => p.retention_held),
    },
    scopeLabel: 'All projects',
  },
  findings,
  logo,
  new Date(summary.generated_at + 'T09:00:00'),
)

// pdfmake 0.3's Node entry is a ready-made instance; point it at the
// same Roboto the browser build embeds
const pdfMake = require('pdfmake')
const fontsDir = path.join(HERE, '..', 'node_modules', 'pdfmake', 'fonts', 'Roboto')
pdfMake.addFonts({
  Roboto: {
    normal: path.join(fontsDir, 'Roboto-Regular.ttf'),
    bold: path.join(fontsDir, 'Roboto-Medium.ttf'),
    italics: path.join(fontsDir, 'Roboto-Italic.ttf'),
    bolditalics: path.join(fontsDir, 'Roboto-MediumItalic.ttf'),
  },
})

const buffer = await pdfMake.createPdf(doc).getBuffer()
writeFileSync(outPath, buffer)
console.log(`wrote ${outPath} (${buffer.length} bytes)`)
