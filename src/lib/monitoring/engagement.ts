/**
 * Engagement derivation over the raw PageView stream.
 *
 * Sessions are computed here rather than stored: a pure function over a few
 * thousand ordered rows is cheap, and storing them would create a second
 * source of truth that drifts from the views it summarizes.
 */

import { prisma } from "@/lib/prisma"

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

export type EngagementSummaryRow = {
  userId: string
  name: string
  email: string
  lastSeenAt: Date | null
  lastPath: string | null
  sessionCount: number
  sessionsToday: number
  totalMs: number
  activeDays: number
  currentStreak: number
}

export type ActiveDay = { date: string; views: number }

export type TopRoute = { route: string; visits: number; medianDwellMs: number | null }

export type EngagementData = {
  summary: EngagementSummaryRow[]
  sessionsByUser: Record<string, Session[]>
  activeDays: ActiveDay[]
  topRoutes: TopRoute[]
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!
}

/** One windowed read; everything below is derived in memory. At a few hundred
 * views a day this window is a few thousand rows. */
export async function getEngagementData(days = 30): Promise<EngagementData> {
  const cutoff = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.pageView.findMany({
    where: { enteredAt: { gte: cutoff } },
    orderBy: { enteredAt: "asc" },
    select: {
      userId: true,
      path: true,
      route: true,
      enteredAt: true,
      dwellMs: true,
    },
  })

  if (rows.length === 0) {
    return { summary: [], sessionsByUser: {}, activeDays: [], topRoutes: [] }
  }

  const byUser = new Map<string, ViewRow[]>()
  const dayCounts = new Map<string, number>()
  const routeDwells = new Map<string, number[]>()
  const routeVisits = new Map<string, number>()

  for (const r of rows) {
    const list = byUser.get(r.userId)
    if (list) list.push(r)
    else byUser.set(r.userId, [r])

    const key = dayKey(r.enteredAt)
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1)

    routeVisits.set(r.route, (routeVisits.get(r.route) ?? 0) + 1)
    if (r.dwellMs != null) {
      const dwells = routeDwells.get(r.route)
      if (dwells) dwells.push(r.dwellMs)
      else routeDwells.set(r.route, [r.dwellMs])
    }
  }

  const users = await prisma.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, name: true, email: true },
  })
  const userById = new Map(users.map((u) => [u.id, u]))

  const today = dayKey(new Date())
  const sessionsByUser: Record<string, Session[]> = {}
  const summary: EngagementSummaryRow[] = []

  for (const [userId, views] of byUser) {
    const sessions = groupIntoSessions(views)
    sessionsByUser[userId] = [...sessions].reverse() // newest first for display
    const activeDayKeys = [...new Set(views.map((v) => dayKey(v.enteredAt)))]
    const last = views[views.length - 1]
    const u = userById.get(userId)
    summary.push({
      userId,
      name: u?.name ?? "Unknown user",
      email: u?.email ?? userId,
      lastSeenAt: last?.enteredAt ?? null,
      lastPath: last?.path ?? null,
      sessionCount: sessions.length,
      // sessionsToday shares one definition with getEngagementHeadline below:
      // a session counts toward today iff its startedAt falls today.
      sessionsToday: sessions.filter((s) => dayKey(s.startedAt) === today).length,
      totalMs: sessions.reduce((sum, s) => sum + s.durationMs, 0),
      activeDays: activeDayKeys.length,
      currentStreak: countStreak(activeDayKeys, today),
    })
  }

  summary.sort(
    (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0),
  )

  const activeDays: ActiveDay[] = [...dayCounts.entries()]
    .map(([date, views]) => ({ date, views }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const topRoutes: TopRoute[] = [...routeVisits.entries()]
    .map(([route, visits]) => ({
      route,
      visits,
      medianDwellMs: median(routeDwells.get(route) ?? []),
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 15)

  return { summary, sessionsByUser, activeDays, topRoutes }
}

/** Cheap read for the Bridge tile — the index page must not pay for a
 * 30-day scan just to say "last seen 14m ago". */
export async function getEngagementHeadline(): Promise<{
  name: string
  lastSeenAt: Date
  lastPath: string
  sessionsToday: number
} | null> {
  const latest = await prisma.pageView.findFirst({
    orderBy: { enteredAt: "desc" },
    select: { userId: true, path: true, enteredAt: true },
  })
  if (!latest) return null

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  // Look back one session gap before midnight: any session straddling midnight
  // must have a view in that window, because a longer quiet period would have
  // split it into two sessions anyway. Without this, a session that began
  // yesterday would be regrouped as if it started today, and the Bridge tile
  // would disagree with the People page about the same session.
  const groupFrom = new Date(startOfToday.getTime() - SESSION_GAP_MS)

  const [user, recentViews] = await Promise.all([
    prisma.user.findUnique({
      where: { id: latest.userId },
      select: { name: true },
    }),
    prisma.pageView.findMany({
      where: { userId: latest.userId, enteredAt: { gte: groupFrom } },
      orderBy: { enteredAt: "asc" },
      select: { path: true, route: true, enteredAt: true, dwellMs: true },
    }),
  ])

  // sessionsToday shares one definition with getEngagementData above: a
  // session counts toward today iff its startedAt falls today.
  const todayKey = dayKey(new Date())
  const sessionsToday = groupIntoSessions(recentViews).filter(
    (s) => dayKey(s.startedAt) === todayKey,
  ).length

  return {
    name: user?.name ?? "Unknown user",
    lastSeenAt: latest.enteredAt,
    lastPath: latest.path,
    sessionsToday,
  }
}
