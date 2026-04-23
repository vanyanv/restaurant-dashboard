// Shared plumbing for the scripts/audit/* family.
//
// - Loads .env.local so child scripts can `await import("../../src/lib/prisma")`.
// - Defines the Finding shape every domain script emits.
// - Provides the severity classifier so every script ranks $-deltas the same way.

import fs from "fs"
import path from "path"

export function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    if (!process.env[k]) process.env[k] = v
  }
}

export type Severity = "CRITICAL" | "WARNING" | "INFO"

export type Finding = {
  domain: string
  check: string
  severity: Severity
  message: string
  entity?: { kind: string; id: string; label?: string }
  details?: Record<string, unknown>
  /** Absolute dollar delta, for sort-by-impact. */
  deltaDollars?: number
  /** Delta as fraction of row (0.01 = 1%). */
  deltaPct?: number
}

/**
 * Classify a dollar discrepancy against a row's total using the plan's tiers:
 *   CRITICAL — abs ≥ $1 AND pct > 1% (material impact)
 *   WARNING  — anything above INFO noise but short of CRITICAL
 *   INFO     — abs < $0.10 AND pct < 0.1% (rounding noise)
 *
 * `rowDollars` is the reference magnitude (invoice total, line extended price, etc.).
 * When rowDollars is 0 but delta is non-zero, we treat pct as 1 (always material).
 */
export function classifyDollarDelta(absDelta: number, rowDollars: number): Severity {
  const pct = rowDollars > 0 ? absDelta / rowDollars : absDelta > 0 ? 1 : 0
  if (absDelta < 0.1 && pct < 0.001) return "INFO"
  if (absDelta >= 1 && pct >= 0.01) return "CRITICAL"
  return "WARNING"
}

/** Dollar formatter — 2dp, commas, "$—" for null. */
export function money(n: number | null | undefined): string {
  if (n == null) return "$—"
  const abs = Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${n < 0 ? "-$" : "$"}${abs}`
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export function shortId(id: string, n = 6): string {
  return id.length > n ? id.slice(-n) : id
}
