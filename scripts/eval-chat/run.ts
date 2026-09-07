/**
 * Eval harness for /api/chat.
 *
 * Usage:
 *   npm run eval:chat                  # all questions, sequential
 *   npm run eval:chat -- --filter sales
 *   npm run eval:chat -- --id sales-last-week
 *   npm run eval:chat -- --parallel 3
 *
 * Auth: copy your `next-auth.session-token` cookie value from the
 * dashboard (DevTools → Application → Cookies → http://localhost:3000)
 * into `.env.local` as `EVAL_SESSION_COOKIE=...`. The cookie name uses
 * `__Secure-` prefix in production but plain on localhost.
 */

import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import pg from "pg"

import { QUESTIONS, type EvalCategory, type EvalQuestion } from "./questions"
import { parseUIMessageStream } from "./stream"
import {
  RECOMPUTED_TOOLS,
  recomputeCall,
  unexplainedFigures,
  type FigureDiff,
} from "./arithmetic"
import {
  writeReport,
  timestampForFilename,
  type QuestionResult,
} from "./report"
import type { ToolCallRecord } from "./stream"

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000"
const COOKIE_NAME =
  process.env.EVAL_COOKIE_NAME ?? "next-auth.session-token"

interface CliArgs {
  filter?: EvalCategory
  id?: string
  parallel: number
  /** Clear the answer cache first, so the run measures cold latency. */
  fresh: boolean
}

/** Everything `runOne` needs beyond the question itself. */
interface RunContext {
  cookie: string
  db: pg.Client | null
  storeIds: string[]
}

async function main() {
  await loadEnvLocal()
  const args = parseArgs(process.argv.slice(2))
  const cookie = await loadSessionCookie()
  await ensureDevServerReachable()
  const ctx = await openTruthConnection(cookie)
  if (args.fresh) await clearAnswerCache()

  const selected = filterQuestions(QUESTIONS, args)
  if (selected.length === 0) {
    console.error("No questions matched the filter. Aborting.")
    process.exit(1)
  }

  console.log(
    `Running ${selected.length} question(s) against ${BASE_URL}/api/chat ` +
      `(parallel=${args.parallel})...`,
  )

  const startedAt = new Date()
  const startMs = Date.now()
  const results: QuestionResult[] = await runWithConcurrency(
    selected,
    args.parallel,
    (q, idx) => runOne(q, idx, selected.length, ctx),
  )
  await ctx.db?.end().catch(() => undefined)
  const totalMs = Date.now() - startMs

  const outPath = resolve(
    process.cwd(),
    "scripts/eval-chat/runs",
    `${timestampForFilename(startedAt)}.md`,
  )
  await writeReport(outPath, results, startedAt, totalMs)

  const ok = results.filter((r) => isPassing(r)).length
  console.log("")
  console.log(
    `Done. ${ok}/${results.length} ok · ${(totalMs / 1000).toFixed(1)}s total`,
  )
  console.log(`Report: ${outPath}`)
  if (ok !== results.length) process.exit(1)
}

