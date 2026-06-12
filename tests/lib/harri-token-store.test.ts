import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { persistHarriRefreshToken, updateEnvLocalToken } from "@/lib/harri-token-store"

describe("harri-token-store", () => {
  const origCwd = process.cwd()
  const origEnv = { ...process.env }
  let tmp: string

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "harri-store-"))
    process.chdir(tmp)
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tmp, { recursive: true, force: true })
    process.env = { ...origEnv }
    vi.restoreAllMocks()
  })

  it("creates HARRI_REFRESH_TOKEN in .env.local when absent", () => {
    expect(updateEnvLocalToken("NEWTOKEN")).toBe(true)
    expect(fs.readFileSync(path.join(tmp, ".env.local"), "utf-8")).toContain(
      "HARRI_REFRESH_TOKEN=NEWTOKEN",
    )
  })

  it("replaces an existing HARRI_REFRESH_TOKEN without duplicating", () => {
    fs.writeFileSync(path.join(tmp, ".env.local"), "FOO=bar\nHARRI_REFRESH_TOKEN=OLD\n")
    updateEnvLocalToken("ROTATED")
    const out = fs.readFileSync(path.join(tmp, ".env.local"), "utf-8")
    expect(out).toContain("FOO=bar")
    expect(out).toContain("HARRI_REFRESH_TOKEN=ROTATED")
    expect(out).not.toContain("HARRI_REFRESH_TOKEN=OLD")
    expect(out.match(/HARRI_REFRESH_TOKEN=/g)).toHaveLength(1)
  })

  it("pushes to GitHub when a PAT is present and reports per-target success", async () => {
    process.env.GH_PAT = "pat_123"
    delete process.env.GH_TOKEN
    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_PROJECT_ID

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      // public-key fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ key: btoa("0".repeat(32)), key_id: "kid" }), { status: 200 }),
      )
      // PUT secret
      .mockResolvedValue(new Response(null, { status: 204 }))

    const result = await persistHarriRefreshToken("ROTATED", { writeEnvLocal: false })

    expect(result.github).toBe(true)
    expect(result.vercel).toBe(false) // no vercel creds
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/repos/vanyanv/restaurant-dashboard/actions/secrets/public-key",
    )
  })

  it("no-ops GitHub/Vercel when no writer tokens are configured", async () => {
    delete process.env.GH_PAT
    delete process.env.GH_TOKEN
    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_PROJECT_ID
    const fetchMock = vi.spyOn(globalThis, "fetch")

    const result = await persistHarriRefreshToken("ROTATED", { writeEnvLocal: false })

    expect(result).toEqual({ envLocal: false, vercel: false, github: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
