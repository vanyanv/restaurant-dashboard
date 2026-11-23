import { describe, expect, it } from "vitest"
import {
  clampSeconds,
  hashToken,
  isDeviceToken,
  isPairCode,
  newPairCode,
  normalizeCode,
  playlistVersion,
  screenMediaUrl,
  screenState,
  tokenFromHeader,
  ONLINE_WINDOW_MS,
} from "@/lib/screens/core"

describe("screens core", () => {
  it("makes six-digit codes that never start with 0", () => {
    for (let i = 0; i < 200; i++) expect(isPairCode(newPairCode())).toBe(true)
    expect(isPairCode("012345")).toBe(false)
    expect(isPairCode("12345")).toBe(false)
  })

  it("reads a code typed with spaces or dashes", () => {
    expect(normalizeCode("482 913")).toBe("482913")
    expect(normalizeCode("482-913")).toBe("482913")
  })

  it("accepts only url-safe tokens of a sane length", () => {
    expect(isDeviceToken("a".repeat(43))).toBe(true)
    expect(isDeviceToken("short")).toBe(false)
    expect(isDeviceToken("a".repeat(42) + "!")).toBe(false)
    expect(isDeviceToken(42)).toBe(false)
  })

  it("reads the bearer token and refuses anything else", () => {
    const t = "A".repeat(43)
    expect(tokenFromHeader(`Bearer ${t}`)).toBe(t)
    expect(tokenFromHeader(`bearer ${t}`)).toBe(t)
    expect(tokenFromHeader("Bearer bad")).toBeNull()
    expect(tokenFromHeader(null)).toBeNull()
  })

  it("hashes a token the same way every time, and never returns it", () => {
    const t = "x".repeat(43)
    expect(hashToken(t)).toBe(hashToken(t))
    expect(hashToken(t)).not.toContain(t)
    expect(hashToken(t)).toHaveLength(64)
  })

  it("calls a screen on, off, or waiting", () => {
    const now = new Date("2026-11-23T12:00:00Z")
    expect(screenState(null, now)).toBe("waiting")
    expect(screenState(new Date(now.getTime() - 30_000), now)).toBe("on")
    expect(screenState(new Date(now.getTime() - ONLINE_WINDOW_MS - 1), now)).toBe("off")
  })

  it("keeps slide seconds in range", () => {
    expect(clampSeconds(1)).toBe(3)
    expect(clampSeconds(9000)).toBe(600)
    expect(clampSeconds(Number.NaN)).toBe(10)
    expect(clampSeconds(7.6)).toBe(8)
  })

  it("changes the playlist version only when what plays changes", () => {
    const a = playlistVersion([{ id: "1", seconds: 8, key: "k1" }], "Combos")
    expect(playlistVersion([{ id: "1", seconds: 8, key: "k1" }], "Combos")).toBe(a)
    expect(playlistVersion([{ id: "1", seconds: 9, key: "k1" }], "Combos")).not.toBe(a)
    expect(playlistVersion([{ id: "1", seconds: 8, key: "k2" }], "Combos")).not.toBe(a)
  })

  it("builds the media url from the key", () => {
    expect(screenMediaUrl("screens/acc/0b6f.jpg")).toBe("/api/tv/media/screens/acc/0b6f.jpg")
  })
})