async function runOne(
  q: EvalQuestion,
  idx: number,
  total: number,
  ctx: RunContext,
): Promise<QuestionResult> {
  const label = `[${idx + 1}/${total}] ${q.id}`
  process.stdout.write(`${label} ... `)
  const start = Date.now()
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${COOKIE_NAME}=${ctx.cookie}`,
      },
      body: JSON.stringify({
        messages: [
          {
            id: `eval-${randomUUID()}`,
            role: "user",
            parts: [{ type: "text", text: q.question }],
          },
        ],
        // Always start a fresh conversation so questions are independent.
        conversationId: undefined,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      const fatal = `HTTP ${res.status}: ${text.slice(0, 300)}`
      const latency = Date.now() - start
      console.log(`FATAL (${(latency / 1000).toFixed(1)}s)`)
      return {
        question: q,
        finalText: "",
        toolCalls: [],
        errors: [],
        latencyMs: latency,
        ...EMPTY_CHECKS,
        fatalError: fatal,
      }
    }

    if (!res.body) {
      const latency = Date.now() - start
      console.log(`FATAL (${(latency / 1000).toFixed(1)}s)`)
      return {
        question: q,
        finalText: "",
        toolCalls: [],
        errors: [],
        latencyMs: latency,
        ...EMPTY_CHECKS,
        fatalError: "Response had no body",
      }
    }

    const parsed = await parseUIMessageStream(res.body)
    const latency = Date.now() - start
    const errors = [...parsed.errors, ...validateResult(q, parsed)]

    // The arithmetic half. Both layers need the answer AND the tool results,
    // so they run here rather than inside the stream parser.
    const figureDiffs: FigureDiff[] = []
    if (ctx.db) {
      for (const call of parsed.toolCalls) {
        try {
          figureDiffs.push(...(await recomputeCall(call, ctx.db, ctx.storeIds)))
        } catch (err) {
          errors.push(
            `Could not recompute ${call.toolName}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }
    const unexplained = unexplainedFigures(parsed.finalText, parsed.toolCalls)
    const routing = routingDivergence(q, parsed.toolCalls)

    const result: QuestionResult = {
      question: q,
      finalText: parsed.finalText,
      toolCalls: parsed.toolCalls,
      errors,
      latencyMs: latency,
      figureDiffs,
      unexplained,
      routing,
      recomputed: parsed.toolCalls.some((t) =>
        (RECOMPUTED_TOOLS as readonly string[]).includes(t.toolName),
      ),
    }
    const tag = isPassing(result) ? "ok" : "FAIL"
    const wrong = figureDiffs.filter((d) => !d.ok).length
    const notes = [
      `${(latency / 1000).toFixed(1)}s`,
      `${parsed.toolCalls.length} tools`,
      wrong > 0 ? `${wrong} wrong figures` : null,
      unexplained.some((u) => u.verdict === "fabricated")
        ? `${unexplained.filter((u) => u.verdict === "fabricated").length} fabricated`
        : null,
      unexplained.some((u) => u.verdict === "underived")
        ? `${unexplained.filter((u) => u.verdict === "underived").length} underived`
        : null,
    ].filter(Boolean)
    console.log(`${tag} (${notes.join(", ")})`)
    return result
  } catch (err) {
    const latency = Date.now() - start
    console.log(`FATAL (${(latency / 1000).toFixed(1)}s)`)
    return {
      question: q,
      finalText: "",
      toolCalls: [],
      errors: [],
      latencyMs: latency,
      ...EMPTY_CHECKS,
      fatalError: err instanceof Error ? err.message : String(err),
    }
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const idx = next++
      if (idx >= items.length) return
      results[idx] = await task(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return results
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { parallel: 1, fresh: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--filter") out.filter = argv[++i] as EvalCategory
    else if (a === "--id") out.id = argv[++i]
    else if (a === "--parallel") out.parallel = Math.max(1, Number(argv[++i]) || 1)
    else if (a === "--fresh") out.fresh = true
    else if (a === "--help" || a === "-h") {
      printUsage()
      process.exit(0)
    } else {
      console.error(`Unknown arg: ${a}`)
      printUsage()
      process.exit(1)
    }
  }
  return out
}

function printUsage() {
  console.log(`Usage: tsx scripts/eval-chat/run.ts [options]
  --filter <category>   Run only one category (e.g. sales, recipes, should-refuse)
  --id <question-id>    Run only one question by id
  --parallel <n>        Concurrent requests (default 1)
  --fresh               Clear the answer cache first (cold latency, for a baseline)
  --help                Show this help`)
}

function filterQuestions(qs: EvalQuestion[], args: CliArgs): EvalQuestion[] {
  return qs.filter((q) => {
    if (args.id && q.id !== args.id) return false
    if (args.filter && q.category !== args.filter) return false
    return true
  })
}

async function loadSessionCookie(): Promise<string> {
  const fromEnv = process.env.EVAL_SESSION_COOKIE
  if (fromEnv) return fromEnv

  const cookieFromLogin = await loginWithSeededOwner()
  if (cookieFromLogin) return cookieFromLogin

  const candidates = await listOwnerCandidates()
  const candidateText = candidates.length
    ? [
        "",
        "Seeded login did not work. Candidate OWNER/DEVELOPER users found:",
        ...candidates.map((email) => `  - ${email}`),
      ].join("\n")
    : ""

  console.error(
    [
      "Missing EVAL_SESSION_COOKIE and seeded login failed.",
      "To set it manually:",
      "  1. Open the dashboard in your browser, log in as an OWNER or DEVELOPER.",
      "  2. DevTools -> Application -> Cookies -> http://localhost:3000",
      `  3. Copy the value of the \`${COOKIE_NAME}\` cookie.`,
      "  4. Add to .env.local:  EVAL_SESSION_COOKIE=<paste-value-here>",
      "",
      "Override cookie name (e.g. for production-style `__Secure-` prefix):",
      "  EVAL_COOKIE_NAME=__Secure-next-auth.session-token",
      candidateText,
    ].join("\n"),
  )
  process.exit(1)
}

async function loadEnvLocal(): Promise<void> {
  try {
    const raw = await readFile(resolve(process.cwd(), ".env.local"), "utf-8")
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (value && process.env[key] === undefined) process.env[key] = value
    }
  } catch {
    // Optional file; fall through to existing environment.
  }
}

