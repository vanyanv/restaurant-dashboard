/**
 * Engagement derivation over the raw PageView stream.
 *
 * Sessions are computed here rather than stored: a pure function over a few
 * thousand ordered rows is cheap, and storing them would create a second
 * source of truth that drifts from the views it summarizes.
 */

export const SESSION_GAP_MS = 30 * 60 * 1000

export type ViewRow = {
  path: string
  route: string
  enteredAt: Date
  dwellMs: number | null
}

export type Session = {
  startedAt: Date
  endedAt: Date
  durationMs: number
  pageCount: number
  entryPath: string
  exitPath: string
  views: ViewRow[]
}

/** A session ends when the gap between one view's end and the next view's
 * start EXCEEDS gapMs. Exactly gapMs keeps them together. */
export function groupIntoSessions(
  views: ViewRow[],
  gapMs: number = SESSION_GAP_MS,
): Session[] {
  if (views.length === 0) return []

  const ordered = [...views].sort(
    (a, b) => a.enteredAt.getTime() - b.enteredAt.getTime(),
  )

  const groups: ViewRow[][] = [[ordered[0]!]]
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!
    const cur = ordered[i]!
    const prevEnd = prev.enteredAt.getTime() + (prev.dwellMs ?? 0)
    if (cur.enteredAt.getTime() - prevEnd > gapMs) {
      groups.push([cur])
    } else {
      groups[groups.length - 1]!.push(cur)
    }
  }

  return groups.map((group) => {
    const first = group[0]!
    const last = group[group.length - 1]!
    const startedAt = first.enteredAt
    const endedAt = new Date(last.enteredAt.getTime() + (last.dwellMs ?? 0))
    return {
      startedAt,
      endedAt,
      durationMs: endedAt.getTime() - startedAt.getTime(),
      pageCount: group.length,
      entryPath: first.path,
      exitPath: last.path,
      views: group,
    }
  })
}

/** Local-time YYYY-MM-DD. Days are what a human means by "was he here". */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function shiftDay(key: string, deltaDays: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number]
  return dayKey(new Date(y, m - 1, d + deltaDays))
}

/** Consecutive active days ending today or yesterday. Yesterday still counts
 * so the number does not read as broken every morning before he logs in. */
export function countStreak(days: string[], todayKey: string): number {
  if (days.length === 0) return 0
  const active = new Set(days)
  let cursor = todayKey
  if (!active.has(cursor)) {
    cursor = shiftDay(todayKey, -1)
    if (!active.has(cursor)) return 0
  }
  let streak = 0
  while (active.has(cursor)) {
    streak++
    cursor = shiftDay(cursor, -1)
  }
  return streak
}
