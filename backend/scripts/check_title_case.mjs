// Parity check: the TypeScript titleCase (frontend/src/lib/format.ts) against
// the Python golden cases (tests/test_text.py). Run from backend/:
//   node scripts/check_title_case.mjs      (node ≥ 22.6 strips types natively)
import { execSync } from 'node:child_process'
const { titleCase } = await import('../../frontend/src/lib/format.ts')
const golden = JSON.parse(execSync(`python -c "import json,sys; sys.path.insert(0,'.'); from tests.test_text import GOLDEN; print(json.dumps(GOLDEN))"`, { encoding: 'utf8' }))
let bad = 0
for (const [raw, expected] of golden) {
  const got = titleCase(raw)
  if (got !== expected) { bad++; console.log('MISMATCH\n  raw     ', JSON.stringify(raw), '\n  expected', JSON.stringify(expected), '\n  got     ', JSON.stringify(got)) }
}
console.log(bad ? `${bad} mismatches` : `titleCase parity OK on ${golden.length} cases`)
process.exit(bad ? 1 : 0)