function validateResult(
  _q: EvalQuestion,
  parsed: Awaited<ReturnType<typeof parseUIMessageStream>>,
): string[] {
  const errors: string[] = []
  if (!parsed.finalText.trim()) errors.push("Empty final answer")
  for (const t of parsed.toolCalls) {
    if (t.error) errors.push(`Tool ${t.toolName} failed: ${t.error}`)
  }
  return errors
}

/**
 * `expectedTools` is REPORTED, not gated. It was written as one exact name per
 * question, and the model routinely picks a defensible different one — the
 * first run of this harness called `compareSales` for "what were my sales last
 * week?" and answered it correctly, which the old check scored as a failure.
 * Tool choice already has a graded eval of its own (`npm run eval:llm --feature
 * chat-tool-choice`, 12/12); a second, dumber copy of it here would only teach
 * people to ignore a permanently red report.
 */
function routingDivergence(q: EvalQuestion, calls: ToolCallRecord[]): string[] {
  const called = new Set(calls.map((c) => c.toolName))
  return (q.expectedTools ?? []).filter((t) => !called.has(t))
}

const EMPTY_CHECKS = {
  figureDiffs: [] as FigureDiff[],
  unexplained: [],
  routing: [],
  recomputed: false,
} satisfies Pick<
  QuestionResult,
  "figureDiffs" | "unexplained" | "routing" | "recomputed"
>

/**
 * Passing means the answer was TRUE, not merely that one arrived: no wrong
 * figure against SQL, and no dollar figure the tool results cannot account
 * for. See `arithmetic.ts` for why those are the two that matter.
 */
function isPassing(r: QuestionResult): boolean {
  return (
    !r.fatalError &&
    r.finalText.trim().length > 0 &&
    r.errors.length === 0 &&
    !r.toolCalls.some((t) => t.error) &&
    r.figureDiffs.every((d) => d.ok) &&
    r.unexplained.every((u) => u.verdict !== "fabricated")
  )
}

/**
 * The second connection the arithmetic layer recomputes through, plus the
 * store scope a tool call falls back to when the model omits `storeIds` —
 * which is every store on the eval user's account, the same expansion
 * `resolveStoreIds` performs inside the app.
 */
async function openTruthConnection(cookie: string): Promise<RunContext> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.warn("No DATABASE_URL — figures will not be recomputed against SQL.")
    return { cookie, db: null, storeIds: [] }
  }
  const db = new pg.Client({ connectionString: url })
  try {
    await db.connect()
    const res = await db.query<{ id: string }>(
      `SELECT s.id
         FROM "Store" s
         JOIN "User" u ON u."accountId" = s."accountId"
        WHERE u.email = $1`,
      [EVAL_LOGIN_EMAIL],
    )
    const storeIds = res.rows.map((r) => r.id)
    console.log(`Recomputing figures against ${storeIds.length} store(s) in SQL.`)
    return { cookie, db, storeIds }
  } catch (err) {
    console.warn(
      `Could not open the truth connection (${err instanceof Error ? err.message : err}); figures will not be recomputed.`,
    )
    await db.end().catch(() => undefined)
    return { cookie, db: null, storeIds: [] }
  }
}

