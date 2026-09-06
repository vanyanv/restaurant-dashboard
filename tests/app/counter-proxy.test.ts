import { describe, expect, it, vi } from "vitest"
vi.mock("next-auth/middleware", () => ({ withAuth: (handler: unknown) => handler }))
vi.mock("next/server", () => ({ NextResponse: {
  redirect: (url: URL) => url, next: () => null, rewrite: (url: URL) => url,
} }))
import proxy from "@/proxy"

function redirect(path: string): URL {
  const url = new URL(path, "https://dashboard.example")
  return (proxy as unknown as (req: unknown) => URL)({
    url: url.toString(), nextUrl: url, nextauth: { token: { role: "OWNER" } },
    headers: { get: () => "Desktop" }, cookies: { get: () => undefined },
  })
}

describe("Counter legacy redirects", () => {
  it("merges range filters into a per-store P&L destination", () => {
    const url = redirect("/dashboard/pnl/hollywood?range=d7&cmp=year")
    expect(url.pathname).toBe("/dashboard/pnl")
    expect(Object.fromEntries(url.searchParams)).toEqual({ store: "hollywood", range: "d7", cmp: "year" })
  })
  it("keeps the path's store when an old link carries a conflicting store filter", () => {
    const url = redirect("/dashboard/pnl/hollywood?store=glendale&from=2026-08-01&to=2026-08-07")
    expect(url.searchParams.get("store")).toBe("hollywood")
    expect(url.searchParams.get("from")).toBe("2026-08-01")
    expect(url.searchParams.get("to")).toBe("2026-08-07")
  })
  it("also preserves filters on destinations without their own query", () => {
    expect(redirect("/dashboard/chat?range=d30").searchParams.get("range")).toBe("d30")
  })
})
