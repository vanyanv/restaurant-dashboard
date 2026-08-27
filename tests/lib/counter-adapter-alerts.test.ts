import { describe, expect, it, vi, beforeEach } from "vitest"
import { getAlertsSections } from "@/lib/counter/adapters/alerts"
import { getAlertInbox } from "@/app/actions/alerts/inbox-actions"
import { dataOf } from "@/lib/counter/section-data"

vi.mock("@/app/actions/alerts/inbox-actions", () => ({ getAlertInbox: vi.fn() }))

/**
 * The build-velocity carve-out: no page or component tests on this plan, but
 * the arithmetic an owner reads as a figure gets assertions. Here that is the
 * time-to-close median, the coverage counts behind the five source toggles and
 * the acknowledged cell — the one number on this page that a plausible
 * implementation gets not merely wrong but INVERTED.
 *
 * The fixture is the SHAPE OF THE DATABASE, not a convenient shape. Measured
 * 2026-08-26: one live source, no ACKNOWLEDGED row anywhere, no body, no
 * explanation, and every `acknowledgedAt` sitting on a DISMISSED row.
 */
const TODAY = new Date("2026-08-26T12:00:00")

const row = (over: Partial<Record<string, unknown>>) => ({
  id: "x",
  storeId: "hollywood",
  storeName: "Chris N Eddys - Hollywood",
  source: "ANOMALY_EVENT",
  target: "REVENUE",
  targetId: null,
  severity: "CRITICAL",
  status: "OPEN",
  title: "Revenue -4,965 below forecast",
  body: null,
  occurredOn: new Date("2026-08-18T00:00:00"),
  detectedAt: new Date("2026-08-18T09:00:00"),
  acknowledgedAt: null,
  explanation: null,
  ...over,
})

/** Ten dismissals, closing between 0.6h and 1.8h after detection — median 1.8h. */
const DISMISSED = [0.6, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8].map((h, i) =>
  row({
    id: `d${i}`,
    severity: "WATCH",
    status: "DISMISSED",
    title: `Soda — -56 units below forecast ${i}`,
    target: "MENU_ITEM",
    detectedAt: new Date("2026-08-25T04:00:00"),
    acknowledgedAt: new Date(new Date("2026-08-25T04:00:00").getTime() + h * 3_600_000),
  }),
)

const INBOX = {
  alerts: [
    row({ id: "1" }),
    // The two days with no rows at all: 08-19 and 08-20. Nothing here lands on
    // them, and the chart still has to draw them.
    row({ id: "2", detectedAt: new Date("2026-08-21T09:00:00") }),
    ...DISMISSED,
  ],
  counts: { open: 77, critical: 40, watch: 46, info: 1, acknowledged: 0, dismissed: 10 },
  bySource: {
    ANOMALY_EVENT: 87,
    PRICE_DELTA: 0,
    HARRI_VARIANCE: 0,
    QUANTITY_SPIKE: 0,
    NEW_PRODUCT: 0,
  },
  muteRules: [],
  stores: [{ id: "hollywood", name: "Chris N Eddys - Hollywood" }],
}

const cell = async (label: string) => {
  const s = await getAlertsSections({ today: TODAY })
  return dataOf(s.strip)!.find((c) => c.label === label)!
}

