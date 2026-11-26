import { describe, it, expect } from "vitest"
import { screenOriginalKey } from "@/lib/blob"

/** The owner's untouched file sits beside the TV copy, in a folder /api/tv/media will not serve. */
describe("screenOriginalKey", () => {
  const tv = "screens/acc_1/0b7c9a52-1d2e-4f3a-9b8c-7d6e5f4a3b2c.png"
  const TV_KEY = /^screens\/[A-Za-z0-9._-]+\/[0-9a-f-]{36}\.(jpg|png|webp)$/

  it("keeps the uuid, takes the original's own type, and is not a TV-servable key", () => {
    const key = screenOriginalKey(tv, "image/jpeg")
    expect(key).toBe("screens/acc_1/originals/0b7c9a52-1d2e-4f3a-9b8c-7d6e5f4a3b2c.jpg")
    expect(TV_KEY.test(key)).toBe(false)
  })

  it("refuses a key that is not a screen picture", () => {
    expect(() => screenOriginalKey("checks/acc_1/x.jpg", "image/png")).toThrow()
  })
})

describe("the 1920 x 1080 copy", () => {
  it("sits beside the TV copy as a PNG", async () => {
    const { screenFhdKey } = await import("@/lib/blob")
    expect(screenFhdKey("screens/acc_1/0b7c9a52-1d2e-4f3a-9b8c-7d6e5f4a3b2c.jpg")).toBe(
      "screens/acc_1/0b7c9a52-1d2e-4f3a-9b8c-7d6e5f4a3b2c.fhd.png",
    )
  })

  it("goes only to a TV that says it draws at most 1920 x 1080", async () => {
    const { drawsFullHd, screenMediaUrl } = await import("@/lib/screens/core")
    expect(drawsFullHd("Tizen 7.0 · 1920x1080")).toBe(true)
    expect(drawsFullHd("Tizen 7.0 ï¿½ 1920x1080")).toBe(true)
    expect(drawsFullHd("Browser · 1080x1920")).toBe(true)
    expect(drawsFullHd("Browser · 3840x2160")).toBe(false)
    expect(drawsFullHd("Browser · 2560x1440")).toBe(false)
    expect(drawsFullHd(null)).toBe(false)
    expect(drawsFullHd("Tizen")).toBe(false)
    expect(screenMediaUrl("screens/a/b.png", "fhd")).toBe("/api/tv/media/screens/a/b.png?fit=fhd")
    expect(screenMediaUrl("screens/a/b.png")).toBe("/api/tv/media/screens/a/b.png")
  })
})
