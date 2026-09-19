// The labour-versus-sales query behind the weekday SPLH medians.
//
// `HarriPositionDaily` is unique on (storeId, date, categoryCode,
// positionCode, payType), so ONE store-day is many rows — one per position on
// the roster. Joining the single daily sales figure onto that table and
// summing it counts the day's net sales once per position. `SUM(actualSeconds)`
// stays correct throughout, so the error is silent and one-sided: net sales
// ten or twenty times too high over a labour figure that is right.
//
// That product is the weekday SPLH median, which is `targetSplh`, which
// `computeLaborLane` divides predicted revenue by to get `neededHours`. Too
// high a target asks for a fraction of the hours it should, and every day on
// the Decisions page reads "heavy".

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = readFileSync(
  join(process.cwd(), "src/app/actions/decisions/get-decisions-view.ts"),
  "utf8",
)

/** The one raw query that joins HarriPositionDaily to OtterHourlySummary. */
function laborSalesQuery(): string {
  const start = SOURCE.indexOf('SELECT d."date"')
  expect(start, "the labour/sales query should select from a folded subquery").toBeGreaterThan(0)
  const end = SOURCE.indexOf("`,", start)
  return SOURCE.slice(start, end)
}

describe("the labour-versus-sales query", () => {
  it("folds labour to one row per store-day before sales are joined", () => {
    const q = laborSalesQuery()
    // The inner fold: one row per (storeId, date) out of the position rows.
    expect(q).toMatch(/GROUP BY h\."storeId", h\."date"/)
    // And the outer aggregate groups those folded rows by date alone.
    expect(q).toMatch(/GROUP BY d\."date"/)
  })

  it("never sums sales directly over the position table", () => {
    const q = laborSalesQuery()
    // `SUM(s.net)` is correct only when its FROM side is already one row per
    // store-day. Summing it over `HarriPositionDaily h` is the fan-out.
    expect(q).not.toMatch(/FROM "HarriPositionDaily" h\s*\n\s*LEFT JOIN/)
    expect(q).toMatch(/SUM\(s\.net\)/)
    expect(q).toMatch(/LEFT JOIN[\s\S]*ON s\."storeId" = d\."storeId"/)
  })

  it("counts unsynced stores off the folded rows, one vote per store-day", () => {
    const q = laborSalesQuery()
    expect(q).toMatch(/COUNT\(DISTINCT d\."storeId"\) FILTER \(WHERE s\.net IS NULL\)/)
  })

  it("still excludes today, which is always partial", () => {
    expect(laborSalesQuery()).toMatch(/h\."date" < \$\{today\}/)
  })
})
