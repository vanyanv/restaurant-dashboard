export type IncidentIssue = {
  number: number
  title: string
  labels?: Array<string | { name?: string | null }>
}

export type IncidentIssueBodyInput = {
  workflowName: string
  runUrl: string
  startedAt: string
  exitCode: string | number
  commitSha: string
  logText: string
  maxLogLines?: number
}

export type CronFailureSummaryInput = {
  command: string
  exitCode: string | number
  httpStatus?: string | number | null
  responseBody?: string | null
  stderr?: string | null
}

const DEFAULT_LOG_TAIL_LINES = 180

export function tailLogLines(logText: string, maxLines = DEFAULT_LOG_TAIL_LINES): string {
  const normalized = logText.replace(/\r\n/g, "\n").replace(/\n$/, "")
  if (!normalized) return ""
  const lines = normalized.split("\n")
  return lines.slice(-Math.max(maxLines, 0)).join("\n")
}

export function findExistingIncidentIssue(
  issues: IncidentIssue[],
  title: string,
  label: string,
): number | null {
  const match = issues.find((issue) => {
    if (issue.title !== title) return false
    return (issue.labels ?? []).some((candidate) => {
      if (typeof candidate === "string") return candidate === label
      return candidate.name === label
    })
  })
  return match?.number ?? null
}

export function summarizeCronFailure(input: CronFailureSummaryInput): string {
  const parts = [
    `Command: ${input.command}`,
    `Result: exit code ${input.exitCode}`,
  ]

  if (input.httpStatus != null && input.httpStatus !== "") {
    parts.push(`HTTP ${input.httpStatus}`)
  }
  if (input.stderr?.trim()) {
    parts.push(`stderr:\n${input.stderr.trim()}`)
  }
  if (input.responseBody?.trim()) {
    parts.push(`response body:\n${input.responseBody.trim()}`)
  }

  return parts.join("\n\n")
}

export function buildIncidentIssueBody(input: IncidentIssueBodyInput): string {
  const logTail = tailLogLines(input.logText, input.maxLogLines ?? DEFAULT_LOG_TAIL_LINES)

  return [
    `## ${input.workflowName} failed`,
    "",
    `- Run: ${input.runUrl}`,
    `- Started: ${input.startedAt}`,
    `- Exit code: ${input.exitCode}`,
    `- Commit: ${input.commitSha}`,
    "",
    "### Log tail",
    "```",
    logTail || "(no log output captured)",
    "```",
  ].join("\n")
}
