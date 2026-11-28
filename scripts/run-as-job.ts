// scripts/run-as-job.ts
//
// Runs a shell command inside `withJobRun`, so a GitHub Actions job that is
// not TypeScript (the nightly pg_dump backup) still records a JobRun row the
// monitoring page and the staleness detector can see stop.
//
//   npx tsx scripts/run-as-job.ts <jobName> -- <command> [args...]
//
// RUNNING at start; SUCCESS when the command exits 0, FAILURE (with the exit
// code as the error) otherwise. Exits with the command's own code. The
// command's output streams straight through; nothing from it is stored.

import "../src/lib/usage/script-meter-register" // usage counts; keep first
import { spawn } from "node:child_process"

export function parseArgs(argv: string[]): { jobName: string; command: string[] } {
  const sep = argv.indexOf("--")
  const jobName = argv[0]
  const command = sep === -1 ? [] : argv.slice(sep + 1)
  if (!jobName || jobName === "--" || command.length === 0) {
    throw new Error("usage: run-as-job.ts <jobName> -- <command> [args...]")
  }
  return { jobName, command }
}

function run(command: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: "inherit" })
    child.on("error", reject)
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)))
  })
}

async function main(): Promise<number> {
  const { jobName, command } = parseArgs(process.argv.slice(2))
  const { withJobRun } = await import("../src/lib/monitoring/job-run")
  let exitCode = 0
  try {
    await withJobRun(jobName, { triggeredBy: "github-actions" }, async ({ addRows }) => {
      exitCode = await run(command)
      if (exitCode !== 0) throw new Error(`${command[0]} exited ${exitCode}`)
      addRows(1)
    })
  } catch (err) {
    console.error(`[run-as-job] ${jobName} failed:`, err instanceof Error ? err.message : err)
    return exitCode === 0 ? 1 : exitCode
  }
  return 0
}

const invokedDirectly = !!process.argv[1] && /run-as-job\.ts$/.test(process.argv[1])
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error("[run-as-job]", err)
      process.exit(1)
    },
  )
}
