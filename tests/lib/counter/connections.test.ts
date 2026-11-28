// The list of connections stays true to the code.
//
// One way on purpose: every name the code reads must be on the list (or be one
// the platform sets), but the list may hold a name the code does not read yet.

import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  CONNECTIONS,
  CONNECTION_GROUPS,
  CONNECTION_ICONS,
  KEY_NAME_PATTERN,
  NEVER_SHOWN_KEY_NAMES,
  PLATFORM_KEY_NAMES,
  allKeyNames,
  allKeys,
  connectionsIn,
  findKey,
  githubOnlyKeyNames,
  isNeverShownKey,
  isPlatformKey,
} from "@/lib/counter/connections"

const ROOT = path.resolve(__dirname, "../../..")
const SKIP_DIRS = new Set(["node_modules", "generated", ".next", "__pycache__", ".venv", "venv"])

function walk(dir: string, exts: string[]): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(rel, exts))
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(rel)
  }
  return out
}

/** name → the first file that reads it. */
function scan(files: string[], patterns: RegExp[]): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8")
    for (const re of patterns) {
      for (const m of src.matchAll(re)) if (!found.has(m[1])) found.set(m[1], file)
    }
  }
  return found
}

const JS_EXTS = [".ts", ".tsx", ".mts", ".mjs", ".js"]
const JS_READS = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g,
  // `env.X` where a function takes `env = process.env` as a parameter.
  /(?<![.\w])env\.([A-Z][A-Z0-9_]{2,})/g,
  /(?<![.\w])env\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\]/g,
]

const unknown = (found: Map<string, string>) =>
  [...found].filter(([name]) => !findKey(name) && !isPlatformKey(name)).map(([n, f]) => `${n} (${f})`)

describe("every name the code reads is on the list", () => {
  it("covers src, scripts, e2e, prisma and the root config files", () => {
    const rootFiles = fs
      .readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isFile() && JS_EXTS.some((x) => e.name.endsWith(x)))
      .map((e) => e.name)
    const files = [
      ...walk("src", JS_EXTS),
      ...walk("scripts", JS_EXTS),
      ...walk("e2e", JS_EXTS),
      ...walk("prisma", JS_EXTS),
      ...rootFiles,
    ]
    expect(files.length).toBeGreaterThan(100)
    const found = scan(files, JS_READS)
    expect(found.has("DATABASE_URL")).toBe(true)
    expect(unknown(found), "add these to src/lib/counter/connections.ts").toEqual([])
  })

  it("covers the Python models in ml/", () => {
    const found = scan(walk("ml", [".py"]), [
      /os\.environ\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
      /os\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
      /os\.environ\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
    ])
    expect(unknown(found), "add these to src/lib/counter/connections.ts").toEqual([])
  })
})

describe("GitHub secrets match the list", () => {
  const used = scan(walk(".github/workflows", [".yml", ".yaml"]), [/secrets\.([A-Z][A-Z0-9_]*)/g])

  it("finds the workflows", () => {
    expect(used.has("CRON_SECRET")).toBe(true)
  })

  it("every secret a workflow reads is on the list and marked as a GitHub one", () => {
    const wrong = [...used]
      .filter(([name]) => !isPlatformKey(name) && findKey(name)?.github !== true)
      .map(([n, f]) => `${n} (${f})`)
    expect(wrong, "mark these github: true in connections.ts").toEqual([])
  })

  it("no key claims to be a GitHub secret that no workflow reads", () => {
    const stale = allKeys().filter((k) => k.github === true && !used.has(k.name)).map((k) => k.name)
    expect(stale, "drop github: true from these").toEqual([])
  })
})

