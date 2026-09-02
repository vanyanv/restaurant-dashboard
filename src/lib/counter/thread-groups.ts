/**
 * How a list of Ask threads is dated and divided.
 *
 * ## The rail was printing the same six words sixteen times
 *
 * Measured on the live account, every row of the desk rail read
 * `Aug 28 · 1 turn`, and the adapter's own note says why the second half of
 * that is dead ink: `answerCount` is 1 for **40 of 47 threads**, so "· 1 turn"
 * appears on almost every row and distinguishes none of them. The first half
 * was not much better — six consecutive rows repeating `Sep 1` under six
 * titles that all begin "weekly sales" is a date printed as decoration.
 *
 * The phone was worse. `MList`'s `detail` was `"1 turn"` and nothing else, so
 * a reader scrolling "What you have asked" got six identical captions and no
 * date at all.
 *
 * So: the date moves OUT of the row and becomes the heading of a run of rows,
 * and the turn count is printed only when it says something — when a thread
 * was actually returned to.
 *
 * ## Why the labels are relative near the top and absolute below it
 *
 * A thread asked this morning is looked for as "today", not as "Sep 2"; a
 * thread from three weeks ago is looked for by its date, because nobody counts
 * back twenty-one days. The switch happens at a week, where the weekday name
 * stops being unambiguous.
 *
 * ## `today` is passed in, never read from the clock
 *
 * Both Ask surfaces resolve one `today` on the server and hand it to the
 * island (see `counterToday`). A `new Date()` in here would be the client's
 * clock deciding whether a row says "Today" while the server's decided it says
 * "Sep 1" — a hydration mismatch on the one word the reader is scanning for.
 */

/** The shape both surfaces' rows share — the adapter's `AskConversation`. */
export interface DatedThread {
  updatedAt: string | Date
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

const DAY_MS = 86_400_000

/**
 * "Today" · "Yesterday" · "Saturday" · "Aug 28" · "Aug 28, 2025".
 *
 * A weekday name is used for days 2–6 back, where it is unambiguous. At seven
 * days it would start naming two different Saturdays, so the date takes over.
 */
export function threadDayLabel(when: string | Date, today: Date): string {
  const d = new Date(when)
  const days = Math.round((startOfDay(today) - startOfDay(d)) / DAY_MS)

  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" })
  if (d.getFullYear() === today.getFullYear()) {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/**
 * `2 turns`, or nothing at all for the single-exchange thread that 40 of 47 of
 * them are. An empty string rather than `"1 turn"`, so the caller can drop the
 * element instead of drawing a caption that is true of almost every row.
 */
export function threadTurnLabel(turns: number): string {
  return turns > 1 ? `${turns} turns` : ""
}

/**
 * Runs of threads under one day heading, in the order they arrived.
 *
 * The list is already `updatedAt` DESC out of `listConversations`, so a
 * sequential pass is enough and no sort is imposed on top of one — re-sorting
 * here would silently disagree with the rail's own order if that query ever
 * changed.
 */
export function groupThreadsByDay<T extends DatedThread>(
  items: T[],
  today: Date,
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = []
  for (const item of items) {
    const label = threadDayLabel(item.updatedAt, today)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}