describe("getAlertsSections", () => {
  beforeEach(() => {
    vi.mocked(getAlertInbox).mockResolvedValue({ ok: true, data: INBOX as never })
  })

  /* N-R1 */
  it("renders all five source toggles, each carrying its live count", async () => {
    const s = await getAlertsSections({ today: TODAY })
    const togs = dataOf(s.filters)!.sources
    expect(togs).toHaveLength(5)
    expect(togs.find((t) => t.id === "PRICE_DELTA")).toMatchObject({ count: 0, disabled: true })
    expect(togs.find((t) => t.id === "ANOMALY_EVENT")).toMatchObject({ count: 87, disabled: false })
    // Four of the five have never fired.
    expect(togs.filter((t) => t.disabled)).toHaveLength(4)
  })

  /*
   * N-R2. The single most dangerous line on this page. Ten rows carry an
   * `acknowledgedAt` and every one of them is DISMISSED, so an "acknowledged"
   * count sourced from the timestamp reports dismissals as acknowledgements.
   */
  it("counts acknowledged from the status, and reads zero", async () => {
    const c = await cell("Acknowledged")
    expect(c.value).toBe("0")
    expect(c.value).not.toBe("10")
    expect(c.note).toBe("none yet")
  })

  /* N-R3 */
  it("prints the time-to-close median with no month-over-month delta", async () => {
    const c = await cell("Median time to close")
    expect(c.value).toBe("1.8 h")
    expect(c.delta).toBeNull() // there is no last month — nine days of history
    // The note NAMES its population, size included. See the next test for why
    // the size is load-bearing rather than decoration.
    expect(c.note).toBe("over 10 dismissals")
  })

  /*
   * Live, `getAlertInbox`'s relevance horizon holds ONE dismissal — nine of
   * the account's ten occurred on 2026-07-25 and 07-27, before it — so this is
   * what the page actually prints today. A median over n=1 is a single
   * measurement wearing the word median, and the count is the only thing that
   * tells a reader which of the two they are looking at.
   */
  it("names a population of one as one, never as a plural median", async () => {
    vi.mocked(getAlertInbox).mockResolvedValue({
      ok: true,
      data: { ...INBOX, alerts: [row({ id: "1" }), DISMISSED[0]] } as never,
    })
    const c = await cell("Median time to close")
    expect(c.value).toBe("0.6 h")
    expect(c.note).toBe("over 1 dismissal")
  })

  it("counts open from the groupBy, not from the loaded page of rows", async () => {
    const c = await cell("Open")
    expect(c.value).toBe("77")
    expect(c.note).toBe("40 need a decision")
  })

  it("says no rules are set rather than inventing a mute count", async () => {
    const c = await cell("Muted")
    expect(c.value).toBe("0")
    expect(c.note).toBe("no rules set")
  })

  /* N-R4 */
  it("renders the muted list ready-and-empty, never in the empty state", async () => {
    const s = await getAlertsSections({ segment: "muted", today: TODAY })
    expect(s.table.status).toBe("ready")
    expect(dataOf(s.table)).toEqual([])
  })

  it("renders a row with no body without printing an empty one", async () => {
    const s = await getAlertsSections({ today: TODAY })
    expect(dataOf(s.table)![0].body).toBeNull()
  })

  it("surfaces unauthorized as failed, not as an empty inbox", async () => {
    vi.mocked(getAlertInbox).mockResolvedValue({ ok: false, error: "unauthorized" })
    const s = await getAlertsSections({ today: TODAY })
    // An owner-only page shown to a manager must not say "no alerts".
    expect(s.table.status).toBe("failed")
  })

  /*
   * The opened-per-day chart has two days with no rows at all (08-19, 08-20).
   * A series that skips them draws a shorter week; one that reads them as zero
   * draws the truth.
   */
  it("fills a day with no alerts as zero rather than dropping it", async () => {
    const s = await getAlertsSections({ today: TODAY })
    const series = dataOf(s.chart)!.series[0].data
    expect(series).toHaveLength(9) // 08-18 .. 08-26 inclusive
    expect(dataOf(s.chart)!.labels[0]).toBe("08-18")
    expect(series[1]).toBe(0) // 08-19
    expect(series[2]).toBe(0) // 08-20
    expect(series[3]).toBe(1) // 08-21
  })

  /* The phone's own N-R2. */
  it("prints the live counts in the phone subtitle", async () => {
    const s = await getAlertsSections({ today: TODAY })
    expect(dataOf(s.phoneHead)!.sub).toBe("77 open · 0 acknowledged")
  })

  it("renders the acknowledged phone list over zero rows", async () => {
    const s = await getAlertsSections({ today: TODAY })
    expect(s.phoneAcknowledged.status).toBe("ready")
    expect(dataOf(s.phoneAcknowledged)!.rows).toEqual([])
    expect(dataOf(s.phoneAcknowledged)!.meta).toBe("none yet")
  })
})
