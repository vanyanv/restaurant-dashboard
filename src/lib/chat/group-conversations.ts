/**
 * Buckets the conversation rail into Today / Yesterday / Earlier, the way the
 * design's perforated groups read.
 *
 * Boundaries are the reader's own local midnight rather than UTC. This store
 * trades past midnight and the owner closes books late, so a UTC boundary
 * would file this evening's thread under yesterday for most of the night.
 */

export interface ConversationLike {
  id: string
  updatedAt: string
}

export interface ConversationGroup<T extends ConversationLike> {
  label: "Today" | "Yesterday" | "Earlier"
  items: T[]
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function groupConversations<T extends ConversationLike>(
  rows: readonly T[],
  now: Date = new Date(),
): ConversationGroup<T>[] {
  const todayStart = startOfLocalDay(now)
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000

  const today: T[] = []
  const yesterday: T[] = []
  const earlier: T[] = []

  for (const row of rows) {
    const t = new Date(row.updatedAt).getTime()
    // An unparseable date sorts to Earlier rather than throwing the rail away.
    if (Number.isNaN(t)) earlier.push(row)
    else if (t >= todayStart) today.push(row)
    else if (t >= yesterdayStart) yesterday.push(row)
    else earlier.push(row)
  }

  const out: ConversationGroup<T>[] = []
  if (today.length) out.push({ label: "Today", items: today })
  if (yesterday.length) out.push({ label: "Yesterday", items: yesterday })
  if (earlier.length) out.push({ label: "Earlier", items: earlier })
  return out
}
