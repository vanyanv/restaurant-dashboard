/**
 * Minimal xlsx reader for dev scripts. Uses the system `unzip` binary to read
 * the xlsx package (xlsx is just a zip of XML parts) and a small regex-based
 * XML walker to extract cell values. Handles shared strings, inline strings,
 * and numeric cells. Does NOT interpret formats — numbers are returned as JS
 * numbers, dates come through as Excel serials (use excelSerialToDate()).
 *
 * Good enough for reading this project's weekly P&L sheets. Not a general
 * xlsx library — don't reuse for anything adversarial.
 */
import { execFileSync } from "child_process"

export interface Cell {
  ref: string            // e.g. "AB12"
  row: number            // 1-based
  col: number            // 1-based (A=1)
  colLetters: string     // "AB"
  value: string | number | null
}

export interface Sheet {
  name: string
  rows: Map<number, Map<number, Cell>>  // row → col → Cell
  maxRow: number
  maxCol: number
}

export interface Workbook {
  sheets: Sheet[]
  sheetByName: Map<string, Sheet>
}

// ─── Public API ───

export function parseXlsx(xlsxPath: string): Workbook {
  const sharedStrings = readSharedStrings(xlsxPath)
  const sheetRefs = readSheetRefs(xlsxPath)
  const sheets: Sheet[] = sheetRefs.map(({ name, target }) => {
    const xml = unzipFile(xlsxPath, `xl/${target}`)
    return parseSheet(name, xml, sharedStrings)
  })
  return { sheets, sheetByName: new Map(sheets.map((s) => [s.name, s])) }
}

/** Convert Excel date serial (days since 1899-12-30, with Excel's 1900 leap bug) to a UTC JS Date. */
export function excelSerialToDate(serial: number): Date {
  // 25569 = days between 1899-12-30 and 1970-01-01
  const ms = (serial - 25569) * 86400 * 1000
  return new Date(ms)
}

export function colLettersToIndex(letters: string): number {
  let n = 0
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64)
  return n
}

export function colIndexToLetters(idx: number): string {
  let n = idx, s = ""
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// ─── Internals ───

function unzipFile(xlsxPath: string, innerPath: string): string {
  try {
    return execFileSync("unzip", ["-p", xlsxPath, innerPath], { encoding: "utf8" })
  } catch (err: any) {
    throw new Error(`Failed to extract ${innerPath} from ${xlsxPath}: ${err.message}`)
  }
}

function readSharedStrings(xlsxPath: string): string[] {
  let xml: string
  try { xml = unzipFile(xlsxPath, "xl/sharedStrings.xml") }
  catch { return [] }  // xlsx is allowed to have no shared strings
  const out: string[] = []
  // Each <si>...</si> may contain multiple <t>...</t> segments (rich text) — concat all.
  const siRe = /<si[^>]*>([\s\S]*?)<\/si>/g
  const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(xml)) !== null) {
    let s = ""
    let tm: RegExpExecArray | null
    while ((tm = tRe.exec(m[1])) !== null) s += decodeXml(tm[1])
    out.push(s)
  }
  return out
}

function readSheetRefs(xlsxPath: string): Array<{ name: string; target: string }> {
  const wbXml = unzipFile(xlsxPath, "xl/workbook.xml")
  const relXml = unzipFile(xlsxPath, "xl/_rels/workbook.xml.rels")
  const relMap = new Map<string, string>()
  const relRe = /<Relationship\s[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g
  let rm: RegExpExecArray | null
  while ((rm = relRe.exec(relXml)) !== null) relMap.set(rm[1], rm[2])
  const out: Array<{ name: string; target: string }> = []
  const sheetRe = /<sheet\s[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g
  let sm: RegExpExecArray | null
  while ((sm = sheetRe.exec(wbXml)) !== null) {
    const target = relMap.get(sm[2])
    if (!target) continue
    out.push({ name: decodeXml(sm[1]), target })
  }
  return out
}

function parseSheet(name: string, xml: string, sst: string[]): Sheet {
  const rows = new Map<number, Map<number, Cell>>()
  let maxRow = 0, maxCol = 0
  // `<row .../>` (self-closing, empty row) OR `<row ...>...</row>` (with cells).
  // Self-closing rows appear in xlsx for blank rows carrying only a row-height
  // style; if we don't match them explicitly the next row's `</row>` gets stolen
  // and the following row is silently dropped.
  const rowRe = /<row\b([^>]*?)\/>|<row\b([^>]*?)>([\s\S]*?)<\/row>/g
  // `<c ... />` (self-closing, empty) OR `<c ...>...</c>` (with value).
  const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowAttrs = rm[1] ?? rm[2] ?? ""
    const rowNumMatch = /\sr="(\d+)"/.exec(rowAttrs)
    if (!rowNumMatch) continue
    const rowNum = parseInt(rowNumMatch[1], 10)
    const rowBody = rm[3] ?? ""
    const cells = new Map<number, Cell>()
    let cm: RegExpExecArray | null
    const cellIter = new RegExp(cellRe.source, "g")
    while ((cm = cellIter.exec(rowBody)) !== null) {
      // cm[1] set for self-closing, cm[2]+cm[3] set for full form
      const attrs = cm[1] ?? cm[2] ?? ""
      const inner = cm[3] ?? ""
      const refMatch = /r="([A-Z]+)(\d+)"/.exec(attrs)
      if (!refMatch) continue
      const colLetters = refMatch[1]
      const col = colLettersToIndex(colLetters)
      const tMatch = /\st="([^"]+)"/.exec(attrs)
      const t = tMatch?.[1]
      const ref = `${colLetters}${rowNum}`
      let value: string | number | null = null
      if (t === "s") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        if (v != null) value = sst[parseInt(v, 10)] ?? null
      } else if (t === "inlineStr") {
        const is = /<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? ""
        const ts: string[] = []
        const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g
        let tm2: RegExpExecArray | null
        while ((tm2 = tRe.exec(is)) !== null) ts.push(decodeXml(tm2[1]))
        value = ts.join("")
      } else if (t === "str" || t === "e" || t === "b") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        value = v != null ? decodeXml(v) : null
      } else {
        // numeric (default) — also catches t="n"
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        if (v != null) {
          const n = Number(v)
          value = Number.isNaN(n) ? v : n
        }
      }
      cells.set(col, { ref, row: rowNum, col, colLetters, value })
      if (col > maxCol) maxCol = col
    }
    if (cells.size > 0) {
      rows.set(rowNum, cells)
      if (rowNum > maxRow) maxRow = rowNum
    }
  }
  return { name, rows, maxRow, maxCol }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
}
