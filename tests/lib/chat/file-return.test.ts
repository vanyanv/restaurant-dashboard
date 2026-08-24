// Contract tests for the `fileReturn` presentation tool. It is the only tool
// in the set with no data access, so what matters is that it is registered,
// that it echoes its input unchanged (the client renders straight off the
// output), and that the schema rejects payloads the Answer Block cannot draw.

import { describe, it, expect, vi } from "vitest"

// The registry import pulls in every data tool, and those reach prisma at
// module load. Stub the two boundaries so this file can assert registration
// without a database.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
// @/lib/auth pulls in welcome.ts -> "server-only", which is aliased to
// server-only/empty.js in vitest.config.mts. See cron-staleness.test.ts for
// why this alias is necessary (Vitest 4.1.11+ doesn't respect export conditions).
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(),
  listOwnerStores: vi.fn(),
  renderStoreListForPrompt: vi.fn(),
}))

import { chatTools } from "@/lib/chat/tools"
import { fileReturn, RETURN_DEPARTMENTS } from "@/lib/chat/tools/file-return"
import { selectFiledReturn, returnForm } from "@/lib/chat/return"

const ctx = {} as never

describe("fileReturn registration", () => {
  it("is part of the chat tool surface under its own name", () => {
    expect(chatTools).toHaveProperty("fileReturn")
    expect(chatTools.fileReturn.name).toBe("fileReturn")
  })

  it("tells the model to call it once, after the data tools", () => {
    expect(fileReturn.description).toMatch(/exactly once/i)
  })
})

describe("fileReturn execute", () => {
  it("echoes its input so the payload lands on the message part", async () => {
    const input = {
      verdict: "Sales ran ahead of the week before.",
      department: "Sales" as const,
      scope: "Hollywood · Aug 11 – 17",
      figures: [{ value: "$48,912", label: "Net sales", delta: "+6.4%", direction: "up" as const }],
    }
    await expect(fileReturn.execute(input, ctx)).resolves.toEqual(input)
  })

  it("round-trips through the client selector", async () => {
    const out = await fileReturn.execute(
      {
        verdict: "Produce ran $12,480 in March.",
        department: "Costs",
        scope: "Hollywood · Mar 2026",
        figures: [
          { value: "$12,480", label: "Produce spend", delta: "+14.2%", direction: "down" },
          { value: "34", label: "Invoices" },
        ],
      },
      ctx,
    )
    const filed = selectFiledReturn([
      { type: "tool-fileReturn", toolName: "fileReturn", state: "output-available", output: out },
    ])
    expect(filed).not.toBeNull()
    expect(returnForm(filed!)).toBe("full")
    expect(filed!.figures[0].direction).toBe("down")
  })
})

describe("fileReturn schema", () => {
  const base = {
    verdict: "Sales ran ahead.",
    department: "Sales",
    figures: [],
  }

  it("accepts a return with no scope and no figures", () => {
    expect(fileReturn.parameters.safeParse(base).success).toBe(true)
  })

  it("offers a No data department for out-of-scope questions", () => {
    expect(RETURN_DEPARTMENTS).toContain("No data")
    expect(
      fileReturn.parameters.safeParse({ ...base, department: "No data" }).success,
    ).toBe(true)
  })

  it("rejects an unknown department", () => {
    expect(
      fileReturn.parameters.safeParse({ ...base, department: "Vibes" }).success,
    ).toBe(false)
  })

  it("rejects a fourth figure rather than silently dropping it", () => {
    const figures = Array.from({ length: 4 }, (_, i) => ({ value: `$${i}`, label: `L${i}` }))
    expect(fileReturn.parameters.safeParse({ ...base, figures }).success).toBe(false)
  })

  it("rejects a verdict long enough to break the block", () => {
    expect(
      fileReturn.parameters.safeParse({ ...base, verdict: "x".repeat(161) }).success,
    ).toBe(false)
  })

  it("rejects an empty verdict", () => {
    expect(fileReturn.parameters.safeParse({ ...base, verdict: "" }).success).toBe(false)
  })

  it("rejects a direction outside up and down", () => {
    expect(
      fileReturn.parameters.safeParse({
        ...base,
        figures: [{ value: "$1", label: "One", direction: "sideways" }],
      }).success,
    ).toBe(false)
  })

  it("rejects unknown keys so a hallucinated field is caught, not rendered", () => {
    expect(
      fileReturn.parameters.safeParse({ ...base, chartUrl: "https://example.com" }).success,
    ).toBe(false)
  })
})
