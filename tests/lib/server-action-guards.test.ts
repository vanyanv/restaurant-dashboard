// Every server action checks who is signed in.
//
// A file marked "use server" turns each exported async function into an
// endpoint any browser can call with any arguments. The only thing standing
// between that endpoint and the database is the function remembering to read
// the session. This test reads every "use server" file and fails if an
// exported function never reaches the app's sign-in check — directly, through
// a helper in the same file, or by calling a function (in this file or one it
// imports) that does.
//
// It is a text check (regex over the source), not a type-aware one: it proves
// the check is REACHED from each action, not that every branch runs it. The
// allowlist below names the actions that are public on purpose.

import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

const ROOT = path.resolve(__dirname, "../..")
const GUARD = /\b(getSession|getAuthScope|requireAuthScope|getSessionUser|requireOwnerStore|getCachedSession)\(/

/** Actions that are callable without a session on purpose, with the reason. */
const PUBLIC_ON_PURPOSE: Record<string, string> = {}

type Fn = { file: string; name: string; exported: boolean; body: string }

function read(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), "utf8")
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? path.join("src", spec.slice(2))
    : spec.startsWith(".")
      ? path.join(path.dirname(from), spec)
      : null
  if (!base) return null
  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(path.join(ROOT, c))) return path.normalize(c)
  }
  return null
}

/** Top-level functions in a file, cut at the next top-level declaration. */
function functionsOf(file: string): Fn[] {
  const src = read(file)
  const starts = [...src.matchAll(/^(export )?(?:async )?function (\w+)|^(export )?const (\w+)\s*=\s*(?:cache\()?async/gm)]
  return starts.map((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index! : src.length
    return {
      file,
      name: m[2] ?? m[4],
      exported: Boolean(m[1] ?? m[3]),
      body: src.slice(m.index!, end),
    }
  })
}

/** local name → [file, exported name] for each named import from a local module. */
function importsOf(file: string): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>()
  for (const m of read(file).matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    const target = resolveImport(file, m[2])
    if (!target) continue
    for (const part of m[1].split(",")) {
      const p = part.trim().replace(/^type\s+/, "")
      if (!p) continue
      const [orig, alias] = p.split(/\s+as\s+/)
      out.set((alias ?? orig).trim(), [target, orig.trim()])
    }
  }
  return out
}

const actionFiles = execSync(`grep -rlE '^"use server"' src`, { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)

/** Is `name` in `file` known to reach the sign-in check? Memoised, cycle-safe. */
const verdicts = new Map<string, boolean>()
function reachesGuard(file: string, name: string, seen = new Set<string>()): boolean {
  const key = `${file}#${name}`
  if (verdicts.has(key)) return verdicts.get(key)!
  if (seen.has(key)) return false
  seen.add(key)
  const fns = functionsOf(file)
  const fn = fns.find((f) => f.name === name)
  if (!fn) {
    // A re-export shim (`export { x } from "./y"`, see docs/refactor-playbook.md).
    for (const m of read(file).matchAll(/export\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
      const names = m[1].split(",").map((n) => n.trim().split(/\s+as\s+/))
      const hit = names.find(([orig, alias]) => (alias ?? orig) === name)
      const target = hit && resolveImport(file, m[2])
      if (hit && target) return reachesGuard(target, hit[0], seen)
    }
    return false
  }
  let ok = GUARD.test(fn.body)
  if (!ok) {
    const imports = importsOf(file)
    const called = new Set([...fn.body.matchAll(/\b(\w+)\(/g)].map((m) => m[1]))
    called.delete(name)
    for (const c of called) {
      if (fns.some((f) => f.name === c) && reachesGuard(file, c, seen)) ok = true
      else if (imports.has(c)) {
        const [target, orig] = imports.get(c)!
        if (reachesGuard(target, orig, seen)) ok = true
      }
      if (ok) break
    }
  }
  verdicts.set(key, ok)
  return ok
}

describe("server actions", () => {
  it("finds the server action files", () => {
    expect(actionFiles.length).toBeGreaterThan(5)
  })

  it("every exported server action reaches the sign-in check", () => {
    const missing: string[] = []
    for (const file of actionFiles) {
      for (const fn of functionsOf(file)) {
        if (!fn.exported) continue
        const id = `${file}#${fn.name}`
        if (PUBLIC_ON_PURPOSE[id]) continue
        if (!reachesGuard(file, fn.name)) missing.push(id)
      }
    }
    expect(missing, "These server actions never check who is signed in").toEqual([])
  })

  it("every server action reads the session through getSession, not next-auth directly", () => {
    const direct = actionFiles.filter((f) => /\bgetServerSession\(/.test(read(f)))
    expect(direct).toEqual([])
  })
})
