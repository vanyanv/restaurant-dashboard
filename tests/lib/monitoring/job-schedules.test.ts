import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { JOB_SCHEDULES } from "@/lib/monitoring/job-schedules"

const ROOT = path.resolve(__dirname, "../../..")

/**
 * Declaring a job in JOB_SCHEDULES is a claim that the job exists: the
 * monitoring page renders a row for it, and the staleness detector reports on
 * it. Four entries had no implementation at all — monitoring.sweep existed
 * nowhere but this map, and cleanup/cache-flush pointed at routes nothing ever
 * called. Every one of them showed up in the staleness verdict as "has never
 * recorded a run", which is noise that teaches you to skim past the alert.
 */
const SEARCH_DIRS = ["src", "scripts", ".github"]
// The map itself, and the ownership table that keys off it, are declarations
// rather than evidence of a caller.
const NOT_EVIDENCE = [
  path.join("src", "lib", "monitoring", "job-schedules.ts"),
  path.join("src", "lib", "monitoring", "staleness.ts"),
]

function collectFiles(dir: string, acc: string[] = []): string[] {
  const full = path.join(ROOT, dir)
  if (!fs.existsSync(full)) return acc
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "generated") continue
      collectFiles(rel, acc)
    } else if (/\.(ts|tsx|yml|yaml)$/.test(entry.name)) {
      if (!NOT_EVIDENCE.includes(rel)) acc.push(rel)
    }
  }
  return acc
}

const corpus = collectFiles(SEARCH_DIRS[0])
  .concat(collectFiles(SEARCH_DIRS[1]), collectFiles(SEARCH_DIRS[2]))
  .map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), "utf8") }))

describe("JOB_SCHEDULES", () => {
  it("has a corpus to search — guards against the walk silently finding nothing", () => {
    expect(corpus.length).toBeGreaterThan(50)
  })

  it.each(Object.keys(JOB_SCHEDULES))(
    "%s is referenced by real code, not just declared",
    (jobName) => {
      const hits = corpus.filter((f) => f.text.includes(jobName)).map((f) => f.rel)
      expect(
        hits,
        `"${jobName}" appears nowhere outside JOB_SCHEDULES. Either wire it up or drop the entry.`,
      ).not.toHaveLength(0)
    },
  )
})
