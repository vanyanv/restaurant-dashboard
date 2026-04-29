import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { EvalQuestion } from "./questions"
import type { ToolCallRecord } from "./stream"

export interface QuestionResult {
  question: EvalQuestion
  finalText: string
  toolCalls: ToolCallRecord[]
  errors: string[]
  latencyMs: number
  /** Set when the request itself blew up (network error, non-2xx, etc.). */
  fatalError?: string
}

export async function writeReport(
  outPath: string,
  results: QuestionResult[],
  startedAt: Date,
  totalMs: number,
): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true })

  const ok = results.filter((r) => !r.fatalError && r.errors.length === 0).length
  const errored = results.length - ok

  const lines: string[] = []
  lines.push(`# Chat eval — ${formatTimestamp(startedAt)}`)
  lines.push("")
  lines.push(
    `Run: ${ok}/${results.length} ok · ${errored} with errors · ${(totalMs / 1000).toFixed(1)}s total`,
  )
  lines.push("")

  // Group by category, preserving questions.ts order within each.
  const byCategory = new Map<string, QuestionResult[]>()
  for (const r of results) {
    const arr = byCategory.get(r.question.category) ?? []
    arr.push(r)
    byCategory.set(r.question.category, arr)
  }

  for (const [category, items] of byCategory) {
    lines.push(`## ${category}`)
    lines.push("")
    for (const r of items) {
      const status = r.fatalError
        ? "FATAL"
        : r.errors.length > 0
          ? "ERROR"
          : "ok"
      const latency = `${(r.latencyMs / 1000).toFixed(1)}s`
      lines.push(`### ${r.question.id} — ${status} (${latency})`)
      lines.push("")
      lines.push(`**Q:** ${r.question.question}`)
      if (r.question.expectedTools?.length) {
        lines.push(`**Expected tools:** ${r.question.expectedTools.join(", ")}`)
      }
      if (r.question.notes) {
        lines.push(`**Notes for review:** ${r.question.notes}`)
      }
      lines.push("")

      if (r.fatalError) {
        lines.push("**Fatal error:**")
        lines.push("```")
        lines.push(r.fatalError)
        lines.push("```")
        lines.push("")
        continue
      }

      lines.push(
        `**Tools called (${r.toolCalls.length}):** ${
          r.toolCalls.length === 0
            ? "(none)"
            : r.toolCalls.map((t) => t.toolName).join(", ")
        }`,
      )
      if (r.toolCalls.length > 0) {
        for (const t of r.toolCalls) {
          const argStr = compactJson(t.input)
          const errStr = t.error ? ` → ERROR: ${t.error}` : ""
          lines.push(`- \`${t.toolName}(${argStr})\`${errStr}`)
        }
      }
      lines.push("")
      lines.push("**Answer:**")
      lines.push("")
      lines.push(r.finalText ? quote(r.finalText) : "_(empty)_")
      lines.push("")

      if (r.errors.length > 0) {
        lines.push("**Stream errors:**")
        for (const e of r.errors) lines.push(`- ${e}`)
        lines.push("")
      }
    }
  }

  await writeFile(outPath, lines.join("\n"), "utf-8")
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function timestampForFilename(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

function compactJson(v: unknown): string {
  if (v === undefined) return ""
  try {
    const s = JSON.stringify(v)
    return s.length > 240 ? s.slice(0, 237) + "..." : s
  } catch {
    return String(v)
  }
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")
}
