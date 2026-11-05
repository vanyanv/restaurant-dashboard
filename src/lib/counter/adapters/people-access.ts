import { prisma } from "@/lib/prisma"
import { emailConfigured } from "@/lib/checks/email"
import { daysLeft, inviteState, type PersonRole } from "@/lib/people/invites"
import { classify, guardSection, type StreamedSections } from "@/lib/counter/adapters/types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * Admin > People (developer only): everyone who can sign in to this account,
 * and every invite that has not turned into an account yet.
 *
 * One section, because the sentence at the top, the three counts and the list
 * are one answer to "who has access, and who is waiting on a link". Every
 * query is filtered by `accountId`; the page reads it from the session.
 *
 * A person is one of four states, and the page says them in words:
 *   in       signed up and not removed
 *   waiting  invited, link still works
 *   ran_out  invited, link expired before they used it
 *   removed  access removed (kept so their invoices and recipes keep a name)
 *
 * An invite whose email already belongs to a live person is not listed: the
 * person row says everything it would. A cancelled invite is not listed
 * either; cancelling is how a developer says "forget this one".
 */

export type PersonState = "in" | "waiting" | "ran_out" | "removed"

export type PersonRow = {
  /** `u_<userId>` or `i_<inviteId>`: rows from two tables share one list. */
  key: string
  kind: "user" | "invite"
  id: string
  name: string
  email: string
  role: PersonRole
  state: PersonState
  /** "Signed in 3 days ago", "Invited Nov 2 · 5 days left", "Removed Nov 4". */
  when: string
  /** ISO, for sorting on the client. */
  at: string
  you: boolean
}

export type PeopleAccessData = {
  rows: PersonRow[]
  counts: { in: number; waiting: number; ran_out: number; removed: number }
  activeDevelopers: number
  emailReady: boolean
}

export type PeopleAccessSections = { people: SectionData<PeopleAccessData> }

function ago(d: Date, now: Date): string {
  const min = Math.round((now.getTime() - d.getTime()) / 60_000)
  if (min < 2) return "just now"
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const days = Math.round(min / 1440)
  if (days === 1) return "yesterday"
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `on ${short(d)}`
}

function short(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })
}

export async function loadPeopleAccess(opts: { accountId: string; userId: string; now?: Date }): Promise<PeopleAccessData> {
  const now = opts.now ?? new Date()
  const [users, invites] = await Promise.all([
    prisma.user.findMany({
      where: { accountId: opts.accountId },
      select: { id: true, name: true, email: true, role: true, createdAt: true, removedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.invite.findMany({
      where: { accountId: opts.accountId, usedAt: null, revokedAt: null },
      select: { id: true, email: true, name: true, role: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const lastSignIns = users.length
    ? await prisma.loginEvent.groupBy({
        by: ["userId"],
        where: { userId: { in: users.map((u) => u.id) }, kind: "SIGN_IN" },
        _max: { createdAt: true },
      })
    : []
  const lastIn = new Map(lastSignIns.map((r) => [r.userId, r._max.createdAt]))

  const rows: PersonRow[] = []
  const liveEmails = new Set<string>()

  for (const u of users) {
    const removed = u.removedAt !== null
    if (!removed) liveEmails.add(u.email.toLowerCase())
    const last = lastIn.get(u.id) ?? null
    rows.push({
      key: `u_${u.id}`,
      kind: "user",
      id: u.id,
      name: u.name || u.email,
      email: u.email,
      role: u.role,
      state: removed ? "removed" : "in",
      when: removed
        ? `Removed ${short(u.removedAt as Date)}`
        : last
          ? `Signed in ${ago(last, now)}`
          : `Joined ${short(u.createdAt)} · not signed in since`,
      at: (removed ? (u.removedAt as Date) : (last ?? u.createdAt)).toISOString(),
      you: u.id === opts.userId,
    })
  }

  // Newest invite per email wins; older ones for the same person are noise.
  const seen = new Set<string>()
  for (const i of invites) {
    if (!i.email) continue
    const email = i.email.toLowerCase()
    if (seen.has(email) || liveEmails.has(email)) continue
    seen.add(email)
    const st = inviteState(i, now)
    if (st !== "waiting" && st !== "ran_out") continue
    rows.push({
      key: `i_${i.id}`,
      kind: "invite",
      id: i.id,
      name: i.name || i.email,
      email: i.email,
      role: i.role,
      state: st,
      when:
        st === "waiting"
          ? `Invited ${ago(i.createdAt, now)} · ${daysLeft(i.expiresAt, now)} ${daysLeft(i.expiresAt, now) === 1 ? "day" : "days"} left`
          : `Link ran out ${short(i.expiresAt)}`,
      at: i.createdAt.toISOString(),
      you: false,
    })
  }

  const order: Record<PersonState, number> = { ran_out: 0, waiting: 1, in: 2, removed: 3 }
  rows.sort((a, b) => order[a.state] - order[b.state] || (a.you === b.you ? 0 : a.you ? -1 : 1) || a.name.localeCompare(b.name))

  const counts = { in: 0, waiting: 0, ran_out: 0, removed: 0 }
  for (const r of rows) counts[r.state]++

  return {
    rows,
    counts,
    activeDevelopers: users.filter((u) => u.role === "DEVELOPER" && u.removedAt === null).length,
    emailReady: emailConfigured(),
  }
}

export function getPeopleAccessSectionPromises(opts: { accountId: string; userId: string }): StreamedSections<PeopleAccessSections> {
  return {
    people: guardSection(classify(() => loadPeopleAccess(opts), { retryAction: "people" }), "people"),
  }
}
