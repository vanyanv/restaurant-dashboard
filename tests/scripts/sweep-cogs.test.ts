import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  parseArgs,
  summarizeSweep,
  sweepStores,
  type SweepDeps,
  type SweepStoreOutcome,
} from "../../scripts/sweep-cogs"

describe("parseArgs", () => {
  it("defaults to the 3-day sweep, not forced, every store", () => {
    expect(parseArgs([])).toEqual({ lookbackDays: 3, force: false, storeId: null })
  })

  it("reads what the workflows pass", () => {
    // cogs-sweep.yml: `"$LOOKBACK" "--force=$FORCE"` with the inputs left alone.
    expect(parseArgs(["3", "--force=false"])).toEqual({ lookbackDays: 3, force: false, storeId: null })
    // cogs-refresh.yml, forced by hand.
    expect(parseArgs(["30", "--force=true"])).toEqual({ lookbackDays: 30, force: true, storeId: null })
  })

  it("takes a bare --force and a store id", () => {
    expect(parseArgs(["--force", "--store-id=s1"])).toEqual({ lookbackDays: 3, force: true, storeId: "s1" })
  })

  it("does not force on anything but true", () => {
    expect(parseArgs(["--force=yes"]).force).toBe(false)
    expect(parseArgs(["--force="]).force).toBe(false)
  })

  it("stops on a lookback that is not a whole number from 1 to 365", () => {
    for (const bad of ["0", "366", "2.5", "abc", "-3", "-3x"]) {
      expect(() => parseArgs([bad]), bad).toThrow(/lookbackDays/)
    }
  })

  it("stops on an argument it does not know", () => {
    expect(() => parseArgs(["3", "--froce"])).toThrow(/unknown argument "--froce"/)
    expect(() => parseArgs(["3", "--store=s1"])).toThrow(/unknown argument/)
  })

  it("treats an empty lookback (a cleared workflow input) as the default", () => {
    expect(parseArgs(["", "--force=false"]).lookbackDays).toBe(3)
  })
})

const STORES = [
  { id: "s-a", name: "Alpha" },
  { id: "s-b", name: "Bravo" },
  { id: "s-c", name: "Charlie" },
]

function deps(over: Partial<SweepDeps> = {}): SweepDeps & { lines: string[] } {
  const lines: string[] = []
  return {
    lines,
    listStores: vi.fn(async () => ({ stores: STORES })),
    sweepStore: vi.fn(async ({ storeId }) => ({
      storeName: STORES.find((s) => s.id === storeId)!.name,
      skipped: false,
      rowsChanged: 4,
    })),
    log: (line) => lines.push(line),
    now: () => 1_000,
    ...over,
  }
}

describe("sweepStores", () => {
  it("sweeps every listed store, one at a time, in order", async () => {
    const d = deps()
    const order: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    d.sweepStore = vi.fn(async ({ storeId }) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      order.push(storeId)
      inFlight--
      return { storeName: storeId, skipped: false, rowsChanged: 1 }
    })
    const outcomes = await sweepStores({ lookbackDays: 3, force: false, storeId: null }, d)
    expect(order).toEqual(["s-a", "s-b", "s-c"])
    expect(maxInFlight).toBe(1)
    expect(outcomes.every((o) => o.ok)).toBe(true)
  })

  it("passes the lookback and force through to the list and to each sweep", async () => {
    const d = deps()
    await sweepStores({ lookbackDays: 30, force: true, storeId: null }, d)
    expect(d.listStores).toHaveBeenCalledWith({ force: true })
    expect(d.sweepStore).toHaveBeenCalledWith({ storeId: "s-a", lookbackDays: 30, force: true })
  })

  it("carries on past a store that fails and reports it", async () => {
    const d = deps()
    d.sweepStore = vi.fn(async ({ storeId }) => {
      if (storeId === "s-b") throw new Error("connection reset")
      return { storeName: storeId, skipped: false, rowsChanged: 2 }
    })
    const outcomes = await sweepStores({ lookbackDays: 3, force: false, storeId: null }, d)
    expect(d.sweepStore).toHaveBeenCalledTimes(3)
    expect(outcomes.map((o) => o.ok)).toEqual([true, false, true])
    expect(outcomes[1]).toMatchObject({ storeId: "s-b", storeName: "Bravo", error: "connection reset" })
  })

  it("sweeps only the store asked for", async () => {
    const d = deps()
    const outcomes = await sweepStores({ lookbackDays: 3, force: false, storeId: "s-c" }, d)
    expect(d.sweepStore).toHaveBeenCalledTimes(1)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0].storeId).toBe("s-c")
  })

  it("fails when the store asked for is not on the list", async () => {
    const d = deps()
    await expect(
      sweepStores({ lookbackDays: 3, force: false, storeId: "nope" }, d),
    ).rejects.toThrow(/nope is not on the sweep list/)
    expect(d.sweepStore).not.toHaveBeenCalled()
  })

  it("does nothing, and does not fail, when there are no stores", async () => {
    const d = deps({ listStores: vi.fn(async () => ({ stores: [] })) })
    const outcomes = await sweepStores({ lookbackDays: 3, force: false, storeId: null }, d)
    expect(outcomes).toEqual([])
    expect(summarizeSweep(outcomes).ok).toBe(true)
  })
})

describe("summarizeSweep", () => {
  const ok = (skipped: boolean): SweepStoreOutcome => ({
    ok: true,
    storeId: "s",
    storeName: "S",
    skipped,
    rowsChanged: skipped ? 0 : 3,
    durationMs: 1,
  })
  const bad = (storeName: string): SweepStoreOutcome => ({
    ok: false,
    storeId: storeName,
    storeName,
    error: "boom",
    durationMs: 1,
  })

  it("is ok when nothing failed, counting skips apart from sweeps", () => {
    expect(summarizeSweep([ok(false), ok(true), ok(true)])).toEqual({
      ok: true,
      line: "COGS sweep: 1 swept, 2 skipped (no source change), 0 failed",
    })
  })

  it("is not ok when any store failed, and names them", () => {
    expect(summarizeSweep([ok(false), bad("Bravo"), bad("Delta")])).toEqual({
      ok: false,
      line: "COGS sweep: 1 swept, 0 skipped (no source change), 2 failed: Bravo, Delta",
    })
  })
})

/**
 * The point of the change: the scheduled sweeps must not call the Vercel app.
 * If either workflow goes back to APP_URL, the Active CPU comes back with it.
 */
describe("the COGS workflows", () => {
  for (const [file, days] of [
    ["cogs-sweep.yml", "3"],
    ["cogs-refresh.yml", "30"],
  ] as const) {
    it(`${file} runs the script on the runner and never calls the app`, () => {
      const yml = fs.readFileSync(path.resolve(__dirname, "../../.github/workflows", file), "utf8")
      expect(yml).toContain('npx tsx scripts/sweep-cogs.ts "$LOOKBACK" "--force=$FORCE"')
      expect(yml).toContain(`LOOKBACK: \${{ github.event.inputs.lookbackDays || '${days}' }}`)
      expect(yml).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}")
      expect(yml).toContain("UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}")
      expect(yml).not.toContain("APP_URL")
      expect(yml).not.toContain("CRON_SECRET")
      expect(yml).not.toContain("curl-cron-json")
      // Workflow inputs reach the shell only through env, never interpolated.
      const runBlocks = yml.split("\n").filter((l) => /^\s+(bash|npx)\s/.test(l))
      expect(runBlocks.join("\n")).not.toContain("${{")
    })
  }
})
