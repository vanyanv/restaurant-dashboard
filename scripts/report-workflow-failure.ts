import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  buildIncidentIssueBody,
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

function readLog(file: string | undefined): string {
  if (!file || !existsSync(file)) {
    return `No log file was found at: ${file || "unset"}`
  }
  return readFileSync(file, "utf-8")
}

async function main() {
  const repo = env("GITHUB_REPOSITORY")
  const workflowName = env("WORKFLOW_NAME")
  const title = env("ISSUE_TITLE", `[Auto] ${workflowName} failing`)
  const label = env("ISSUE_LABEL", "cron-failure")
  const runUrl = `${env("GITHUB_SERVER_URL", "https://github.com")}/${repo}/actions/runs/${env("GITHUB_RUN_ID")}`
  const startedAt = env("RUN_STARTED_AT", new Date().toISOString())
  const exitCode = env("FAILED_EXIT_CODE", "unknown")
  const commitSha = env("GITHUB_SHA", "unknown")
  const logText = readLog(process.env.LOG_FILE)

  gh([
    "label",
    "create",
    label,
    "--repo",
    repo,
    "--description",
    "Automated cron failure report",
    "--color",
    "B60205",
    "--force",
  ])

  const issuesJson = gh([
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
  const issues = JSON.parse(issuesJson || "[]") as IncidentIssue[]
  const issueNumber = findExistingIncidentIssue(issues, title, label)

  const body = buildIncidentIssueBody({
    workflowName,
    runUrl,
    startedAt,
    exitCode,
    commitSha,
    logText,
  })
  const bodyFile = path.join(
    tmpdir(),
    `workflow-failure-${process.env.GITHUB_RUN_ID ?? Date.now()}.md`,
  )
  writeFileSync(bodyFile, body, "utf-8")

  if (issueNumber != null) {
    gh(["issue", "comment", String(issueNumber), "--repo", repo, "--body-file", bodyFile])
    console.log(`Updated existing incident issue #${issueNumber}`)
    return
  }

  gh([
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    title,
    "--label",
    label,
    "--body-file",
    bodyFile,
  ])
  console.log(`Created incident issue: ${title}`)
}

main().catch((err) => {
  console.error("Failed to report workflow failure:", err)
  process.exit(1)
})
