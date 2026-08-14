/**
 * Leg accounting shared by every credential rotation script.
 *
 * A "rotation" mints a fresh credential and pushes it to each store that reads
 * it — `.env.local`, Vercel, GitHub Actions. Every one of those pushes is a
 * *leg*, and the rule this module encodes is that a rotation succeeded only if
 * every required leg actually landed.
 *
 * That rule exists because of two incidents:
 *
 *   - 2026-08-12 (Harri): the GitHub leg 401'd for three straight weeks while
 *     the script printed "Done!" and exited 0. The systemd timer reported
 *     success the whole time and the Actions secret stayed frozen at a token
 *     counting down to expiry.
 *   - 2026-08-13 (Otter): the identical shape, found one script over while
 *     fixing the first. `OTTER_JWT` had been frozen for 78 days behind a daily
 *     workflow that reported success every single morning.
 *
 * Two rules fall out, and both matter more than they look:
 *
 *   1. `skipped` is a failure when the leg is required. A missing credential
 *      used to print "Skipped" and exit 0 — on an unattended timer the exit
 *      code is the only signal that escapes, so "I didn't try" and "it worked"
 *      must not look alike.
 *   2. Believe a write only after reading it back. Secret values are write-only
 *      at both Vercel and GitHub, so a 200 on the PUT is not proof the value
 *      landed; the caller confirms the store's own `updatedAt` moved.
 *
 * Pure functions only — no network, no fs — so the rules stay testable without
 * burning a real login.
 */

export type LegStatus = "ok" | "skipped" | "failed"

export type LegSpec = {
  /** Stable identifier, quoted back in `problems` and in the failure message. */
  name: string
  /** Human label for the summary block. */
  label: string
  status: LegStatus
  /** Only required legs drive the exit code. */
  required: boolean
}

export type LegProblem = { leg: string; status: LegStatus }

export type RotationVerdict = {
  /** True only when every required leg landed. Drives the process exit code. */
  ok: boolean
  /** Required legs that did not land, with the reason baked into the status. */
  problems: LegProblem[]
  /** Human-readable summary, one line per leg, in the order given. */
  lines: string[]
}

/** Widest label we pad to, so the status column lines up in the log. */
const LABEL_WIDTH = 16

/**
 * Decide whether a rotation actually succeeded.
 *
 * Legs are reported in the order supplied — that ordering is the sequence the
 * script attempted them in, which is what a log reader is reconstructing.
 */
export function summarizeLegs(legs: LegSpec[]): RotationVerdict {
  const problems: LegProblem[] = []
  const lines: string[] = []

  for (const { name, label, status, required } of legs) {
    if (required && status !== "ok") problems.push({ leg: name, status })
    const mark = status === "ok" ? "ok" : status === "skipped" ? "SKIPPED" : "FAILED"
    const suffix = required ? "" : " (not required)"
    lines.push(`  ${label.padEnd(LABEL_WIDTH)} ${mark}${suffix}`)
  }

  return { ok: problems.length === 0, problems, lines }
}

/**
 * The standard failure message. Says the thing that is easy to miss when a
 * rotation half-lands: the stores now disagree, and the legs that *did* fail
 * are still serving the previous credential — which keeps working right up
 * until it expires, which is exactly why nobody notices.
 */
export function describeRotationFailure(problems: LegProblem[]): string {
  const detail = problems.map((p) => `${p.leg} (${p.status})`).join(", ")
  return (
    `\nFAILED — the credential did not land everywhere: ${detail}.\n` +
    "The stores are now out of sync: whichever leg failed is still serving the OLD\n" +
    "credential, and it will keep working right up until it expires. Fix the\n" +
    "credential for that leg and re-run, or pass --allow-partial if this is a\n" +
    "deliberate partial run."
  )
}
