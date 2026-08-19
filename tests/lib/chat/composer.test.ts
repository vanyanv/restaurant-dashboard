// Composer logic: slash shortcuts and the scope the question carries.
// Both are pure so the textarea component stays a thin shell over them.

import { describe, it, expect } from "vitest"
import {
  SLASH_COMMANDS,
  matchSlashCommands,
  applySlashCommand,
  buildScopedMessage,
  formatScopeLabel,
} from "@/lib/chat/composer"

describe("matchSlashCommands", () => {
  it("returns nothing for ordinary text", () => {
    expect(matchSlashCommands("how were sales")).toEqual([])
    expect(matchSlashCommands("")).toEqual([])
  })

  it("lists every command on a bare slash", () => {
    expect(matchSlashCommands("/")).toHaveLength(SLASH_COMMANDS.length)
  })

  it("filters by prefix as the owner types", () => {
    const hits = matchSlashCommands("/sp")
    expect(hits).toHaveLength(1)
    expect(hits[0].key).toBe("/spend")
  })

  it("is case-insensitive", () => {
    expect(matchSlashCommands("/SP")[0].key).toBe("/spend")
  })

  it("also matches on the command's description, not just its name", () => {
    // "/margin" is the command; "recipe" only appears in its description.
    const hits = matchSlashCommands("/recipe")
    expect(hits.map((c) => c.key)).toContain("/margin")
  })

  it("closes once the shortcut is complete and the owner types a space", () => {
    expect(matchSlashCommands("/spend ")).toEqual([])
    expect(matchSlashCommands("/spend on produce")).toEqual([])
  })

  it("returns an empty list rather than everything when nothing matches", () => {
    expect(matchSlashCommands("/zzzz")).toEqual([])
  })
})

describe("applySlashCommand", () => {
  it("replaces the typed shortcut with its prompt template", () => {
    const cmd = SLASH_COMMANDS.find((c) => c.key === "/spend")!
    expect(applySlashCommand("/sp", cmd)).toBe(cmd.template)
  })

  it("leaves text the owner typed after the shortcut alone", () => {
    const cmd = SLASH_COMMANDS.find((c) => c.key === "/sales")!
    expect(applySlashCommand("/sales", cmd)).toBe(cmd.template)
  })

  it("every command carries a template that is a real question", () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.template.length).toBeGreaterThan(0)
      expect(c.template.startsWith("/")).toBe(false)
    }
  })
})

describe("formatScopeLabel", () => {
  it("names a single store", () => {
    expect(formatScopeLabel({ storeName: "Hollywood", from: null, to: null })).toBe("Hollywood")
  })

  it("joins a store and a date range", () => {
    expect(
      formatScopeLabel({ storeName: "Hollywood", from: "2026-08-11", to: "2026-08-17" }),
    ).toBe("Hollywood · 2026-08-11 to 2026-08-17")
  })

  it("returns an empty label when nothing is scoped", () => {
    expect(formatScopeLabel({ storeName: null, from: null, to: null })).toBe("")
  })

  it("handles a range with no store", () => {
    expect(formatScopeLabel({ storeName: null, from: "2026-08-11", to: "2026-08-17" })).toBe(
      "2026-08-11 to 2026-08-17",
    )
  })
})

describe("buildScopedMessage", () => {
  const scope = { storeName: "Hollywood", from: "2026-08-11", to: "2026-08-17" }

  it("prefixes the question with the scope the composer is showing", () => {
    expect(buildScopedMessage("How were sales?", scope)).toBe(
      "(Scope: Hollywood · 2026-08-11 to 2026-08-17) How were sales?",
    )
  })

  it("sends the question untouched when nothing is scoped", () => {
    const bare = { storeName: null, from: null, to: null }
    expect(buildScopedMessage("How were sales?", bare)).toBe("How were sales?")
  })

  it("trims the question before prefixing", () => {
    expect(buildScopedMessage("  How were sales?  ", scope)).toBe(
      "(Scope: Hollywood · 2026-08-11 to 2026-08-17) How were sales?",
    )
  })

  it("does not prefix an empty question", () => {
    expect(buildScopedMessage("   ", scope)).toBe("")
  })
})