const EVAL_LOGIN_EMAIL = "demo@restaurantos.com"

async function loginWithSeededOwner(): Promise<string | null> {
  const email = EVAL_LOGIN_EMAIL
  const password = "demo123"
  try {
    const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`)
    if (!csrfRes.ok) return null
    const csrfCookie = cookieHeaderFromSetCookie(csrfRes.headers)
    const csrf = (await csrfRes.json()) as { csrfToken?: string }
    if (!csrf.csrfToken || !csrfCookie) return null

    const form = new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email,
      password,
      json: "true",
      redirect: "false",
    })
    const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: csrfCookie,
      },
      body: form,
      redirect: "manual",
    })
    const setCookie = loginRes.headers.getSetCookie?.() ?? []
    const sessionCookie = setCookie
      .map(parseSetCookie)
      .find((c) => c.name === COOKIE_NAME)
    if (!sessionCookie?.value) return null

    const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, {
      headers: { cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    })
    if (!sessionRes.ok) return null
    const session = (await sessionRes.json()) as { user?: { email?: string } }
    if (session.user?.email !== email) return null

    console.log(`Using seeded eval login: ${email}`)
    return sessionCookie.value
  } catch {
    return null
  }
}

async function listOwnerCandidates(): Promise<string[]> {
  const url = process.env.DATABASE_URL
  if (!url) return []
  const client = new pg.Client({ connectionString: url })
  try {
    await client.connect()
    const res = await client.query<{ email: string }>(
      `SELECT email
         FROM "User"
        WHERE role IN ('OWNER', 'DEVELOPER')
        ORDER BY role DESC, email
        LIMIT 10`,
    )
    return res.rows.map((r) => r.email)
  } catch {
    return []
  } finally {
    await client.end().catch(() => undefined)
  }
}

function cookieHeaderFromSetCookie(headers: Headers): string {
  const cookies = headers.getSetCookie?.() ?? []
  return cookies.map(parseSetCookie).map((c) => `${c.name}=${c.value}`).join("; ")
}

function parseSetCookie(raw: string): { name: string; value: string } {
  const first = raw.split(";")[0] ?? ""
  const eq = first.indexOf("=")
  if (eq === -1) return { name: first, value: "" }
  return { name: first.slice(0, eq), value: first.slice(eq + 1) }
}

/**
 * A second run of the same question is served from `chat:answer:*` in about a
 * second, which is the feature working and useless as a baseline. `--fresh`
 * drops those keys so latency here is what a reader waiting on the model
 * actually waits. Nothing else in Redis is touched.
 */
async function clearAnswerCache(): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    console.warn("No Upstash credentials — answer cache not cleared; latency may be a cache hit.")
    return
  }
  const { Redis } = await import("@upstash/redis")
  const redis = new Redis({ url, token })
  let cursor = "0"
  let removed = 0
  do {
    const [next, keys] = (await redis.scan(cursor, {
      match: "chat:answer:*",
      count: 500,
    })) as [string, string[]]
    cursor = String(next)
    if (keys.length > 0) {
      await redis.del(...keys)
      removed += keys.length
    }
  } while (cursor !== "0")
  console.log(`Cleared ${removed} cached answer(s); this run measures cold latency.`)
}

async function ensureDevServerReachable(): Promise<void> {
  try {
    const res = await fetch(BASE_URL, { method: "HEAD" })
    if (res.status >= 500) throw new Error(`status ${res.status}`)
  } catch (err) {
    console.error(
      `Cannot reach ${BASE_URL}. Start it with \`npm run dev\` in another terminal.`,
    )
    console.error(`Underlying error: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("Eval harness crashed:", err)
  process.exit(1)
})
