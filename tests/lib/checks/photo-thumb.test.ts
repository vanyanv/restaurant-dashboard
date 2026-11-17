// Small copies of check photos: the owner's thumbnails get the ~10 KB copy
// when one was saved, and the full photo when it was not (photos taken
// before small copies existed), never nothing.

import { describe, it, expect, vi, beforeEach } from "vitest"

const objects = new Map<string, Uint8Array>()
const reads: string[] = []

vi.mock("@/lib/blob", () => ({
  checkThumbKey: (k: string) => `${k.replace(/\.[A-Za-z0-9]+$/, "")}.thumb.jpg`,
  async getCheckPhotoStream(key: string) {
    reads.push(key)
    const bytes = objects.get(key)
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        if (bytes) c.enqueue(bytes)
        c.close()
      },
    })
    return { statusCode: bytes ? 200 : 404, stream, contentType: bytes ? "image/jpeg" : null }
  },
}))

import { photoSizeFrom, readCheckPhoto } from "@/lib/checks/photo-serve"

const text = async (s: ReadableStream<Uint8Array>) => new TextDecoder().decode(await new Response(s).arrayBuffer())

beforeEach(() => {
  objects.clear()
  reads.length = 0
})

describe("photoSizeFrom", () => {
  it("asks for the small copy only when the URL says so", () => {
    expect(photoSizeFrom("http://x/api/checks/mark-photo/1?size=thumb")).toBe("thumb")
    expect(photoSizeFrom("http://x/api/checks/mark-photo/1")).toBe("full")
    expect(photoSizeFrom("http://x/api/checks/mark-photo/1?size=huge")).toBe("full")
  })
})

describe("readCheckPhoto", () => {
  it("serves the small copy when it exists", async () => {
    objects.set("checks/s/a.jpg", new TextEncoder().encode("FULL"))
    objects.set("checks/s/a.thumb.jpg", new TextEncoder().encode("SMALL"))
    const r = await readCheckPhoto("checks/s/a.jpg", "thumb")
    expect(r).toMatchObject({ found: true, thumb: true })
    expect(await text(r.stream)).toBe("SMALL")
  })

  it("falls back to the full photo when there is no small copy", async () => {
    objects.set("checks/s/old.webp", new TextEncoder().encode("FULL"))
    const r = await readCheckPhoto("checks/s/old.webp", "thumb")
    expect(r).toMatchObject({ found: true, thumb: false })
    expect(await text(r.stream)).toBe("FULL")
    expect(reads).toEqual(["checks/s/old.thumb.jpg", "checks/s/old.webp"])
  })

  it("reads only the full photo when the full one is asked for", async () => {
    objects.set("checks/s/a.jpg", new TextEncoder().encode("FULL"))
    objects.set("checks/s/a.thumb.jpg", new TextEncoder().encode("SMALL"))
    const r = await readCheckPhoto("checks/s/a.jpg", "full")
    expect(await text(r.stream)).toBe("FULL")
    expect(reads).toEqual(["checks/s/a.jpg"])
  })

  it("reports a photo missing from storage", async () => {
    expect((await readCheckPhoto("checks/s/gone.jpg", "thumb")).found).toBe(false)
  })
})

describe("checkThumbKey", () => {
  it("puts the small copy beside the photo, whatever its type", async () => {
    const { checkThumbKey } = await vi.importActual<typeof import("@/lib/blob")>("@/lib/blob")
    expect(checkThumbKey("checks/st_1/9f.jpg")).toBe("checks/st_1/9f.thumb.jpg")
    expect(checkThumbKey("checks/st_1/9f.webp")).toBe("checks/st_1/9f.thumb.jpg")
  })
})
