// While the paid events feed is switched off, the ML tab's gaps say "not
// connected" instead of "stopped writing / every run since has failed".

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    store: { findMany: vi.fn(async () => [{ id: "s1" }]) },
    mlTrainingRun: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { getMlSections } from "@/lib/counter/adapters/monitoring-ml"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const longAgo = new Date(Date.now() - 30 * 86_400_000)

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  asMock(prisma.$queryRaw).mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?")
    if (sql.includes('FROM "ExternalSignalSyncRun"')) {
      return [
        { provider: "predicthq", runs: BigInt(40), failures: BigInt(21), rowsWritten: BigInt(0), lastAt: longAgo, lastOkAt: longAgo, lastError: "HTTP 401" },
      ]
    }
    return []
  })
  // One training run so the tab is not the empty state.
  asMock(prisma.mlTrainingRun.findMany).mockResolvedValue([
    { target: "REVENUE", status: "SUCCEEDED", startedAt: new Date(), modelVersion: "v", mape: null, mae: null, rowsTrained: 1, durationMs: 1, flavor: null, errorMessage: null },
  ])
  asMock(prisma.mlTrainingRun.findFirst).mockResolvedValue(null)
})

async function gapItems() {
  const s = await getMlSections({ accountId: "acct" })
  expect(s.gaps.status).toBe("ready")
  return (s.gaps as { data: { items: Array<{ key: string; title: string; lead: string }> } }).data.items
}

describe("ML gaps and the events feed", () => {
  it("switched off: one 'not connected' line, no 'stopped writing'", async () => {
    vi.stubEnv("EVENTS_PROVIDER_ENABLED", "")
    const items = await gapItems()
    const ev = items.filter((i) => i.key === "signal-predicthq")
    expect(ev).toHaveLength(1)
    expect(ev[0].title).toBe("Local events not connected")
    expect(items.some((i) => i.title.includes("stopped writing"))).toBe(false)
  })

  it("connected: a feed dark for a week still reads as stopped", async () => {
    vi.stubEnv("EVENTS_PROVIDER_ENABLED", "1")
    const items = await gapItems()
    expect(items.find((i) => i.key === "signal-predicthq")?.title).toBe("Local events stopped writing")
  })
})
