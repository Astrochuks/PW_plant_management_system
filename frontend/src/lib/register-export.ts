/**
 * Register export — the one .xlsx layout for every register page
 * (docs/UI_STANDARD.md §3b). It mirrors the server-side Plant Register
 * export (`export_plants_excel`) cell for cell, so a projects file and a
 * plants file open looking the same:
 *
 *   row 1  height 55 · logo in A1 · title merged from B1, bold 14 #101415
 *   row 2  header · fill #FFBF36 · bold 10 · centred · medium #606060 borders
 *   rows   thin #808080 borders · vertical centre · wrap
 *   last   optional bold TOTAL row over the money columns
 *   freeze panes A3
 *
 * Values are written as stored — money gets the `#,##0.00` number format,
 * never a rounded value (CLAUDE.md rule 1).
 */

export interface RegisterExportColumn {
  header: string
  width: number
  /** Excel number format, e.g. '#,##0.00' for money, '0.00%' for a ratio */
  numFmt?: string
}

export interface RegisterExportSpec {
  /** full banner text, e.g. "P.W. NIGERIA LTD. — Ongoing Projects in Kaduna" */
  title: string
  sheetName: string
  /** without extension; the date is appended */
  fileStem: string
  columns: RegisterExportColumn[]
  rows: (string | number | null)[][]
  /** one entry per column; null leaves the cell blank. Omit for no TOTAL row. */
  totals?: (number | null)[]
}

const GOLD = 'FFFFBF36'
const INK = 'FF101415'
const thin = { style: 'thin' as const, color: { argb: 'FF808080' } }
const medium = { style: 'medium' as const, color: { argb: 'FF606060' } }
const CELL_BORDER = { top: thin, left: thin, bottom: thin, right: thin }
const HEADER_BORDER = { top: medium, left: medium, bottom: medium, right: medium }

async function logoBase64(): Promise<string | null> {
  try {
    const res = await fetch('/images/logo.png')
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    bytes.forEach((b) => { bin += String.fromCharCode(b) })
    return btoa(bin)
  } catch {
    return null
  }
}

export async function exportRegisterExcel(spec: RegisterExportSpec): Promise<string> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const ws = wb.addWorksheet(spec.sheetName)
  const n = spec.columns.length

  // Row 1 — brand banner
  ws.getRow(1).height = 55
  const logo = await logoBase64()
  if (logo) {
    const id = wb.addImage({ base64: logo, extension: 'png' })
    ws.addImage(id, { tl: { col: 0.05, row: 0.08 }, ext: { width: 50, height: 50 } })
  }
  const titleCol = logo && n > 1 ? 2 : 1
  if (n > titleCol) ws.mergeCells(1, titleCol, 1, n)
  const title = ws.getCell(1, titleCol)
  title.value = spec.title
  title.font = { bold: true, size: 14, color: { argb: INK } }
  title.alignment = { vertical: 'middle' }

  // Row 2 — header
  spec.columns.forEach((c, i) => {
    const cell = ws.getCell(2, i + 1)
    cell.value = c.header
    cell.font = { bold: true, size: 10, color: { argb: INK } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = HEADER_BORDER
  })

  // Data
  spec.rows.forEach((r, ri) => {
    r.forEach((v, ci) => {
      const cell = ws.getCell(ri + 3, ci + 1)
      cell.value = v
      cell.border = CELL_BORDER
      cell.alignment = { vertical: 'middle', wrapText: true }
      const fmt = spec.columns[ci]?.numFmt
      if (fmt && typeof v === 'number') cell.numFmt = fmt
    })
  })

  // TOTAL row
  if (spec.totals && spec.totals.some((t) => t != null)) {
    const r = spec.rows.length + 3
    spec.columns.forEach((c, ci) => {
      const cell = ws.getCell(r, ci + 1)
      const t = spec.totals![ci]
      cell.value = ci === 0 && t == null ? 'TOTAL' : t
      cell.font = { bold: true }
      cell.border = CELL_BORDER
      if (c.numFmt && typeof t === 'number') cell.numFmt = c.numFmt
    })
  }

  spec.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 2 }]

  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const fileName = `${spec.fileStem}_${new Date().toISOString().slice(0, 10)}.xlsx`
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return fileName
}
