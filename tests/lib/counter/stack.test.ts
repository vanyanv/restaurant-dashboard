// The stack list reads its versions from package.json, so it cannot go stale.

import { describe, it, expect } from "vitest"
import pkg from "../../../package.json"
import { STACK, STACK_ICONS, STACK_PACKAGES, shortVersion } from "@/lib/counter/stack"

describe("shortVersion", () => {
  it("strips the range marks and keeps major.minor", () => {
    expect(shortVersion("^16.4.6")).toBe("16.4")
    expect(shortVersion("~4.1.11")).toBe("4.1")
    expect(shortVersion("3.11.0")).toBe("3.11")
    expect(shortVersion("0.1.0-beta.17")).toBe("0.1")
    expect(shortVersion(">=19.2.8")).toBe("19.2")
  })

  it("keeps a bare major as it is", () => {
    expect(shortVersion("^4")).toBe("4")
  })

  it("is null for something that is not a version", () => {
    expect(shortVersion(undefined)).toBeNull()
    expect(shortVersion("latest")).toBeNull()
    expect(shortVersion("github:someone/thing")).toBeNull()
  })
})

describe("the stack", () => {
  const rows = STACK.flatMap((g) => g.rows)

  it("has the six groups in order", () => {
    expect(STACK.map((g) => g.label)).toEqual(["Framework", "Data", "Interface", "Sign-in", "AI", "Testing"])
  })

  it("shows the version package.json pins for Next", () => {
    const next = rows.find((r) => r.name === "Next.js")
    expect(next?.version).toBe(shortVersion(pkg.dependencies.next))
    expect(next?.version).toMatch(/^\d+\.\d+$/)
  })

  it("finds every package it names", () => {
    const all: Record<string, string> = { ...pkg.devDependencies, ...pkg.dependencies }
    for (const name of STACK_PACKAGES) expect(shortVersion(all[name]), name).not.toBeNull()
    expect(rows.filter((r) => r.version !== null)).toHaveLength(STACK_PACKAGES.length)
  })

  it("carries the three hand-written rows with no version", () => {
    expect(rows.filter((r) => r.version === null).map((r) => r.name)).toEqual([
      "Postgres on Neon",
      "Counter design system",
      "Python forecast models in ml/",
    ])
  })

  it("gives every row a name and a known icon", () => {
    for (const r of rows) {
      expect(r.name.trim()).not.toBe("")
      expect(STACK_ICONS, r.name).toContain(r.icon)
    }
  })
})
