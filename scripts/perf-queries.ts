/**
 * How many database round trips each screen costs, and on which tables.
 *
 * ## Why a second script beside `perf-sweep.ts`
 *
 * The sweep times a page from a browser, which measures round trips × latency
 * and cannot separate the two. Locally that product is misleading in both
 * directions: this machine talks to Neon in us-east-1 over the open internet,
 * so one query costs ~40ms here and ~2ms from the deployment beside it. A page
 * that looks slow locally may be one honest query; a page that looks fine may
 * be issuing sixty.
 *
 * The COUNT is the number that survives the move to production, because it is
 * the one the code decides. This script reads it straight out of the server's
 * own log, which `PRISMA_TRACE=1` fills with a line per operation:
 *
 *   PRISMA_TRACE=1 npx next start -p 3100 > /tmp/prod.log 2>&1
 *   PERF_LOG=/tmp/prod.log npx tsx scripts/perf-queries.ts
 *
 * ## Why curl-shaped requests and not a browser
 *
 * The queries we are counting are the SERVER's, and a document request makes
 * every one of them. A browser would add client-side fetches (TanStack Query
 * on the monitoring pages) and count them against the wrong page. The whole
 * body is read before the marker closes, because a streamed RSC response keeps
 * running queries after the first byte — stopping at headers would count the
 * shell and none of the sections.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { deskRoutes, phoneRoutes } from "../e2e/fidelity/routes"

const BASE_URL = process.env.PERF_BASE_URL ?? "http://localhost:3100"
const LOG = process.env.PERF_LOG ?? "/tmp/prod3100.log"
const STATE = resolve(process.cwd(), "e2e/.auth/user.json")

/** The signed-in cookie header, taken from the Playwright storage state. */
function cookieHeader(): string {
  const state = JSON.parse(readFileSync(STATE, "utf8")) as {
    cookies: Array<{ name: string; value: string }>
  }
  return state.cookies.map((c) => `${c.name}=${c.value}`).join("; ")
}

/** Bytes in the log now. Cheaper and more exact than counting lines. */
function logSize(): number {
  try {
    return readFileSync(LOG).length
  } catch {
    return 0
  }
}

function sliceSince(offset: number): string[] {
  const buf = readFileSync(LOG)
  return buf
    .subarray(offset)
    .toString("utf8")
    .split("\n")
    .filter((l) => l.startsWith("[q] "))
}

interface Row {
  route: string
  surface: string
  queries: number
  dbMs: number
  /** The three operations issued most, so a repeat inside a loop is visible. */
  top: string
}

async function walk(routes: string[], surface: "desk" | "phone", cookie: string) {
  const rows: Row[] = []
  for (const route of routes) {
    // Warm first, then measure: the first hit compiles nothing in a production
    // build but does prime the connection, and `cache()` is per-request so it
    // never carries a query across the two.
    for (const pass of [0, 1]) {
      const before = logSize()
      const res = await fetch(BASE_URL + route, {
        headers: {
          cookie,
          "user-agent":
            surface === "phone"
              ? "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"
              : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        },
        redirect: "follow",
      })
      await res.text() // drain: a streamed body keeps querying after headers
      if (pass === 0) continue

      const lines = sliceSince(before)
      const counts = new Map<string, number>()
      let dbMs = 0
      for (const line of lines) {
        const m = line.match(/^\[q\] ([\d.]+)ms (.+)$/)
        if (!m) continue
        dbMs += Number(m[1])
        counts.set(m[2], (counts.get(m[2]) ?? 0) + 1)
      }
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, n]) => `${k}×${n}`)
        .join(" ")
      rows.push({ route, surface, queries: lines.length, dbMs: Math.round(dbMs), top })
      process.stdout.write(
        `${surface === "desk" ? "🖥 " : "📱"} ${String(lines.length).padStart(3)} queries  ` +
          `${String(Math.round(dbMs)).padStart(6)}ms db  ${route}\n      ${top}\n`,
      )
    }
  }
  return rows
}

async function main() {
  const cookie = cookieHeader()
  const only = process.argv.includes("--desk")
    ? "desk"
    : process.argv.includes("--phone")
      ? "phone"
      : "both"

  if (logSize() === 0) {
    throw new Error(
      `No server log at ${LOG}. Start the server with PRISMA_TRACE=1 and redirect its output there.`,
    )
  }

  const rows: Row[] = []
  if (only !== "phone") rows.push(...(await walk(deskRoutes(), "desk", cookie)))
  if (only !== "desk") rows.push(...(await walk(phoneRoutes(), "phone", cookie)))

  if (rows.every((r) => r.queries === 0)) {
    throw new Error(
      "Every route reported zero queries — the server is almost certainly running without PRISMA_TRACE=1.",
    )
  }

  process.stdout.write("\n\nMOST QUERIES PER PAGE\n")
  for (const r of [...rows].sort((a, b) => b.queries - a.queries).slice(0, 25)) {
    process.stdout.write(
      `${String(r.queries).padStart(3)}  ${String(r.dbMs).padStart(6)}ms  ${r.surface} ${r.route}\n      ${r.top}\n`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
