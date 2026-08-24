#!/usr/bin/env tsx
/**
 * Read-only. Spec decision 7 declined rebasing this branch onto main, so the
 * one thing that makes that choice expensive — main starting to touch UI —
 * has to be visible rather than discovered at merge time.
 *
 * Recent main commits touch src/lib/ml, scripts/ and prisma/. If the numbers
 * below start climbing in src/app, src/components or src/styles, raise it.
 */
import { execFileSync } from "node:child_process"

const WATCHED = ["src/app", "src/components", "src/styles"] as const
const IGNORED = ["src/lib/ml", "scripts", "prisma"] as const

function changedFiles(paths: readonly string[]): number {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "main...HEAD", "--", ...paths],
    { encoding: "utf8" },
  ).trim()
  return out === "" ? 0 : out.split("\n").length
}

function mainOnlyChanges(paths: readonly string[]): number {
  const out = execFileSync(
    "git",
    ["diff", "--name-only", "HEAD...main", "--", ...paths],
    { encoding: "utf8" },
  ).trim()
  return out === "" ? 0 : out.split("\n").length
}

const ours = changedFiles(WATCHED)
const theirs = mainOnlyChanges(WATCHED)
const theirsElsewhere = mainOnlyChanges(IGNORED)

console.log(`drift watch (branch vs main)`)
console.log(`  ours   in ${WATCHED.join(", ")}: ${ours} files`)
console.log(`  main's in ${WATCHED.join(", ")}: ${theirs} files`)
console.log(`  main's in ${IGNORED.join(", ")}: ${theirsElsewhere} files`)
if (theirs > 0) {
  console.log(
    `\n  NOTE: main has touched ${theirs} UI file(s). Spec decision 7 assumed it would not.`,
  )
}
