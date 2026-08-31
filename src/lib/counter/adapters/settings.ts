import { prisma } from "@/lib/prisma"
import { count } from "@/lib/counter/format"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { KvRow, Row } from "@/components/counter"

/**
 * Settings — `P.settings` (`docs/counter/counter-prototype.html`).
 *
 * One page, as the prototype has it. The editorial build spread the same six
 * panels over four routes.
 *
 * ## The owner's clock is on the wrong coast
 *
 * `chris@chrisneddys.com` has `timezone = "America/New_York"` — the schema
 * default, never changed — and every store is in Los Angeles. Anything that
 * buckets a date by the signed-in user's timezone puts the owner three hours
 * ahead of his own restaurant. All three stores are also owned by
 * `demo@restaurantos.com`, the developer account, not by the owner.
 *
 * ## Three toggles, not four
 *
 * `AlertPreference` — the table built for this — holds **0 rows**. What
 * exists is three booleans on `User`: `notifyInvoices`, `notifyWeeklyReport`
 * and `notifyAnomaly`, which `updateNotificationPrefs` writes. The
 * prototype's fourth, a daily digest, has nothing behind it and is not drawn.
 *
 * ## The sessions panel cannot exist
 *
 * Auth is JWT and there is no Session table — `LoginEvent`'s docblock says so.
 * Presence would be a SIGN_IN with no later SIGN_OUT, and in thirty days
 * there are **727 sign-ins and zero sign-outs**, so every session ever
 * recorded still reads as live. "End this device" would have nothing to end.
 * The panel is replaced by what the data can answer: where sign-ins came
 * from.
 *
 * ## Nothing issues an invite
 *
 * The prototype's own source says it: *"There is an invite record, a signup
 * page and a route that redeems a token — and nowhere that issues one."*
 * `Invite` holds 4 rows and `prisma.invite.create` appears nowhere outside
 * the generated client. And there is no MANAGER to invite — `Role` holds
 * `OWNER` and `DEVELOPER`, and every gate accepts both.
 *
 * See `docs/counter/measurements/2026-08-29-settings.md`.
 */

/** The window the sign-in table reports over. */
const SIGNIN_DAYS = 30

export interface SettingsInput {
  userId: string
  accountId: string
}

interface Person {
  email: string
  name: string
  role: string
  timezone: string
  ownedStores: string[]
  isYou: boolean
}

interface SigninRow {
  agent: string
  signins: number
  addresses: number
  last: Date
}

interface SettingsData {
  you: Person | null
  people: Person[]
  storeNames: string[]
  storeTimezoneHint: string
  notify: { invoices: boolean; weekly: boolean; anomaly: boolean }
  alertPreferences: number
  signins: SigninRow[]
  signouts: number
  invites: { total: number; live: number; used: number; revoked: number }
  roles: string[]
}

/* ── Load ─────────────────────────────────────────────────────────────── */

/** A user agent string is not a device name; this is the readable half of it. */
function agentName(raw: string | null): string {
  if (!raw) return "Unrecorded"
  if (/curl|python|node-fetch|axios/i.test(raw)) return "A script"
  if (/iPhone|iPad/i.test(raw)) return "iPhone or iPad"
  if (/Android/i.test(raw)) return "Android"
  if (/Macintosh/i.test(raw)) return "Mac"
  if (/Windows/i.test(raw)) return "Windows"
  if (/X11|Linux/i.test(raw)) return "Linux"
  return "Something else"
}

