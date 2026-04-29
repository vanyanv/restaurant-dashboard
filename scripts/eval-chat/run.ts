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

import { QUESTIONS, type EvalCategory, type EvalQuestion } from "./questions"
import { parseUIMessageStream } from "./stream"
import {
  writeReport,
  timestampForFilename,
  type QuestionResult,
} from "./report"

const BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3000"
const COOKIE_NAME =
  process.env.EVAL_COOKIE_NAME ?? "next-auth.session-token"

interface CliArgs {
  filter?: EvalCategory
  id?: string
  parallel: number
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cookie = await loadSessionCookie()
  await ensureDevServerReachable()

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
    (q, idx) => runOne(q, idx, selected.length, cookie),
  )
  const totalMs = Date.now() - startMs

  const outPath = resolve(
    process.cwd(),
    "scripts/eval-chat/runs",
    `${timestampForFilename(startedAt)}.md`,
  )
  await writeReport(outPath, results, startedAt, totalMs)

  const ok = results.filter((r) => !r.fatalError && r.errors.length === 0).length
  console.log("")
  console.log(
    `Done. ${ok}/${results.length} ok · ${(totalMs / 1000).toFixed(1)}s total`,
  )
  console.log(`Report: ${outPath}`)
}

async function runOne(
  q: EvalQuestion,
  idx: number,
  total: number,
  cookie: string,
): Promise<QuestionResult> {
  const label = `[${idx + 1}/${total}] ${q.id}`
  process.stdout.write(`${label} ... `)
  const start = Date.now()
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${COOKIE_NAME}=${cookie}`,
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
        fatalError: "Response had no body",
      }
    }

    const parsed = await parseUIMessageStream(res.body)
    const latency = Date.now() - start
    const tag =
      parsed.errors.length > 0 || parsed.toolCalls.some((t) => t.error)
        ? "ERROR"
        : "ok"
    console.log(`${tag} (${(latency / 1000).toFixed(1)}s, ${parsed.toolCalls.length} tools)`)
    return {
      question: q,
      finalText: parsed.finalText,
      toolCalls: parsed.toolCalls,
      errors: parsed.errors,
      latencyMs: latency,
    }
  } catch (err) {
    const latency = Date.now() - start
    console.log(`FATAL (${(latency / 1000).toFixed(1)}s)`)
    return {
      question: q,
      finalText: "",
      toolCalls: [],
      errors: [],
      latencyMs: latency,
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
  const out: CliArgs = { parallel: 1 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--filter") out.filter = argv[++i] as EvalCategory
    else if (a === "--id") out.id = argv[++i]
    else if (a === "--parallel") out.parallel = Math.max(1, Number(argv[++i]) || 1)
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

  // Lightweight .env.local reader — we deliberately avoid a `dotenv`
  // dependency for this one variable.
  try {
    const raw = await readFile(resolve(process.cwd(), ".env.local"), "utf-8")
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      if (key !== "EVAL_SESSION_COOKIE") continue
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (value) return value
    }
  } catch {
    // fall through to error below
  }

  console.error(
    [
      "Missing EVAL_SESSION_COOKIE. To set it:",
      "  1. Open the dashboard in your browser, log in as an OWNER.",
      "  2. DevTools → Application → Cookies → http://localhost:3000",
      `  3. Copy the value of the \`${COOKIE_NAME}\` cookie.`,
      "  4. Add to .env.local:  EVAL_SESSION_COOKIE=<paste-value-here>",
      "",
      "Override cookie name (e.g. for production-style `__Secure-` prefix):",
      "  EVAL_COOKIE_NAME=__Secure-next-auth.session-token",
    ].join("\n"),
  )
  process.exit(1)
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
