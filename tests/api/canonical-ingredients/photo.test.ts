import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/blob", async () => {
  const actual = await vi.importActual<typeof import("@/lib/blob")>("@/lib/blob")
  return {
    ...actual,
    putProductPhoto: vi.fn(),
    getProductPhotoStream: vi.fn(),
    deleteProductPhoto: vi.fn(),
  }
})

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue(null),
  RATE_LIMIT_TIERS: { moderate: { limit: 30, windowMs: 60_000 } },
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import {
  deleteProductPhoto,
  getProductPhotoStream,
  putProductPhoto,
} from "@/lib/blob"
import {
  POST,
  GET,
  DELETE,
} from "@/app/api/canonical-ingredients/[id]/photo/route"

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const session = (role: "OWNER" | "DEVELOPER" = "DEVELOPER") => ({
  user: { id: "u1", accountId: "acct-A", role },
})

function makePostRequest(file: File): NextRequest {
  const form = new FormData()
  form.append("photo", file)
  return new NextRequest(
    new Request("http://test.local/api/canonical-ingredients/ing-1/photo", {
      method: "POST",
      body: form,
    }),
  )
}

function makeGetRequest(): NextRequest {
  return new NextRequest("http://test.local/api/canonical-ingredients/ing-1/photo")
}

function makeDeleteRequest(): NextRequest {
  return new NextRequest(
    new Request("http://test.local/api/canonical-ingredients/ing-1/photo", {
      method: "DELETE",
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/canonical-ingredients/[id]/photo", () => {
  it("returns 401 when not signed in", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    const file = new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" })
    const res = await POST(makePostRequest(file), params("ing-1"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when caller is not DEVELOPER", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session("OWNER") as never)
    const file = new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" })
    const res = await POST(makePostRequest(file), params("ing-1"))
    expect(res.status).toBe(403)
  })

  it("returns 404 when ingredient is in a different account", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue(null)
    const file = new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" })
    const res = await POST(makePostRequest(file), params("ing-1"))
    expect(res.status).toBe(404)
  })

  it("returns 415 for unsupported content types", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      id: "ing-1",
      photoBlobPathname: null,
    } as never)
    const file = new File([new Uint8Array([1])], "test.svg", { type: "image/svg+xml" })
    const res = await POST(makePostRequest(file), params("ing-1"))
    expect(res.status).toBe(415)
    expect(putProductPhoto).not.toHaveBeenCalled()
  })

  it("returns 413 for oversized files", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      id: "ing-1",
      photoBlobPathname: null,
    } as never)
    const big = new Uint8Array(9 * 1024 * 1024) // 9 MB
    const file = new File([big], "big.jpg", { type: "image/jpeg" })
    const res = await POST(makePostRequest(file), params("ing-1"))
    expect(res.status).toBe(413)
    expect(putProductPhoto).not.toHaveBeenCalled()
  })

  it("uploads, updates the DB, and does not call delete when there's no previous photo", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      id: "ing-1",
      photoBlobPathname: null,
    } as never)
    const uploadedAt = new Date("2026-05-12T12:00:00Z")
    vi.mocked(putProductPhoto).mockResolvedValue({
      pathname: "products/ing-1-uuid.jpg",
      size: 3,
      uploadedAt,
    })
    vi.mocked(prisma.canonicalIngredient.update).mockResolvedValue({} as never)

    const file = new File([new Uint8Array([1, 2, 3])], "test.jpg", { type: "image/jpeg" })
    const res = await POST(makePostRequest(file), params("ing-1"))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      pathname: "products/ing-1-uuid.jpg",
      contentType: "image/jpeg",
      size: 3,
    })
    expect(putProductPhoto).toHaveBeenCalledWith(
      "ing-1",
      expect.any(Buffer),
      "image/jpeg",
    )
    expect(prisma.canonicalIngredient.update).toHaveBeenCalledWith({
      where: { id: "ing-1" },
      data: {
        photoBlobPathname: "products/ing-1-uuid.jpg",
        photoContentType: "image/jpeg",
        photoUploadedAt: uploadedAt,
      },
    })
    expect(deleteProductPhoto).not.toHaveBeenCalled()
  })

  it("deletes the previous photo after a successful replacement", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      id: "ing-1",
      photoBlobPathname: "products/ing-1-old.png",
    } as never)
    vi.mocked(putProductPhoto).mockResolvedValue({
      pathname: "products/ing-1-new.jpg",
      size: 4,
      uploadedAt: new Date(),
    })
    vi.mocked(prisma.canonicalIngredient.update).mockResolvedValue({} as never)
    vi.mocked(deleteProductPhoto).mockResolvedValue()

    const file = new File([new Uint8Array([1, 2, 3, 4])], "new.jpg", {
      type: "image/jpeg",
    })
    const res = await POST(makePostRequest(file), params("ing-1"))

    expect(res.status).toBe(200)
    expect(deleteProductPhoto).toHaveBeenCalledWith("products/ing-1-old.png")
  })
})

describe("GET /api/canonical-ingredients/[id]/photo", () => {
  it("returns 404 when ingredient has no photo", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session("OWNER") as never)
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      photoBlobPathname: null,
      photoContentType: null,
    } as never)

    const res = await GET(makeGetRequest(), params("ing-1"))
    expect(res.status).toBe(404)
    expect(getProductPhotoStream).not.toHaveBeenCalled()
  })

  it("streams the photo with the right Content-Type when present", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session("OWNER") as never)
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      photoBlobPathname: "products/ing-1-uuid.jpg",
      photoContentType: "image/jpeg",
    } as never)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })
    vi.mocked(getProductPhotoStream).mockResolvedValue({
      statusCode: 200,
      stream,
      contentType: "image/jpeg",
    })

    const res = await GET(makeGetRequest(), params("ing-1"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("image/jpeg")
  })
})

describe("DELETE /api/canonical-ingredients/[id]/photo", () => {
  it("returns 403 for non-DEVELOPER callers", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session("OWNER") as never)
    const res = await DELETE(makeDeleteRequest(), params("ing-1"))
    expect(res.status).toBe(403)
  })

  it("returns ok:true with removed:false when no photo exists", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      id: "ing-1",
      photoBlobPathname: null,
    } as never)

    const res = await DELETE(makeDeleteRequest(), params("ing-1"))
    const body = await res.json()
    expect(body).toEqual({ ok: true, removed: false })
    expect(deleteProductPhoto).not.toHaveBeenCalled()
  })

  it("clears DB fields and deletes the R2 object when a photo exists", async () => {
    vi.mocked(getServerSession).mockResolvedValue(session() as never)
    vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      id: "ing-1",
      photoBlobPathname: "products/ing-1-uuid.jpg",
    } as never)
    vi.mocked(prisma.canonicalIngredient.update).mockResolvedValue({} as never)
    vi.mocked(deleteProductPhoto).mockResolvedValue()

    const res = await DELETE(makeDeleteRequest(), params("ing-1"))
    const body = await res.json()
    expect(body).toEqual({ ok: true, removed: true })
    expect(prisma.canonicalIngredient.update).toHaveBeenCalledWith({
      where: { id: "ing-1" },
      data: {
        photoBlobPathname: null,
        photoContentType: null,
        photoUploadedAt: null,
      },
    })
    expect(deleteProductPhoto).toHaveBeenCalledWith("products/ing-1-uuid.jpg")
  })
})