async function loadSettings(input: SettingsInput): Promise<SettingsData> {
  const since = new Date(Date.now() - SIGNIN_DAYS * 86_400_000)

  const [users, stores, alertPreferences, logins, signouts, invites, roles] =
    await Promise.all([
      prisma.user.findMany({
        where: { accountId: input.accountId },
        orderBy: { role: "asc" },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          timezone: true,
          notifyInvoices: true,
          notifyWeeklyReport: true,
          notifyAnomaly: true,
          ownedStores: { select: { name: true } },
        },
      }),
      prisma.store.findMany({
        where: { accountId: input.accountId },
        orderBy: { name: "asc" },
        select: { name: true, isActive: true },
      }),
      prisma.alertPreference.count({ where: { accountId: input.accountId } }),
      prisma.loginEvent.findMany({
        where: { kind: "SIGN_IN", createdAt: { gt: since } },
        select: { userAgent: true, ipAddress: true, createdAt: true },
      }),
      prisma.loginEvent.count({ where: { kind: "SIGN_OUT", createdAt: { gt: since } } }),
      prisma.invite.findMany({
        where: { accountId: input.accountId },
        select: { expiresAt: true, usedAt: true, revokedAt: true },
      }),
      prisma.$queryRaw<Array<{ role: string }>>`
        SELECT e.enumlabel role FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'Role' ORDER BY e.enumsortorder`,
    ])

  const people: Person[] = users.map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    timezone: u.timezone,
    ownedStores: u.ownedStores.map((s) => s.name),
    isYou: u.id === input.userId,
  }))

  const you = users.find((u) => u.id === input.userId) ?? null

  const byAgent = new Map<string, { signins: number; ips: Set<string>; last: Date }>()
  for (const l of logins) {
    const key = agentName(l.userAgent)
    const entry = byAgent.get(key) ?? { signins: 0, ips: new Set<string>(), last: l.createdAt }
    entry.signins++
    if (l.ipAddress) entry.ips.add(l.ipAddress)
    if (l.createdAt > entry.last) entry.last = l.createdAt
    byAgent.set(key, entry)
  }

  const now = Date.now()

  return {
    you: people.find((p) => p.isYou) ?? null,
    people,
    storeNames: stores.filter((s) => s.isActive).map((s) => s.name),
    storeTimezoneHint: "America/Los_Angeles",
    notify: {
      invoices: you?.notifyInvoices ?? false,
      weekly: you?.notifyWeeklyReport ?? false,
      anomaly: you?.notifyAnomaly ?? false,
    },
    alertPreferences,
    signins: [...byAgent.entries()]
      .map(([agent, v]) => ({
        agent,
        signins: v.signins,
        addresses: v.ips.size,
        last: v.last,
      }))
      .sort((a, b) => b.signins - a.signins),
    signouts,
    invites: {
      total: invites.length,
      live: invites.filter(
        (i) => i.usedAt === null && i.revokedAt === null && i.expiresAt.getTime() > now,
      ).length,
      used: invites.filter((i) => i.usedAt !== null).length,
      revoked: invites.filter((i) => i.revokedAt !== null).length,
    },
    roles: roles.map((r) => r.role),
  }
}

/* ── Shaping ──────────────────────────────────────────────────────────── */

function ago(at: Date): string {
  const hours = Math.round((Date.now() - at.getTime()) / 3_600_000)
  if (hours < 1) return "just now"
  if (hours < 48) return `${count(hours)}h ago`
  return `${count(Math.round(hours / 24))} days ago`
}

export interface SettingsAccount {
  rows: KvRow[]
  /** Set when the signed-in user's clock disagrees with where the stores are. */
  clockWarning: string | null
  /** What the timezone control needs to save: the current values it edits. */
  editable: { name: string; timezone: string } | null
  /** The timezones a store in this account actually sits in, offered first. */
  timezoneChoices: string[]
  meta: string
}

