/**
 * Reconcile Chris's hand-kept Weekly Sales Sheet (xlsx) against the dashboard
 * numbers for a single store / single week. Prints per-GL-line deltas for
 * both week conventions (sheet = Mon-Sun, dashboard = Sun-Sat) so boundary
 * drift is visible. Also prints a COGS section (vendor-invoice totals from
 * the sheet vs recipe-based DailyCogsItem rollup from the dashboard) with
 * the non-comparability disclaimer.
 *
 * Usage:
 *   pnpm tsx scripts/reconcile-weekly-sheet.ts \
 *     [--week-ending=YYYY-MM-DD] \
 *     [--store=<name substring>] \
 *     [--xlsx=/path/to/WeeklySalesSheet.xlsx] \
 *     [--output=docs/audits/YYYY-MM-DD-weekly-sheet-reconciliation.md]
 *
 * Defaults: pilot week ending 2024-07-07 (Sun), first active store, sheet at
 * /mnt/c/Users/Vardan/Downloads/WeeklySalesSheet VV (1).xlsx.
 */
import fs from "node:fs"
import path from "node:path"
import { parseXlsx, excelSerialToDate, colIndexToLetters, type Sheet } from "./lib/xlsx-minimal"

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnvLocal()

// ─── CLI ───

interface Args {
  weekEnding: Date       // Sunday (Mon-Sun convention, end of the sheet's week)
  storeFilter: string | null
  xlsxPath: string
  outputPath: string | null
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const get = (k: string): string | null => {
    const p = args.find((a) => a.startsWith(`--${k}=`))
    return p ? p.slice(k.length + 3) : null
  }
  const weekEndingStr = get("week-ending") ?? "2024-07-07"
  const [y, m, d] = weekEndingStr.split("-").map(Number)
  if (!y || !m || !d) throw new Error(`Invalid --week-ending=${weekEndingStr}`)
  const weekEnding = new Date(Date.UTC(y, m - 1, d))
  if (weekEnding.getUTCDay() !== 0) {
    console.warn(`Warning: --week-ending=${weekEndingStr} is a ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][weekEnding.getUTCDay()]}, not a Sunday. Proceeding anyway.`)
  }
  return {
    weekEnding,
    storeFilter: get("store"),
    xlsxPath: get("xlsx") ?? "/mnt/c/Users/Vardan/Downloads/WeeklySalesSheet VV (1).xlsx",
    outputPath: get("output"),
  }
}

// ─── Date helpers ───

