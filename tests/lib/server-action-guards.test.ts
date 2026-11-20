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

/** Source with comments removed, so a comment naming getSession( cannot pass for a call. */
/** In-memory files the fixture tests below add; checked before the disk. */
const VIRTUAL = new Map<string, string>()

function read(file: string): string {
  return (VIRTUAL.get(file) ?? fs.readFileSync(path.join(ROOT, file), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
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

/** Blank out string and template literals, so `"getSession("` cannot pass for a call. */
const code = (body: string) =>
  body.replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, '""')

/** Either quote style: `'use server'` is as much an endpoint as `"use server"`. */
const USE_SERVER = /^['"]use server['"];?\s*$/m

const actionFiles = execSync(`grep -rlE "^['\\"]use server['\\"]" src`, { cwd: ROOT, encoding: "utf8" })
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
  const body = code(fn.body)
  let ok = GUARD.test(body)
  if (!ok) {
    const imports = importsOf(file)
    const called = new Set([...body.matchAll(/\b(\w+)\(/g)].map((m) => m[1]))
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

/**
 * Does this action's own body touch Prisma before its first sign-in check?
 * A call to a function that reaches the check counts as the check, at the
 * position of that call.
 */
function queriesBeforeGuard(file: string, fn: Fn): boolean {
  const body = code(fn.body)
  const query = body.search(/\bprisma\.(?:\w+\.\w+|\$\w+)\(/)
  if (query < 0) return false
  let guard = body.search(GUARD)
  const fns = functionsOf(file)
  const imports = importsOf(file)
  for (const m of body.matchAll(/\b(\w+)\(/g)) {
    if (guard >= 0 && m.index! >= guard) break
    const c = m[1]
    if (c === fn.name) continue
    const reaches =
      (fns.some((f) => f.name === c) && reachesGuard(file, c)) ||
      (imports.has(c) && reachesGuard(...imports.get(c)!))
    if (reaches) guard = m.index!
  }
  return guard < 0 || guard > query
}

describe("server actions", () => {
  it("finds the server action files", () => {
    expect(actionFiles.length).toBeGreaterThan(5)
  })

  it("understands every export in a server action file", () => {
    // An export shape the parser below does not recognise (export default,
    // export { a }, export const x = wrap(async ...)) would be skipped
    // silently and so never checked. Fail instead, so the parser gets taught.
    const unseen: string[] = []
    for (const file of actionFiles) {
      const exports = read(file).match(/^export (?!type |interface )/gm)?.length ?? 0
      const parsed = functionsOf(file).filter((f) => f.exported).length
      if (exports !== parsed) unseen.push(`${file}: ${exports} exports, ${parsed} understood`)
    }
    expect(unseen).toEqual([])
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

  it("no exported server action queries the database before it checks who is signed in", () => {
    // Reaching the check is not enough if a read runs first: `saveRecipeLines`
    // read any account's recipe by id before its write path checked the
    // session (fixed 2026-11-20). Text order is the proxy: the first sign-in
    // check (or call to a function that reaches one) must come before the
    // first `prisma.` call in the action's own body.
    const early: string[] = []
    for (const file of actionFiles) {
      for (const fn of functionsOf(file)) {
        if (!fn.exported) continue
        const id = `${file}#${fn.name}`
        if (PUBLIC_ON_PURPOSE[id]) continue
        if (queriesBeforeGuard(file, fn)) early.push(id)
      }
    }
    expect(early, "These server actions query before checking the session").toEqual([])
  })

  it("flags a read ahead of the session check, and passes one after it", () => {
    VIRTUAL.set(
      "fixture/order.ts",
      `"use server"\n` +
        `export async function early(id) { const r = await prisma.recipe.findUnique({ where: { id } }); await getSession(); return r }\n` +
        `export async function late(id) { const s = await getSession(); return prisma.recipe.findFirst({ where: { id } }) }\n`,
    )
    try {
      const [early, late] = functionsOf("fixture/order.ts")
      expect(queriesBeforeGuard("fixture/order.ts", early)).toBe(true)
      expect(queriesBeforeGuard("fixture/order.ts", late)).toBe(false)
    } finally {
      VIRTUAL.clear()
    }
  })

  it("checks single-quoted directives and does not count a string as a guard call", () => {
    VIRTUAL.set("fixture/single.ts", `'use server'\nexport async function open() { return 1 }\n`)
    VIRTUAL.set(
      "fixture/strings.ts",
      `"use server"\nexport async function fake() { return "getSession(" }\nexport async function real() { await getSession(); return 1 }\n`,
    )
    try {
      expect(USE_SERVER.test(read("fixture/single.ts"))).toBe(true)
      expect(actionFiles.every((f) => USE_SERVER.test(read(f)))).toBe(true)
      expect(reachesGuard("fixture/single.ts", "open")).toBe(false)
      expect(reachesGuard("fixture/strings.ts", "fake")).toBe(false)
      expect(reachesGuard("fixture/strings.ts", "real")).toBe(true)
    } finally {
      VIRTUAL.clear()
    }
  })

  it("every server action reads the session through getSession, not next-auth directly", () => {
    const direct = actionFiles.filter((f) => /\bgetServerSession\(/.test(read(f)))
    expect(direct).toEqual([])
  })
})
