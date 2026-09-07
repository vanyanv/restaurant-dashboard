import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { EvalQuestion } from "./questions"
import type { ToolCallRecord } from "./stream"
import type { FigureDiff, UnexplainedFigure } from "./arithmetic"

export interface QuestionResult {
  question: EvalQuestion
  finalText: string
  toolCalls: ToolCallRecord[]
  errors: string[]
  latencyMs: number
  /** Every figure a tool reported, against what SQL independently says. */
  figureDiffs: FigureDiff[]
  /** Dollar figures in the prose that no tool result accounts for. */
  unexplained: UnexplainedFigure[]
  /** `expectedTools` the model did not call. Reported, never gated. */
  routing: string[]
  /** Whether any tool this turn has a second implementation in arithmetic.ts. */
  recomputed: boolean
  /** Set when the request itself blew up (network error, non-2xx, etc.). */
  fatalError?: string
}

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

function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  })
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

export async function writeReport(
  outPath: string,
  results: QuestionResult[],
  startedAt: Date,
  totalMs: number,
): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true })

  const ok = results.filter(isPassing).length
  const errored = results.length - ok

  const latencies = results
    .filter((r) => !r.fatalError)
    .map((r) => r.latencyMs)
    .sort((a, b) => a - b)
  const wrongFigures = results.flatMap((r) => r.figureDiffs.filter((d) => !d.ok))
  const checked = results.flatMap((r) => r.figureDiffs).length
  const fabrications = results.filter((r) =>
    r.unexplained.some((u) => u.verdict === "fabricated"),
  )
  const underived = results.flatMap((r) =>
    r.unexplained.filter((u) => u.verdict === "underived"),
  )
  const diverged = results.filter((r) => r.routing.length > 0)

  const lines: string[] = []
  lines.push(`# Chat eval — ${formatTimestamp(startedAt)}`)
  lines.push("")
  lines.push(
    `Run: ${ok}/${results.length} ok · ${errored} not ok · ${(totalMs / 1000).toFixed(1)}s total`,
  )
  lines.push("")
  lines.push("## Baseline")
  lines.push("")
  lines.push("| measure | value |")
  lines.push("|---|---:|")
  lines.push(`| answers | ${results.length} |`)
  lines.push(`| latency p50 | ${(percentile(latencies, 50) / 1000).toFixed(1)}s |`)
  lines.push(`| latency p95 | ${(percentile(latencies, 95) / 1000).toFixed(1)}s |`)
  lines.push(`| latency max | ${(percentile(latencies, 100) / 1000).toFixed(1)}s |`)
  lines.push(`| figures recomputed against SQL | ${checked} |`)
  lines.push(`| …of those, wrong | ${wrongFigures.length} |`)
  lines.push(`| answers stating a fabricated dollar figure | ${fabrications.length} |`)
  lines.push(`| figures derived in a way the check cannot reconstruct | ${underived.length} |`)
  lines.push(`| answers that routed to a different tool than expected | ${diverged.length} |`)
  lines.push("")

  if (wrongFigures.length > 0) {
    lines.push("### Wrong figures — the tool and the database disagree")
    lines.push("")
    lines.push("| tool | figure | reported | actual |")
    lines.push("|---|---|---:|---:|")
    for (const d of wrongFigures) {
      lines.push(`| \`${d.tool}\` | ${d.label} | ${money(d.reported)} | ${money(d.actual)} |`)
    }
    lines.push("")
  }

  if (fabrications.length > 0) {
    lines.push("### Fabricated figures — stated in prose, unreachable from the data")
    lines.push("")
    for (const r of fabrications) {
      for (const u of r.unexplained.filter((u) => u.verdict === "fabricated")) {
        const near = u.nearest === null ? "nothing returned" : `nearest ${money(u.nearest)}`
        lines.push(`- \`${r.question.id}\` — **${u.token}** (${near})`)
      }
    }
    lines.push("")
  }

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
      const status = r.fatalError ? "FATAL" : isPassing(r) ? "ok" : "FAIL"
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

      if (r.figureDiffs.length > 0) {
        const wrong = r.figureDiffs.filter((d) => !d.ok)
        lines.push(
          `**Recomputed in SQL:** ${r.figureDiffs.length} figure(s), ${wrong.length} wrong`,
        )
        for (const d of wrong) {
          lines.push(
            `- \`${d.tool}\` ${d.label}: reported ${money(d.reported)}, actual ${money(d.actual)}`,
          )
        }
        lines.push("")
      } else if (!r.recomputed && r.toolCalls.length > 0) {
        lines.push("**Recomputed in SQL:** none — no tool here has a second implementation.")
        lines.push("")
      }

      if (r.unexplained.length > 0) {
        lines.push("**Figures the data does not directly account for:**")
        for (const u of r.unexplained) {
          const near =
            u.nearest === null
              ? "no tool returned any number"
              : `nearest returned value ${money(u.nearest)}`
          lines.push(`- ${u.token} — **${u.verdict}** — ${near}`)
        }
        lines.push("")
      }

      if (r.routing.length > 0) {
        lines.push(
          `**Routing divergence (reported, not gated):** did not call ${r.routing.map((t) => `\`${t}\``).join(", ")}`,
        )
        lines.push("")
      }

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

/** Seconds included: three back-to-back single-question runs overwrote each
 *  other when this was minute-granular. */
export function timestampForFilename(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
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