function addDaysUTC(d: Date, n: number): Date {
  const nd = new Date(d)
  nd.setUTCDate(nd.getUTCDate() + n)
  return nd
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function sameYmd(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
}

// ─── Sheet extraction ───

/**
 * The "Profit and Loss" sheet has date serials in row 5 (one per GL row block).
 * Each block is 3 columns wide: Amount | %-of-sales | (spacer). The Amount
 * column is the one where the serial sits. Find the column whose serial equals
 * the Monday of the target week (weekEnding - 6 days).
 */
function findWeekColumn(sheet: Sheet, weekMonday: Date): { col: number; letters: string } | null {
  const row5 = sheet.rows.get(5)
  if (!row5) return null
  for (const [col, cell] of row5) {
    if (typeof cell.value !== "number") continue
    const serialDate = excelSerialToDate(cell.value)
    if (sameYmd(serialDate, weekMonday)) {
      return { col, letters: colIndexToLetters(col) }
    }
  }
  return null
}

/** Find the row whose column A label starts with the given GL code prefix (e.g. "4010"). */
function findRowByCode(sheet: Sheet, codePrefix: string): number | null {
  for (const [rowNum, cells] of sheet.rows) {
    const a = cells.get(1)?.value
    if (typeof a === "string" && a.trim().startsWith(codePrefix)) return rowNum
  }
  return null
}

/** Find the row whose column A label equals (trimmed, case-insensitive) one of the given labels. */
function findRowByLabel(sheet: Sheet, ...labels: string[]): number | null {
  const norm = (s: string) => s.trim().toLowerCase()
  const wanted = new Set(labels.map(norm))
  for (const [rowNum, cells] of sheet.rows) {
    const a = cells.get(1)?.value
    if (typeof a === "string" && wanted.has(norm(a))) return rowNum
  }
  return null
}

function readNum(sheet: Sheet, row: number | null, col: number): number {
  if (row == null) return 0
  const v = sheet.rows.get(row)?.get(col)?.value
  return typeof v === "number" ? v : 0
}

interface SheetWeek {
  credit: number
  cash: number
  uber: number
  doordash: number
  grubhub: number
  chownow: number
  ezcater: number
  fooda: number
  beverage: number
  serviceCharge: number
  tax: number          // negative as stored
  discounts: number    // negative as stored
  totalSales: number   // "Total 4000 - SALES" subtotal (net-of-tax)
  cogsByVendor: Array<{ code: string; vendor: string; amount: number }>
  totalCogs: number
  directLabor: number  // 6200
}

function extractSheetWeek(sheet: Sheet, col: number): SheetWeek {
  const row = (code: string) => findRowByCode(sheet, code)
  const cogsCodes: Array<{ code: string; vendor: string }> = [
    { code: "5010", vendor: "Shamrock" },
    { code: "5011", vendor: "IFS" },
    { code: "5012", vendor: "K&K" },
    { code: "5013", vendor: "Restaurant Depot" },
    { code: "5014", vendor: "Smart and Final" },
    { code: "5015", vendor: "Sysco" },
  ]
  const cogsByVendor = cogsCodes.map(({ code, vendor }) => ({
    code, vendor, amount: readNum(sheet, row(code), col),
  }))
  return {
    credit:        readNum(sheet, row("4010"), col),
    cash:          readNum(sheet, row("4011"), col),
    uber:          readNum(sheet, row("4012"), col),
    doordash:      readNum(sheet, row("4013"), col),
    grubhub:       readNum(sheet, row("4014"), col),
    chownow:       readNum(sheet, row("4015"), col),
    ezcater:       readNum(sheet, row("4016"), col),
    fooda:         readNum(sheet, row("4017"), col),
    beverage:      readNum(sheet, row("4020"), col),
    serviceCharge: readNum(sheet, row("4040"), col),
    tax:           readNum(sheet, row("4100"), col),
    discounts:     readNum(sheet, row("4110"), col),
    totalSales:    readNum(sheet, findRowByLabel(sheet, "Total 4000 - SALES", "Total Sales"), col),
    cogsByVendor,
    totalCogs:     readNum(sheet, findRowByLabel(sheet, "Total 5000 - COGS"), col),
    directLabor:   readNum(sheet, row("6200"), col),
  }
}

// ─── Dashboard queries ───

interface DashboardWeek {
  storeId: string
  storeName: string
  startDate: Date
  endDate: Date
  // 14 GL lines, same indexing as src/lib/pnl.ts salesRowValues()
  creditCards: number
  cash: number
  uber: number
  doordash: number
  grubhub: number
  chownow: number
  caviar: number
  ezcater: number   // 0 — hardcoded
  fooda: number     // 0 — hardcoded
  otterOnline: number
  otterPrepaid: number
  beverage: number
  serviceCharge: number
  tax: number        // negative
  discounts: number  // negative
  totalSales: number
  // Diagnostic extras
  fpNetSales: number
  tpNetSales: number
  fpOrderCount: number
  tpOrderCount: number
  // COGS-side
  recipeCogs: number
  cogsRowsCosted: number
  cogsRowsUnmapped: number
  cogsRowsMissingCost: number
  unmappedRevenueShare: number   // salesRevenue of UNMAPPED / total salesRevenue
  // Vendor invoices landed in this date range
  invoicesByVendor: Array<{ vendor: string; total: number; count: number }>
  invoicesTotal: number
}

const FP_PLATFORMS = new Set(["css-pos", "bnm-web"])

async function computeDashboardWeek(
  prisma: any,
  storeId: string,
  storeName: string,
  startDate: Date,
  endDate: Date,
): Promise<DashboardWeek> {
  // OtterDailySummary.date is a PG DATE — we query the [start, end] inclusive range.
  const summaries = await prisma.otterDailySummary.findMany({
    where: {
      storeId,
      date: { gte: startDate, lte: endDate },
    },
  })

  const sumFp = (fn: (r: any) => number, where?: (r: any) => boolean) =>
    summaries.reduce((s: number, r: any) => {
      if (where && !where(r)) return s
      const v = fn(r); return s + (typeof v === "number" ? v : 0)
    }, 0)

  const creditCards = sumFp((r) => r.fpGrossSales ?? 0, (r) => FP_PLATFORMS.has(r.platform) && r.paymentMethod === "CARD")
  const cash        = sumFp((r) => r.fpGrossSales ?? 0, (r) => FP_PLATFORMS.has(r.platform) && r.paymentMethod === "CASH")
  const uber        = sumFp((r) => r.tpGrossSales ?? 0, (r) => r.platform === "ubereats")
  const doordash    = sumFp((r) => r.tpGrossSales ?? 0, (r) => r.platform === "doordash")
  const grubhub     = sumFp((r) => r.tpGrossSales ?? 0, (r) => r.platform === "grubhub")
  const chownow     = sumFp((r) => r.tpGrossSales ?? 0, (r) => r.platform === "chownow")
  const caviar      = sumFp((r) => r.tpGrossSales ?? 0, (r) => r.platform === "caviar")
  const serviceCharge = sumFp((r) => r.fpServiceCharges ?? 0) + sumFp((r) => r.tpServiceCharges ?? 0)
  const tax       = -(sumFp((r) => r.fpTaxCollected ?? 0) + sumFp((r) => r.tpTaxCollected ?? 0))
  // fp/tpDiscounts come back signed negative from Otter — do not negate.
  const discounts = sumFp((r) => r.fpDiscounts ?? 0) + sumFp((r) => r.tpDiscounts ?? 0)

  const fpNetSales = sumFp((r) => r.fpNetSales ?? 0)
  const tpNetSales = sumFp((r) => r.tpNetSales ?? 0)
  const fpOrderCount = sumFp((r) => r.fpOrderCount ?? 0)
  const tpOrderCount = sumFp((r) => r.tpOrderCount ?? 0)

  const totalSales = creditCards + cash + uber + doordash + grubhub + chownow + caviar + serviceCharge + tax + discounts

  // COGS side
  const cogsRows = await prisma.dailyCogsItem.findMany({
    where: { storeId, date: { gte: startDate, lte: endDate } },
    select: { lineCost: true, salesRevenue: true, status: true },
  })
  let recipeCogs = 0, costedRev = 0, unmappedRev = 0, missingCostRev = 0
  let costed = 0, unmapped = 0, missingCost = 0
  for (const r of cogsRows) {
    recipeCogs += r.lineCost ?? 0
    if (r.status === "COSTED")          { costed++;      costedRev += r.salesRevenue ?? 0 }
    else if (r.status === "UNMAPPED")   { unmapped++;    unmappedRev += r.salesRevenue ?? 0 }
    else if (r.status === "MISSING_COST") { missingCost++; missingCostRev += r.salesRevenue ?? 0 }
  }
  const totalCogsRev = costedRev + unmappedRev + missingCostRev
  const unmappedRevenueShare = totalCogsRev > 0 ? unmappedRev / totalCogsRev : 0

  // Invoice totals by vendor, over the same date range (matching Chris's sheet method)
  const invoices = await prisma.invoice.findMany({
    where: {
      storeId,
      invoiceDate: { gte: startDate, lte: endDate },
    },
    select: { vendorName: true, totalAmount: true, subtotal: true },
  })
  const byVendor = new Map<string, { total: number; count: number }>()
  for (const inv of invoices) {
    const k = inv.vendorName ?? "(unknown)"
    const cur = byVendor.get(k) ?? { total: 0, count: 0 }
    // Use subtotal if available (matches sheet which excludes tax); fall back to totalAmount
    cur.total += (inv.subtotal ?? inv.totalAmount ?? 0)
    cur.count += 1
    byVendor.set(k, cur)
  }
  const invoicesByVendor = [...byVendor.entries()]
    .map(([vendor, v]) => ({ vendor, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total)
  const invoicesTotal = invoicesByVendor.reduce((s, v) => s + v.total, 0)

  return {
    storeId, storeName,
    startDate, endDate,
    creditCards, cash, uber, doordash, grubhub, chownow, caviar,
    ezcater: 0, fooda: 0, otterOnline: 0, otterPrepaid: 0,
    beverage: 0, serviceCharge, tax, discounts, totalSales,
    fpNetSales, tpNetSales, fpOrderCount, tpOrderCount,
    recipeCogs, cogsRowsCosted: costed, cogsRowsUnmapped: unmapped, cogsRowsMissingCost: missingCost,
    unmappedRevenueShare,
    invoicesByVendor, invoicesTotal,
  }
}

// ─── Store selection ───

async function pickStore(prisma: any, filter: string | null, monStart: Date, sunEnd: Date): Promise<{ id: string; name: string }> {
  const stores = await prisma.store.findMany({
    where: { isActive: true, ...(filter ? { name: { contains: filter, mode: "insensitive" } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  if (stores.length === 0) throw new Error(`No active stores match filter=${filter ?? "(none)"}`)
  if (stores.length === 1) return stores[0]
  // Multiple — pick the one with the highest weekly gross for the target week
  console.error(`Multiple stores matched. Auto-picking the one with highest ${ymd(monStart)}..${ymd(sunEnd)} sales:`)
  const scored: Array<{ id: string; name: string; total: number }> = []
  for (const s of stores) {
    const rows = await prisma.otterDailySummary.findMany({
      where: { storeId: s.id, date: { gte: monStart, lte: sunEnd } },
      select: { fpGrossSales: true, tpGrossSales: true },
    })
    const total = rows.reduce((acc: number, r: any) => acc + (r.fpGrossSales ?? 0) + (r.tpGrossSales ?? 0), 0)
    scored.push({ ...s, total })
  }
  scored.sort((a, b) => b.total - a.total)
  for (const s of scored) console.error(`  ${s.name.padEnd(32)} $${s.total.toFixed(2)}`)
  return { id: scored[0].id, name: scored[0].name }
}

// ─── Rendering ───

const money = (n: number) => {
  const sign = n < 0 ? "-" : " "
  return sign + "$" + Math.abs(n).toFixed(2).padStart(9, " ")
}
const pct = (n: number) => (n * 100).toFixed(1).padStart(5, " ") + "%"

function renderReport(
  args: { weekMonday: Date; weekSunday: Date; sheetColLetters: string; store: { id: string; name: string } },
  sheet: SheetWeek,
  aligned: DashboardWeek,   // Mon-Sun aligned to sheet
  dashboard: DashboardWeek, // Sun-Sat as dashboard renders it
): string {
  const lines: string[] = []
  const push = (s = "") => lines.push(s)

  push(`# Weekly Sheet Reconciliation`)
  push()
  push(`**Store:** ${args.store.name} (${args.store.id})`)
  push(`**Sheet week (Mon-Sun):** ${ymd(args.weekMonday)} → ${ymd(args.weekSunday)}  (xlsx col ${args.sheetColLetters})`)
  push(`**Dashboard week (Sun-Sat):** ${ymd(dashboard.startDate)} → ${ymd(dashboard.endDate)}`)
  push()
  push(`## Sales reconciliation`)
  push()
  push(`Two dashboard columns are shown: one using the **same Mon-Sun days as the sheet** (apples-to-apples), and one using the **dashboard's Sun-Sat week** (what the live P&L page displays). If these two deltas differ, the week-boundary (weekStartsOn) is doing the damage.`)
  push()
  push("| GL   | Line                     | Sheet       | Dash Mon-Sun | Dash Sun-Sat | Δ Mon-Sun  | Δ Sun-Sat  | Note |")
  push("|------|--------------------------|-------------|--------------|--------------|------------|------------|------|")
  type Row = { code: string; label: string; sheet: number; aligned: number; dash: number; note?: string }
  const rows: Row[] = [
    { code: "4010", label: "Credit Cards (CSS-POS)", sheet: sheet.credit,        aligned: aligned.creditCards, dash: dashboard.creditCards },
    { code: "4011", label: "Cash (CSS-POS)",         sheet: sheet.cash,          aligned: aligned.cash,        dash: dashboard.cash },
    { code: "4012", label: "Uber",                   sheet: sheet.uber,          aligned: aligned.uber,        dash: dashboard.uber },
    { code: "4013", label: "DoorDash",               sheet: sheet.doordash,      aligned: aligned.doordash,    dash: dashboard.doordash },
    { code: "4014", label: "Grubhub",                sheet: sheet.grubhub,       aligned: aligned.grubhub,     dash: dashboard.grubhub },
    { code: "4015", label: "ChowNow",                sheet: sheet.chownow,       aligned: aligned.chownow,     dash: dashboard.chownow },
    { code: "4015C", label: "Caviar",                sheet: 0,                   aligned: aligned.caviar,      dash: dashboard.caviar, note: aligned.caviar ? "sheet has no line" : "" },
    { code: "4016", label: "EZ Cater",               sheet: sheet.ezcater,       aligned: 0,                   dash: 0, note: sheet.ezcater ? "dashboard has no source" : "" },
    { code: "4017", label: "Fooda",                  sheet: sheet.fooda,         aligned: 0,                   dash: 0, note: sheet.fooda ? "dashboard has no source" : "" },
    { code: "4020", label: "Beverage",               sheet: sheet.beverage,      aligned: 0,                   dash: 0 },
    { code: "4040", label: "Service Charge",         sheet: sheet.serviceCharge, aligned: aligned.serviceCharge, dash: dashboard.serviceCharge },
    { code: "4100", label: "Sales Tax (neg)",        sheet: sheet.tax,           aligned: aligned.tax,         dash: dashboard.tax },
    { code: "4110", label: "Guest Discounts (neg)",  sheet: sheet.discounts,     aligned: aligned.discounts,   dash: dashboard.discounts },
  ]
  for (const r of rows) {
    const dAlign = r.aligned - r.sheet
    const dDash = r.dash - r.sheet
    const auto: string[] = []
    if (r.note) auto.push(r.note)
    if (!r.note && r.sheet !== 0 && Math.abs(dAlign) / Math.max(1, Math.abs(r.sheet)) > 0.05)
      auto.push(">5% drift vs aligned")
    push(`| ${r.code} | ${r.label.padEnd(24)} | ${money(r.sheet)} | ${money(r.aligned)}  | ${money(r.dash)}  | ${money(dAlign)} | ${money(dDash)} | ${auto.join("; ")} |`)
  }
  const sheetTot = sheet.totalSales
  const dAlignTot = aligned.totalSales - sheetTot
  const dDashTot = dashboard.totalSales - sheetTot
  push(`| —    | **Total Sales (net-of-tax)** | **${money(sheetTot)}** | **${money(aligned.totalSales)}**  | **${money(dashboard.totalSales)}**  | **${money(dAlignTot)}** | **${money(dDashTot)}** |  |`)
  push()
  push(`**Extras (no sheet equivalent):**`)
  push(`- Dashboard FP Net Sales (Mon-Sun):  ${money(aligned.fpNetSales)}   Orders: ${aligned.fpOrderCount}`)
  push(`- Dashboard TP Net Sales (Mon-Sun):  ${money(aligned.tpNetSales)}   Orders: ${aligned.tpOrderCount}`)
  push(`- Uber commission implied by sheet gross @ default 21%: ${money(-sheet.uber * 0.21)} (not shown on sheet)`)
  push(`- DoorDash commission implied by sheet gross @ default 25%: ${money(-sheet.doordash * 0.25)} (not shown on sheet)`)
  push()
  push(`## COGS — purchases vs usage (not directly comparable)`)
  push()
  push(`The sheet books COGS as **vendor invoices received** during the week. The dashboard books COGS as **recipe cost × qty sold** materialised into \`DailyCogsItem\`. These are fundamentally different metrics — purchases are spiky (delivery schedules), usage is smooth (daily sales). They converge only over full inventory periods with opening/closing inventory adjustments. Week-level variance is expected and is **not** evidence of a bug on either side.`)
  push()
  push(`**Sheet — COGS by vendor (Mon-Sun ${ymd(args.weekMonday)}..${ymd(args.weekSunday)})**`)
  push()
  push("| GL   | Vendor             | Amount       |")
  push("|------|--------------------|--------------|")
  for (const c of sheet.cogsByVendor) push(`| ${c.code} | ${c.vendor.padEnd(18)} | ${money(c.amount)} |`)
  push(`| —    | **Sheet total**    | **${money(sheet.totalCogs)}** |`)
  push()
  push(`**Dashboard — vendor invoices with invoiceDate in the same Mon-Sun range**`)
  push()
  if (aligned.invoicesByVendor.length === 0) {
    push(`_No invoices in this date range._`)
  } else {
    push("| Vendor                        | Invoices | Subtotal      |")
    push("|-------------------------------|---------:|---------------|")
    for (const v of aligned.invoicesByVendor) push(`| ${v.vendor.padEnd(29)} | ${String(v.count).padStart(8)} | ${money(v.total)} |`)
    push(`| **Total**                     |          | **${money(aligned.invoicesTotal)}** |`)
  }
  push()
  push(`**Dashboard — recipe-based COGS (usage) for Mon-Sun range**`)
  push()
  push(`- Total recipe COGS:        ${money(aligned.recipeCogs)}`)
  push(`- DailyCogsItem rows COSTED:       ${aligned.cogsRowsCosted}`)
  push(`- DailyCogsItem rows UNMAPPED:     ${aligned.cogsRowsUnmapped}  (revenue share ${pct(aligned.unmappedRevenueShare)})`)
  push(`- DailyCogsItem rows MISSING_COST: ${aligned.cogsRowsMissingCost}`)
  push()
  push(`## Verdict`)
  push()
  const salesOk = Math.abs(dAlignTot) < 50
  const bullets: string[] = []
  if (salesOk) bullets.push(`- Sales reconcile **within $50** on the Mon-Sun basis. The Sun-Sat delta of ${money(dDashTot)} is purely the week-boundary shift. Fix: flip the dashboard's \`weekStartsOn\` from 0 (Sunday) to 1 (Monday) in src/lib/pnl.ts:101 if you want the UI to match the sheet's weeks.`)
  else bullets.push(`- Sales differ by ${money(dAlignTot)} on the Mon-Sun basis — not explained by the week-boundary alone. Investigate: missing platforms (EZ Cater $${sheet.ezcater.toFixed(2)}, Fooda $${sheet.fooda.toFixed(2)}), discount/tax timing, 3P fee treatment.`)
  if (sheet.ezcater > 0 || sheet.fooda > 0) bullets.push(`- EZ Cater + Fooda total $${(sheet.ezcater + sheet.fooda).toFixed(2)} is invisible to the dashboard. These channels don't flow through Otter; ingest them elsewhere or accept as a known gap.`)
  if (aligned.unmappedRevenueShare > 0.02) bullets.push(`- ${pct(aligned.unmappedRevenueShare)} of sold-item revenue is UNMAPPED, so the dashboard's recipe COGS is understated. See docs/audits/ for the list of orphan menu items.`)
  bullets.push(`- COGS comparison is **advisory only**. Purchases ≠ usage. Don't expect week-to-week agreement.`)
  for (const b of bullets) push(b)
  push()
  return lines.join("\n")
}

// ─── Main ───

async function main() {
  const args = parseArgs()
  const weekSunday = args.weekEnding
  const weekMonday = addDaysUTC(weekSunday, -6)
  // Dashboard's Sun-Sat week containing weekMonday (the sheet's Monday):
  // start = weekMonday - (getUTCDay() === 0 ? 0 : getUTCDay()) ... weekMonday is Mon (getUTCDay()=1), so subtract 1 to get Sun.
  const dashStart = addDaysUTC(weekMonday, -1)                  // Sun before
  const dashEnd = addDaysUTC(dashStart, 6)                      // Sat after

  console.error(`Reading ${args.xlsxPath}`)
  const wb = parseXlsx(args.xlsxPath)
  if (wb.sheets.length === 0) throw new Error(`No sheets found in ${args.xlsxPath}`)

  // Try each sheet in preferred order ("Profit and Loss", "Weekly P&L", then any other).
  const preferred = ["Profit and Loss", "Weekly P&L"]
  const ordered = [
    ...preferred.map((n) => wb.sheetByName.get(n)).filter((x): x is Sheet => !!x),
    ...wb.sheets.filter((s) => !preferred.includes(s.name)),
  ]
  let sheet: Sheet | null = null
  let hit: { col: number; letters: string } | null = null
  for (const s of ordered) {
    const h = findWeekColumn(s, weekMonday)
    if (h) { sheet = s; hit = h; break }
  }
  if (!sheet || !hit) {
    const avail: string[] = []
    for (const s of ordered) {
      for (const [col, cell] of s.rows.get(5) ?? new Map()) {
        if (typeof cell.value === "number") avail.push(`  ${s.name} / ${colIndexToLetters(col)} = ${ymd(excelSerialToDate(cell.value))}`)
      }
    }
    throw new Error(`No column matches week starting ${ymd(weekMonday)}.\nAvailable weekly date headers (row 5):\n${avail.join("\n")}`)
  }
  console.error(`Matched sheet "${sheet.name}" column ${hit.letters} for Monday ${ymd(weekMonday)}`)
  const sheetWeek = extractSheetWeek(sheet, hit.col)

  const { prisma } = await import("../src/lib/prisma")
  try {
    const store = await pickStore(prisma, args.storeFilter, weekMonday, weekSunday)
    console.error(`Using store: ${store.name} (${store.id})`)

    const aligned = await computeDashboardWeek(prisma, store.id, store.name, weekMonday, weekSunday)
    const dashboard = await computeDashboardWeek(prisma, store.id, store.name, dashStart, dashEnd)

    const report = renderReport(
      { weekMonday, weekSunday, sheetColLetters: hit.letters, store },
      sheetWeek,
      aligned,
      dashboard,
    )
    process.stdout.write(report + "\n")
    if (args.outputPath) {
      const abs = path.resolve(process.cwd(), args.outputPath)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, report, "utf-8")
      console.error(`Wrote ${abs}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
