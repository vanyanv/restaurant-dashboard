import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Mock the persistence layer so the rotation-capture path is observable without
// touching the network/filesystem. harri.ts imports it via "./harri-token-store".
const persistMock = vi.fn().mockResolvedValue({ envLocal: true, vercel: false, github: true })
vi.mock("@/lib/harri-token-store", () => ({ persistHarriRefreshToken: persistMock }))

function jwt(expSecondsFromNow: number): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow
  return `${enc({ alg: "none" })}.${enc({ exp })}.sig`
}

function cognitoResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

const origEnv = { ...process.env }

describe("harri refreshAccessToken rotation capture", () => {
  beforeEach(() => {
    vi.resetModules()
    persistMock.mockClear()
    process.env = { ...origEnv }
    delete process.env.HARRI_JWT
    delete process.env.CI
    process.env.HARRI_REFRESH_TOKEN = "OLD"
  })

  afterEach(() => {
    process.env = { ...origEnv }
    vi.restoreAllMocks()
  })

  it("persists and swaps in a rotated refresh token when Cognito returns one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      cognitoResponse({ AuthenticationResult: { AccessToken: jwt(3600), RefreshToken: "NEW" } }),
    )

    const { getHarriJwt } = await import("@/lib/harri")
    await getHarriJwt()

    await vi.waitFor(() => expect(persistMock).toHaveBeenCalledWith("NEW"))
    expect(process.env.HARRI_REFRESH_TOKEN).toBe("NEW")
  })

  it("does not persist when no rotated token is returned", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      cognitoResponse({ AuthenticationResult: { AccessToken: jwt(3600) } }),
    )

    const { getHarriJwt } = await import("@/lib/harri")
    await getHarriJwt()

    // Give any stray microtasks a chance, then assert it was never called.
    await new Promise((r) => setTimeout(r, 10))
    expect(persistMock).not.toHaveBeenCalled()
    expect(process.env.HARRI_REFRESH_TOKEN).toBe("OLD")
  })
})