function accountOf(d: SettingsData): SettingsAccount {
  const you = d.you
  const wrongClock =
    you !== null && you.timezone !== d.storeTimezoneHint ? you.timezone : null

  return {
    rows: [
      { label: "Signed in as", value: you?.name ?? "—" },
      { label: "Email", value: you?.email ?? "—" },
      { label: "Role", value: you?.role ?? "—" },
      {
        label: "Your timezone",
        value: you?.timezone ?? "—",
        tone: wrongClock ? "bad" : undefined,
      },
      {
        label: "Stores you can see",
        value: `${count(d.storeNames.length)} of ${count(d.storeNames.length)} · ${d.storeNames.join(", ")}`,
      },
      {
        label: "Stores you own",
        value:
          you && you.ownedStores.length > 0
            ? you.ownedStores.join(", ")
            : "none — all three are owned by the developer account",
        tone: you && you.ownedStores.length === 0 ? "warn" : undefined,
      },
    ],
    editable: you === null ? null : { name: you.name, timezone: you.timezone },
    timezoneChoices: [
      d.storeTimezoneHint,
      "America/Denver",
      "America/Chicago",
      "America/New_York",
    ],
    clockWarning: wrongClock
      ? `Your clock is set to ${wrongClock} and every store is in ` +
        `${d.storeTimezoneHint}. That is the schema default rather than a choice, and ` +
        `anything that buckets a date by your timezone puts you three hours ahead of your ` +
        `own restaurant.`
      : null,
    meta: "this account",
  }
}

export interface SettingsNotifications {
  invoices: boolean
  weekly: boolean
  anomaly: boolean
  note: string
  meta: string
}

function notificationsOf(d: SettingsData): SettingsNotifications {
  return {
    invoices: d.notify.invoices,
    weekly: d.notify.weekly,
    anomaly: d.notify.anomaly,
    meta: "three that write",
    note:
      `The prototype offers a fourth — a daily digest at 7am — and nothing stores it. ` +
      `AlertPreference, the table built for per-store notification routing, holds ` +
      `${count(d.alertPreferences)} rows; what these three write is three booleans on your ` +
      `own user record. A toggle that saves nowhere is worse than one that is absent, so ` +
      `the digest is not drawn.`,
  }
}

export interface SettingsSignins {
  rows: Row[]
  meta: string
  note: string
}

function signinsOf(d: SettingsData): SettingsSignins {
  const total = d.signins.reduce((s, r) => s + r.signins, 0)

  return {
    rows: d.signins.map((r) => ({
      key: r.agent,
      cells: {
        agent: r.agent,
        signins: count(r.signins),
        addresses: count(r.addresses),
        last: ago(r.last),
      },
    })),
    meta: `${count(total)} sign-ins in ${count(SIGNIN_DAYS)} days`,
    note:
      `The prototype lists devices with an "End" button and a "Sign out everywhere". ` +
      `Auth here is JWT and there is no session table to enumerate, so a device list would ` +
      `be derived from a sign-in with no later sign-out — and there have been ` +
      `${count(total)} sign-ins and ${count(d.signouts)} sign-outs in ` +
      `${count(SIGNIN_DAYS)} days. Every session ever recorded still reads as live, so ` +
      `there is nothing to end. What the data does answer is where sign-ins came from, ` +
      `which is this.`,
  }
}

export interface SettingsTeam {
  rows: Row[]
  meta: string
  note: string
}

function teamOf(d: SettingsData): SettingsTeam {
  return {
    rows: d.people.map((p) => ({
      key: p.email,
      cells: {
        person: p.name,
        email: p.email,
        role: p.role,
        // Shown for everyone, not just the signed-in user: the owner's clock
        // is the one that is wrong, and it would otherwise be invisible to
        // the developer account that does the looking.
        timezone:
          p.timezone === d.storeTimezoneHint
            ? p.timezone
            : { v: p.timezone, cls: "hot" },
        stores:
          p.ownedStores.length === 0
            ? { v: "none", cls: "hot" }
            : count(p.ownedStores.length),
        you: p.isYou ? "you" : "—",
      },
    })),
    meta: `${count(d.people.length)} accounts · ${count(d.invites.total)} invites on record`,
    note:
      (() => {
        const wrong = d.people.filter((p) => p.timezone !== d.storeTimezoneHint)
        return wrong.length === 0
          ? ""
          : `${wrong.map((p) => p.name).join(" and ")} ${wrong.length === 1 ? "is" : "are"} ` +
            `set to ${wrong.map((p) => p.timezone).join(" and ")} while every store is in ` +
            `${d.storeTimezoneHint} — the schema default rather than a choice. `
      })() +
      `The prototype's team panel shows a Manager who sees one store and cannot open ` +
      `Settings or Monitoring. The Role enum in this database has ` +
      `${count(d.roles.length)} values — ${d.roles.join(" and ")} — so there is no manager ` +
      `to invite and no gate that can fail. There are ${count(d.invites.total)} invite rows ` +
      `(${count(d.invites.live)} live, ${count(d.invites.used)} used, ` +
      `${count(d.invites.revoked)} revoked) and nothing anywhere that creates one: an ` +
      `invite record, a signup page and a route that redeems a token, with no issuer. So ` +
      `there is no "Invite someone" button here.`,
  }
}

