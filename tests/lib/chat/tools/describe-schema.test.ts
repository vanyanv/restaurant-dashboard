/*
 * `describeSchema` is the tool the prompt sends the model to BEFORE it is
 * allowed to refuse a question. A tool missing from its hand-curated catalogue
 * is therefore a tool the model will conclude does not exist.
 *
 * That is not hypothetical. `getRefunds` was absent from the catalogue while
 * the prompt carried a routing rule for it, so the one tool the model was sent
 * here to check for was the one it could not find. This test is the gate that
 * makes the omission a build failure instead of a silent refusal.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/recipe-cost", () => ({ computeRecipeCost: vi.fn() }))
vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(async (_a: string, ids: string[] | null) => ids ?? ["s1"]),
  listOwnerStores: vi.fn(),
  renderStoreListForPrompt: vi.fn(),
}))

import { chatTools } from "@/lib/chat/tools"
import { describeSchema } from "@/lib/chat/tools/describe-schema"
import type { ChatToolContext } from "@/lib/chat/tools/types"

/**
 * Tools deliberately absent from the catalogue, each with its reason. A tool
 * added here is a decision; a tool missing from both here and the catalogue is
 * the bug this file catches.
 */
const EXEMPT: Record<string, string> = {
  // Not a data source. It is how an answer becomes UI, and a model asking
  // "what data do you have?" is not asking about the renderer.
  fileReturn: "presentation, not data",
  // The catalogue itself. Listing it inside itself tells a reader nothing.
  describeSchema: "this tool",
}

function ctx(activeTools: readonly string[] | null = null): ChatToolContext {
  return { ownerId: "u1", accountId: "acct-A", prisma: {} as never, activeTools }
}

describe("describeSchema catalogue", () => {
  it("names every registered tool", async () => {
    const result = await describeSchema.execute({ domain: "all" }, ctx())
    const catalogued = new Set(
      result.domains.flatMap((d) => d.tools.map((t) => t.name)),
    )
    const missing = Object.keys(chatTools).filter(
      (name) => !catalogued.has(name) && !(name in EXEMPT),
    )
    expect(missing, `add these to the CATALOG in describe-schema.ts: ${missing.join(", ")}`).toEqual([])
  })

  it("names nothing that is not a registered tool", async () => {
    const result = await describeSchema.execute({ domain: "all" }, ctx())
    const registered = new Set(Object.keys(chatTools))
    const phantom = result.domains
      .flatMap((d) => d.tools.map((t) => t.name))
      .filter((name) => !registered.has(name))
    expect(phantom, `these are catalogued but do not exist: ${phantom.join(", ")}`).toEqual([])
  })

  it("every exemption is still a real tool", () => {
    // An exemption for a deleted tool is a note nobody will ever re-read.
    for (const name of Object.keys(EXEMPT)) {
      expect(Object.keys(chatTools)).toContain(name)
    }
  })

  it("counts what it returned, not what exists", async () => {
    const result = await describeSchema.execute({ domain: "all" }, ctx())
    const listed = result.domains.reduce((n, d) => n + d.tools.length, 0)
    expect(result.totalToolCount).toBe(listed)
  })

  it("reports only what THIS turn can call", async () => {
    const result = await describeSchema.execute(
      { domain: "all" },
      ctx(["getDailySales", "listStores"]),
    )
    const names = result.domains.flatMap((d) => d.tools.map((t) => t.name))
    expect(names.sort()).toEqual(["getDailySales", "listStores"])
    expect(result.totalToolCount).toBe(2)
  })

  it("drops a domain left with no reachable tool rather than showing it empty", async () => {
    const result = await describeSchema.execute({ domain: "all" }, ctx(["getDailySales"]))
    expect(result.domains.map((d) => d.domain)).toEqual(["sales"])
    for (const d of result.domains) expect(d.tools.length).toBeGreaterThan(0)
  })

  it("every domain the schema accepts is a domain in the catalogue", async () => {
    /*
     * Asked through the public surface -- parse the value, run the tool --
     * rather than by reaching into zod's internals. A cast down to
     * `.shape.domain.unwrap().unwrap().options` throws rather than failing
     * informatively the moment the `.optional().default()` nesting or the zod
     * version changes, and it would be testing the library, not this file.
     */
    const catalogued = new Set(
      (await describeSchema.execute({ domain: "all" }, ctx())).domains.map((d) => d.domain),
    )
    for (const domain of catalogued) {
      // Every catalogued domain must be a value the model is allowed to send,
      // or the prompt points at a filter that cannot be applied.
      expect(describeSchema.parameters.safeParse({ domain }).success, domain).toBe(true)
    }
    // And the reverse: a domain the schema offers must return something.
    for (const domain of ["sales", "ratings", "forecasts", "anomalies", "elasticity"]) {
      const result = await describeSchema.execute({ domain } as never, ctx())
      expect(result.domains.map((d) => d.domain), domain).toEqual([domain])
    }
  })
})
