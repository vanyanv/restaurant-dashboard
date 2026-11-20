import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { APPLE_STARTUP_IMAGES } from "@/lib/apple-startup-images"

/** PNG width and height from the IHDR chunk. */
function pngSize(file: string): [number, number] {
  const buf = readFileSync(file)
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)]
}

describe("iOS launch images", () => {
  it("each entry points at a file whose pixel size matches its media query", () => {
    expect(APPLE_STARTUP_IMAGES.length).toBeGreaterThan(5)
    for (const img of APPLE_STARTUP_IMAGES) {
      const entry = img
      const m = /device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d+)\)/.exec(entry.media)
      expect(m, entry.url).not.toBeNull()
      const [, w, h, r] = m!.map(Number)
      // iOS only shows an image whose size is exactly the screen's.
      expect(pngSize(path.join(process.cwd(), "public", entry.url))).toEqual([w * r, h * r])
    }
  })

  it("the phone and root layouts both declare them", () => {
    for (const file of ["src/app/layout.tsx", "src/app/(mobile)/m/layout.tsx"]) {
      expect(readFileSync(path.join(process.cwd(), file), "utf8")).toMatch(/startupImage: APPLE_STARTUP_IMAGES/)
    }
  })

  it("load without a sign-in (excluded from the proxy)", () => {
    expect(readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf8")).toMatch(/icons\/\|splash\//)
  })
})