export interface SettingsPreferences {
  rows: KvRow[]
  meta: string
  note: string
}

function preferencesOf(d: SettingsData): SettingsPreferences {
  return {
    rows: [
      { label: "Timezone", value: d.you?.timezone ?? "—" },
      { label: "Week starts", value: "not stored" },
      { label: "Currency", value: "not stored · USD throughout" },
      { label: "Density", value: "not stored" },
      { label: "Theme", value: "follows your system — light and dark both ship" },
    ],
    meta: "one of these is real",
    note:
      `Timezone is the only preference this product stores. The prototype lists four more ` +
      `and says of the last "Light — the only one", which stopped being true when Counter ` +
      `shipped a dark theme; the page follows whatever your system asks for. The other ` +
      `three are listed as unstored rather than dropped, because a settings page that ` +
      `silently omits them reads as though they were never asked for.`,
  }
}

/**
 * `P.settings`' "Brand" panel — the wordmark and the two identity colours.
 *
 * The prototype's copy claims the accent and signal are "taken from the
 * wordmark, so the interface and the sign over the door agree". NOTHING in
 * this project records that: `counter.css` documents what `--ct-accent` MEANS
 * (the proofmark — it marks state, not rest) and how its dark value was
 * solved, and says nowhere that it was sampled from a logo. So this says what
 * the two colours are FOR, which is checkable, rather than repeating a
 * provenance nobody wrote down.
 */
export interface SettingsBrand {
  swatches: Array<{ key: string; label: string; token: string; what: string }>
  note: string
}

export interface SettingsSections {
  brand: SectionData<SettingsBrand>
  account: SectionData<SettingsAccount>
  notifications: SectionData<SettingsNotifications>
  signins: SectionData<SettingsSignins>
  preferences: SectionData<SettingsPreferences>
  team: SectionData<SettingsTeam>
}

/** Static: it describes the design system, not this account. */
function brandOf(): SettingsBrand {
  return {
    swatches: [
      {
        key: "accent",
        label: "Accent",
        token: "accent",
        what: "the proofmark — a hover, a selection, a flagged value",
      },
      {
        key: "signal",
        label: "Signal",
        token: "signal",
        what: "attention that is not an error",
      },
    ],
    note:
      "Both are `ct-` tokens in src/styles/counter.css and appear on the login " +
      "screen and in the rail. The accent marks state rather than rest: if it is " +
      "sitting on more than one element at rest on a screen, something is wrong.",
  }
}

export function getSettingsSectionPromises(
  input: SettingsInput,
): StreamedSections<SettingsSections> {
  const dataP = classify(() => loadSettings(input), {
    retryAction: "retrySettings",
    isEmpty: (d) => d.people.length === 0,
    emptyReason: "no_match",
  })
  const s = <T,>(f: (d: SettingsData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retrySettings")
  return {
    brand: s(brandOf),
    account: s(accountOf),
    notifications: s(notificationsOf),
    signins: s(signinsOf),
    preferences: s(preferencesOf),
    team: s(teamOf),
  }
}

export async function getSettingsSections(
  input: SettingsInput,
): Promise<SettingsSections> {
  return awaitSections(getSettingsSectionPromises(input))
}
