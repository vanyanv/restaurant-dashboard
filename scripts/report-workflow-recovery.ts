// The success-path counterpart to scripts/report-workflow-failure.ts.
//
// The failure reporter only ever creates or comments on a `cron-failure`
// incident issue — it never closes one — so issues lingered open long after
// the workflow went green again (see #36/#37/#39/#40/#41). This script runs on
// a successful cron run: if a matching open incident exists, it comments
// "recovered" and closes it. No-ops (exit 0) when there's nothing to close, so
// it's safe to wire into every cron workflow's `if: success()` path.

import { execFileSync } from "node:child_process"
import {
  findExistingIncidentIssue,
  type IncidentIssue,
} from "../src/lib/monitoring/github-incidents"

function env(name: string, fallback?: string): string {
  const raw = process.env[name]
  const value = raw && raw.trim() ? raw : fallback
  if (!value) throw new Error(`${name} is required`)
  return value
}

function gh(args: string[]): string {
  return execFileSync("gh", args, {
    encoding: "utf-8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

async function main() {
  const repo = env("GITHUB_REPOSITORY")
  const workflowName = env("WORKFLOW_NAME")
  const title = env("ISSUE_TITLE", `[Auto] ${workflowName} failing`)
  const label = env("ISSUE_LABEL", "cron-failure")
  const runUrl = `${env("GITHUB_SERVER_URL", "https://github.com")}/${repo}/actions/runs/${env("GITHUB_RUN_ID", "unknown")}`

  let issuesJson: string
  try {
    issuesJson = gh([
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--label",
      label,
      "--json",
      "number,title,labels",
      "--limit",
      "100",
    ])
  } catch {
    // Label may not exist yet (no failure has ever been reported) — nothing to close.
    console.log(`No open '${label}' issues to reconcile.`)
    return
  }

  const issues = JSON.parse(issuesJson || "[]") as IncidentIssue[]
  const issueNumber = findExistingIncidentIssue(issues, title, label)

  if (issueNumber == null) {
    console.log(`No open incident matching "${title}" — nothing to close.`)
    return
  }

  const comment = `✅ Recovered — workflow **${workflowName}** succeeded.\n\n- Run: ${runUrl}\n\nAuto-closing this incident; it will reopen automatically if the job fails again.`
  gh(["issue", "comment", String(issueNumber), "--repo", repo, "--body", comment])
  gh(["issue", "close", String(issueNumber), "--repo", repo, "--reason", "completed"])
  console.log(`Closed recovered incident issue #${issueNumber}`)
}

main().catch((err) => {
  // Never fail a green workflow just because issue cleanup hit a snag.
  console.error("Failed to reconcile workflow recovery:", err)
})
