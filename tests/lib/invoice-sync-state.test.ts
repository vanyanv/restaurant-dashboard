// What one invoice sync run leaves for the next on JobRun.metadata.
import { describe, expect, it } from "vitest"
import { emptySyncState, incompleteLookbackDays, readSyncState, serializeSyncState } from "@/lib/invoice-sync-state"

describe("invoice sync state", () => {
  it("round-trips through JobRun.metadata", () => {
    const s = emptySyncState()
    s.incomplete.set("m1", "2026-11-01T00:00:00Z")
    s.readFailures.set("m1#1", 2)
    s.noPdf.add("m9")
    const back = readSyncState(JSON.parse(JSON.stringify(serializeSyncState(s))))
    expect([...back.incomplete]).toEqual([["m1", "2026-11-01T00:00:00Z"]])
    expect([...back.readFailures]).toEqual([["m1#1", 2]])
    expect([...back.noPdf]).toEqual(["m9"])
  })

  it("reads anything malformed (or a pre-2026-11-20 row) as empty", () => {
    const s = readSyncState({ deferred: 0, incomplete: "x", readFailures: [1], noPdf: [3] })
    expect(s.incomplete.size + s.readFailures.size + s.noPdf.size).toBe(0)
    expect(readSyncState(null).incomplete.size).toBe(0)
  })

  it("widens the lookback to reach the oldest half-stored email", () => {
    const s = emptySyncState()
    const now = Date.parse("2026-11-20T12:00:00Z")
    s.incomplete.set("m1", "2026-11-01T12:00:00Z")
    expect(incompleteLookbackDays(s, now)).toBe(20)
    expect(incompleteLookbackDays(emptySyncState(), now)).toBe(0)
  })
})
