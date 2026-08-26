import type { ReactNode } from "react"

export type TagTone = "good" | "bad" | "warn"

/** `.mtag` — a small status word. A toneless tag is the neutral grey one. */
export function Tag({ tone, children }: { tone?: TagTone; children: ReactNode }) {
  return <span className={tone ? `mtag ${tone}` : "mtag"}>{children}</span>
}

export type PillSeverity = "CRITICAL" | "WATCH" | "INFO"

/**
 * `.statuspill` — alert severity.
 *
 * The prototype reuses the invoice-status pill classes, so the class name and
 * the word do not match: CRITICAL wears REJECTED, WATCH wears REVIEW and INFO
 * wears APPROVED. That is the prototype's palette decision, not a mistake, and
 * the map lives here so no page repeats it.
 */
const PILL: Record<PillSeverity, { cls: string; label: string }> = {
  CRITICAL: { cls: "REJECTED", label: "Critical" },
  WATCH: { cls: "REVIEW", label: "Warning" },
  INFO: { cls: "APPROVED", label: "Info" },
}

export function StatusPill({ severity }: { severity: PillSeverity }) {
  const { cls, label } = PILL[severity]
  return <span className={`statuspill ${cls}`}>{label}</span>
}
