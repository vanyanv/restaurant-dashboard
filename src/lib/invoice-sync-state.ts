/**
 * What one invoice sync run leaves for the next, on its JobRun.metadata (no
 * table of its own, the way `deferred` and `lookbackDays` already ride there).
 *
 * Since 2026-11-20 every PDF in an email is its own Invoice row, so an email
 * can be half done: its first bill stored, its second cut by the per-run cap
 * or failed. `incomplete` keeps those emails pending whatever their age (and
 * the lookback wide enough to see them) until every PDF has a row. A PDF that
 * fails to read is counted in `readFailures`; at `MAX_READ_TRIES` it is held
 * for review as a row of its own, so it is not re-read forever. `noPdf` is
 * emails whose attachments hold no PDF, which would otherwise be downloaded
 * on every run while they sit in the window.
 */

export const MAX_READ_TRIES = 3
const MAX_INCOMPLETE = 200
const MAX_NO_PDF = 500

export type SyncState = {
  /** Emails with a PDF still to store: id → receivedDateTime. */
  incomplete: Map<string, string>
  /** `${messageId}#${pdfIndex}` (or `#attachments`) → failed tries so far. */
  readFailures: Map<string, number>
  /** Emails found to carry no invoice PDF. */
  noPdf: Set<string>
}

export function emptySyncState(): SyncState {
  return { incomplete: new Map(), readFailures: new Map(), noPdf: new Set() }
}

export const pdfKey = (messageId: string, index: number) => `${messageId}#${index}`
export const attachmentsKey = (messageId: string) => `${messageId}#attachments`

/** Read the state a previous run left; anything malformed reads as empty. */
export function readSyncState(metadata: unknown): SyncState {
  const state = emptySyncState()
  if (!metadata || typeof metadata !== "object") return state
  const m = metadata as Record<string, unknown>
  if (Array.isArray(m.incomplete)) {
    for (const e of m.incomplete) {
      if (e && typeof e === "object") {
        const { id, receivedAt } = e as Record<string, unknown>
        if (typeof id === "string" && typeof receivedAt === "string") state.incomplete.set(id, receivedAt)
      }
    }
  }
  if (m.readFailures && typeof m.readFailures === "object" && !Array.isArray(m.readFailures)) {
    for (const [k, v] of Object.entries(m.readFailures as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) state.readFailures.set(k, v)
    }
  }
  if (Array.isArray(m.noPdf)) {
    for (const id of m.noPdf) if (typeof id === "string") state.noPdf.add(id)
  }
  return state
}

/**
 * The state as JSON for JobRun.metadata. Bounded: the oldest incomplete
 * emails are kept (they are the ones nearest to falling out of the window).
 */
export function serializeSyncState(state: SyncState): Record<string, unknown> {
  const incomplete = [...state.incomplete.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .slice(0, MAX_INCOMPLETE)
    .map(([id, receivedAt]) => ({ id, receivedAt }))
  return {
    incomplete,
    readFailures: Object.fromEntries(state.readFailures),
    noPdf: [...state.noPdf].slice(-MAX_NO_PDF),
  }
}

/** Days back the oldest incomplete email arrived (rounded up, +1 of margin), else 0. */
export function incompleteLookbackDays(state: SyncState, now = Date.now()): number {
  let oldest = Infinity
  for (const at of state.incomplete.values()) {
    const t = Date.parse(at)
    if (Number.isFinite(t) && t < oldest) oldest = t
  }
  if (!Number.isFinite(oldest)) return 0
  return Math.min(365, Math.ceil((now - oldest) / (24 * 60 * 60 * 1000)) + 1)
}