describe("the list is well formed", () => {
  it("has no name twice", () => {
    const names = CONNECTIONS.flatMap((c) => c.keys.map((k) => k.name))
    const twice = names.filter((n, i) => names.indexOf(n) !== i)
    expect(twice).toEqual([])
    expect(allKeyNames()).toHaveLength(names.length)
  })

  it("has no connection id twice", () => {
    const ids = CONNECTIONS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("gives every connection a name, a short 'does' and a known icon", () => {
    for (const c of CONNECTIONS) {
      expect(c.name.trim(), c.id).not.toBe("")
      expect(c.does.trim(), c.id).not.toBe("")
      expect(c.does.split(/\s+/).length, `${c.id}: "${c.does}"`).toBeLessThanOrEqual(3)
      expect(typeof c.icon === "string" && c.icon.length > 0, c.id).toBe(true)
      expect(CONNECTION_ICONS, c.id).toContain(c.icon)
    }
  })

  it("puts every connection in a group that is shown, and every group has one", () => {
    const groups = CONNECTION_GROUPS.map((g) => g.id)
    for (const c of CONNECTIONS) expect(groups, c.id).toContain(c.group)
    for (const g of groups) expect(connectionsIn(g).length, g).toBeGreaterThan(0)
  })

  it("uses only names of the shape that may be looked up", () => {
    for (const name of allKeyNames()) expect(name).toMatch(KEY_NAME_PATTERN)
  })

  it("points every second name at a key on the list", () => {
    for (const k of allKeys()) for (const a of k.alt ?? []) expect(findKey(a), `${k.name} → ${a}`).not.toBeNull()
  })

  it("draws Pusher, the TV live push, on the map and holds no Ably key", () => {
    for (const name of ["PUSHER_APP_ID", "PUSHER_KEY", "PUSHER_SECRET", "PUSHER_CLUSTER"]) {
      expect(findKey(name)?.connection.name).toBe("Pusher")
    }
    expect(findKey("PUSHER_SECRET")?.secret).toBe(true)
    expect(CONNECTIONS.find((c) => c.name === "Pusher")?.onMap).toBe(true)
    expect(allKeys().filter((k) => k.name.startsWith("ABLY_"))).toEqual([])
  })

  it("keeps sign-in, settings and tools off the map", () => {
    for (const id of ["signin", "settings", "tools"]) {
      expect(CONNECTIONS.find((c) => c.id === id)?.onMap, id).toBe(false)
    }
  })

  it("tells someone setting up their own computer what to use for NEXTAUTH_URL", () => {
    expect(findKey("NEXTAUTH_URL")?.localNote).toMatch(/localhost:3000/)
  })
})

describe("names the platform sets", () => {
  it("are never on the list", () => {
    for (const name of PLATFORM_KEY_NAMES) expect(allKeyNames(), name).not.toContain(name)
  })

  it("are recognised, by name or by family", () => {
    for (const name of ["NODE_ENV", "CI", "VERCEL_ENV", "NEXT_RUNTIME", "GITHUB_ACTIONS", "GITHUB_RUN_ID", "VERCEL_OIDC_TOKEN", "GITHUB_TOKEN", "GITHUB_REF_NAME", "VERCEL_GIT_COMMIT_SHA"]) {
      expect(isPlatformKey(name), name).toBe(true)
    }
  })

  it("do not swallow our own keys that share a prefix", () => {
    for (const name of ["VERCEL_TOKEN", "VERCEL_PROJECT_ID", "VERCEL_TEAM_ID", "NEXTAUTH_SECRET"]) {
      expect(isPlatformKey(name), name).toBe(false)
    }
  })

  it("cover every AWS_ name: the host's own cloud credentials are never ours to show", () => {
    for (const name of ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_LAMBDA_FUNCTION_NAME", "AWS_EXECUTION_ENV", "AWS_ANYTHING_NEW"]) {
      expect(isPlatformKey(name), name).toBe(true)
    }
  })

  it("cover every VERCEL_ name except the three the list holds", () => {
    for (const name of ["VERCEL_SKEW_PROTECTION_ENABLED", "VERCEL_BLOB_STORE_ID", "VERCEL_CRON_SECRET_X", "VERCEL_ANYTHING_NEW", "VERCEL_OIDC_TOKEN", "VERCEL_AUTOMATION_BYPASS_SECRET"]) {
      expect(isPlatformKey(name), name).toBe(true)
    }
    const ours = allKeyNames().filter((n) => n.startsWith("VERCEL_"))
    expect(ours.sort()).toEqual(["VERCEL_PROJECT_ID", "VERCEL_TEAM_ID", "VERCEL_TOKEN"])
    for (const name of ours) expect(isPlatformKey(name), name).toBe(false)
  })

  it("cover NODE_OPTIONS", () => {
    expect(isPlatformKey("NODE_OPTIONS")).toBe(true)
  })
})

describe("keys that are never shown or copied", () => {
  it("are the keys that sign sessions and passes", () => {
    expect(NEVER_SHOWN_KEY_NAMES).toContain("NEXTAUTH_SECRET")
    expect(NEVER_SHOWN_KEY_NAMES).toContain("CHECKS_SECRET")
    expect(isNeverShownKey("NEXTAUTH_SECRET")).toBe(true)
    expect(isNeverShownKey("CHECKS_SECRET")).toBe(true)
  })

  it("are all on the list, so each still has a row saying whether it is set", () => {
    for (const name of NEVER_SHOWN_KEY_NAMES) expect(findKey(name), name).not.toBeNull()
  })

  it("do not include ordinary keys", () => {
    for (const name of ["DATABASE_URL", "NEXTAUTH_URL", "CRON_SECRET", "nextauth_secret", "", "toString"]) {
      expect(isNeverShownKey(name), name).toBe(false)
    }
  })
})

describe("the setting that names the one account allowed to read keys", () => {
  it("is on the list, under sign-in, not a secret, and not something the site needs to run", () => {
    const key = findKey("DEVELOPER_PORTAL_ACCOUNT_ID")
    expect(key?.connection.id).toBe("signin")
    expect(key?.secret).toBe(false)
    expect(key?.where).toBe("optional")
  })
})

describe("values stay on the server", () => {
  it("the list is marked server-only, so no browser bundle can pull it in", () => {
    const src = fs.readFileSync(path.join(ROOT, "src/lib/counter/connections.ts"), "utf8")
    expect(src).toMatch(/^import "server-only"$/m)
    expect(src).not.toMatch(/client code may\s+import it/)
  })

  it("nothing marked \"use client\" imports it for more than its types", () => {
    const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s+["']@\/lib\/counter\/connections["']/g
    const offenders = walk("src", [".ts", ".tsx"]).filter((file) => {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8")
      if (!/^\s*["']use client["']/m.test(text)) return false
      return [...text.matchAll(IMPORT)].some(
        ([, wholeIsType, names]) =>
          !wholeIsType && names.split(",").some((n) => n.trim() !== "" && !n.trim().startsWith("type ")),
      )
    })
    expect(offenders, "import only types from connections.ts in client files").toEqual([])
  })
})

describe("keys only GitHub holds", () => {
  it("names PredictHQ's token and nothing the server needs", () => {
    const names = githubOnlyKeyNames()
    expect(names).toContain("PREDICTHQ_API_TOKEN")
    expect(names).not.toContain("DATABASE_URL")
  })
})
