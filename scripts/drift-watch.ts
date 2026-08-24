#!/usr/bin/env tsx
/**
 * Read-only. Spec decision 7 declined rebasing this branch onto main, so the
 * one thing that makes that choice expensive — main starting to touch UI —
 * has to be visible rather than discovered at merge time.
 *
 * Recent main commits touch src/lib/ml, scripts/ and prisma/. If the numbers
 * below start climbing in src/app, src/components or src/styles, raise it.
 *
 * Always exits 0, even when the `main` ref is missing (e.g., shallow CI
 * checkouts). Failures are printed to stderr and reported as "unknown" rather
 * than silently zero, since this script's entire purpose is early warning.
 */
import { execFileSync } from "node:child_process"

const WATCHED = ["src/app", "src/components", "src/styles"] as const
const IGNORED = ["src/lib/ml", "scripts", "prisma"] as const

type CountResult = { value: number } | { error: string }

function changedFiles(paths: readonly string[]): CountResult {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--name-only", "main...HEAD", "--", ...paths],
      { encoding: "utf8" },
    ).trim()
    return { value: out === "" ? 0 : out.split("\n").length }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err)
    return { error: `could not compare main...HEAD: ${message}` }
  }
}

function mainOnlyChanges(paths: readonly string[]): CountResult {
  try {
    const out = execFileSync(
      "git",
      ["diff", "--name-only", "HEAD...main", "--", ...paths],
      { encoding: "utf8" },
    ).trim()
    return { value: out === "" ? 0 : out.split("\n").length }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err)
    return { error: `could not compare HEAD...main: ${message}` }
  }
}

const ours = changedFiles(WATCHED)
const theirs = mainOnlyChanges(WATCHED)
const theirsElsewhere = mainOnlyChanges(IGNORED)

// Format display values and collect errors
const ourDisplay =
  "value" in ours ? `${ours.value} files` : "unknown (see error below)"
const theirDisplay =
  "value" in theirs ? `${theirs.value} files` : "unknown (see error below)"
const theirElsewhereDisplay =
  "value" in theirsElsewhere ? `${theirsElsewhere.value} files` : "unknown (see error below)"

console.log(`drift watch (branch vs main)`)
console.log(`  ours   in ${WATCHED.join(", ")}: ${ourDisplay}`)
console.log(`  main's in ${WATCHED.join(", ")}: ${theirDisplay}`)
console.log(`  main's in ${IGNORED.join(", ")}: ${theirElsewhereDisplay}`)

// Print any errors to stderr
const errors = [ours, theirs, theirsElsewhere].filter(
  (r) => "error" in r,
)
if (errors.length > 0) {
  console.error("\nErrors during git operations:")
  for (const err of errors) {
    if ("error" in err) {
      console.error(`  ✗ ${err.error}`)
    }
  }
}

// Still warn if theirs shows UI changes
if ("value" in theirs && theirs.value > 0) {
  console.log(
    `\n  NOTE: main has touched ${theirs.value} UI file(s). Spec decision 7 assumed it would not.`,
  )
}
