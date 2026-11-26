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
