import { describe, expect, it } from "vitest"
import { loginPathFor, safeReturnTo } from "@/lib/return-to"

describe("safeReturnTo", () => {
  it("keeps a same-site page with its store and dates", () => {
    expect(safeReturnTo("/dashboard/pnl?store=abc&from=2026-11-01", "/dashboard")).toBe(
      "/dashboard/pnl?store=abc&from=2026-11-01",
    )
    expect(safeReturnTo("/m/invoices", "/m")).toBe("/m/invoices")
  })

  it("refuses other sites and odd values", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com/x", "javascript:alert(1)", "dashboard", "", null, undefined]) {
      expect(safeReturnTo(bad, "/dashboard")).toBe("/dashboard")
    }
  })

  it("refuses sign-in screens and API routes", () => {
    for (const bad of ["/login", "/login?callbackUrl=/x", "/m/login", "/api/auth/session", "/signup/abc"]) {
      expect(safeReturnTo(bad, "/m")).toBe("/m")
    }
  })
})

describe("loginPathFor", () => {
  it("carries the page through login", () => {
    expect(loginPathFor("/dashboard/pnl?store=abc")).toBe("/login?callbackUrl=%2Fdashboard%2Fpnl%3Fstore%3Dabc")
  })
  it("leaves the landing pages bare", () => {
    expect(loginPathFor("/dashboard")).toBe("/login")
    expect(loginPathFor("/m")).toBe("/login")
  })
})
