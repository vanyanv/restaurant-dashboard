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
  /**
   * The zone every store on this account sits in.
   *
   * A LITERAL, because nothing in this schema publishes a store's IANA zone —
   * `User.timezone` is a person's. All three stores are in Los Angeles, so
   * today this is true; the day one opens elsewhere it becomes a guess, and
   * the column it is standing in for is the fix rather than a longer list here.
   */
  storeTimezoneHint: string
  /** When the clock gap is measured — see `clockGap`, which is date-dependent. */
  now: Date
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
    now: new Date(now),
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

/**
 * One `.setrow`: what it is on the left with a line under it, and what it
 * currently reads on the right.
 *
 * NOT `KvRow`. `P.settings`' Account panel is setrows and this page rendered a
 * `.kv` above them — two idioms in one panel, and a `.kv` the design does not
 * have anywhere in Account. A setrow also carries the DETAIL line a `.kv`
 * cannot ("Last changed 4 months ago" under "Password"), which is most of what
 * the prototype's rows say.
 */
export interface SettingRow {
  label: string
  detail: string
  value: string
  tone?: "good" | "warn" | "bad"
}

export interface SettingsAccount {
  rows: SettingRow[]
  /** Set when the signed-in user's clock disagrees with where the stores are. */
  clockWarning: string | null
  /** What the timezone control needs to save: the current values it edits. */
  editable: { name: string; timezone: string } | null
  /** The timezones a store in this account actually sits in, offered first. */
  timezoneChoices: string[]
  meta: string
}

/**
 * How far the reader's clock sits from their restaurant's — MEASURED, not
 * written down.
 *
 * The warning below used to end "puts you three hours ahead of your own
 * restaurant". That is true for `America/New_York`, which is the zone this
 * account is actually on, and false for two of the other three zones the
 * control right beside it offers: Denver is one hour from Los Angeles and
 * Chicago is two. So the page invited a reader to pick a zone and then told
 * them a specific wrong number about it.
 *
 * Null when the two zones keep the SAME offset — `America/Phoenix` and
 * `America/Los_Angeles` are different zones that agree all summer, and
 * "0 hours ahead" is not a sentence. The caller drops the clause.
 *
 * Measured at `at` rather than in the abstract, because the gap is a function
 * of the date: New York and Los Angeles are three hours apart all year, but
 * a zone that does not observe DST drifts against one that does.
 */
function clockGap(userZone: string, storeZone: string, at: Date): string | null {
  const offset = (zone: string): number | null => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).formatToParts(at)
      const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
      // `hour` comes back as "24" at midnight in some ICU builds.
      const hour = Number(p.hour) % 24
      const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute))
      // Floor to the minute on BOTH sides rather than `at.setSeconds(0, 0)`,
      // which would mutate the caller's date.
      return (asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 3_600_000
    } catch {
      // An unparseable zone is a fact we do not have, not a reason to guess.
      return null
    }
  }

  const mine = offset(userZone)
  const theirs = offset(storeZone)
  if (mine === null || theirs === null) return null

  const diff = mine - theirs
  if (diff === 0) return null

  const n = Math.abs(diff)
  const word = Number.isInteger(n) ? (HOUR_WORDS[n] ?? `${n}`) : n.toFixed(1)
  const unit = n === 1 ? "hour" : "hours"
  return `${word} ${unit} ${diff > 0 ? "ahead of" : "behind"}`
}

/** The prose voice this page already used — "three hours", not "3 hours". */
const HOUR_WORDS: Record<number, string> = {
  1: "an",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
}

/**
 * The clock sentence, with the gap stated only when it can be measured.
 *
 * The offset clause is dropped rather than guessed when the two zones agree
 * or one of them will not parse — a warning that names the wrong number is
 * worse than one that names none, and the first half ("your clock is X, every
 * store is Y") is the actionable part either way.
 */
function clockWarningFor(userZone: string, storeZone: string, at: Date): string {
  const gap = clockGap(userZone, storeZone, at)
  return (
    `Your clock is set to ${userZone} and every store is in ${storeZone}. ` +
    `That is the schema default rather than a choice` +
    (gap === null
      ? ", and the two zones keep the same offset today — but a date bucketed by " +
        "your timezone is still being bucketed by the wrong one."
      : `, and anything that buckets a date by your timezone puts you ${gap} your own restaurant.`)
  )
}

function accountOf(d: SettingsData): SettingsAccount {
  const you = d.you
  const wrongClock =
    you !== null && you.timezone !== d.storeTimezoneHint ? you.timezone : null

  return {
    // `P.settings`' three Account rows, with ours saying what this account
    // actually holds. The timezone and the password are setrows too, rendered
    // by `AccountControls` because they carry a control rather than a reading.
    rows: [
      {
        label: you?.name ?? "—",
        detail: you?.email ?? "no email on file",
        value: you?.role ?? "—",
      },
      {
        label: "Stores you can see",
        detail: d.storeNames.join(", "),
        value: `${count(d.storeNames.length)} of ${count(d.storeNames.length)}`,
      },
      {
        label: "Stores you own",
        detail:
          you && you.ownedStores.length > 0
            ? "the ones your account is named on"
            : "every store is owned by the developer account",
        value: you && you.ownedStores.length > 0 ? you.ownedStores.join(", ") : "none",
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
    clockWarning: wrongClock ? clockWarningFor(wrongClock, d.storeTimezoneHint, d.now) : null,
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
    /*
     * WHAT THE OWNER NEEDS, not why the build went this way.
     *
     * This said: "The prototype offers a fourth — a daily digest at 7am — and
     * nothing stores it. AlertPreference, the table built for per-store
     * notification routing, holds 0 rows; what these three write is three
     * booleans on your own user record. A toggle that saves nowhere is worse
     * than one that is absent, so the digest is not drawn."
     *
     * Every clause of that is addressed to whoever built it. The reader has
     * never seen the prototype, does not know what AlertPreference is, and is
     * being handed a table name, a row count and a design principle — five
     * lines of it, in mono, on a phone, under the standing rule that the
     * mobile surface is a lean glance-and-do tool.
     *
     * Two facts survive that a reader can use: the scope of the three switches
     * above, and that there is no digest. The rationale stays here, where the
     * next person to wonder about the missing fourth toggle will look.
     */
    note:
      `These three apply to the whole account rather than to one store. ` +
      `There is no daily digest yet.`,
  }
}

/**
 * `P.settings`' "Sessions" panel, as far as this auth design can go.
 *
 * SETROWS, not a table, because the design's panel is a list of devices and
 * this is a list of the same thing seen from the log. It was a `.tbl` — an
 * extra the structure pass never forgives, against a `.sec__body` the design
 * does have — and four columns of counts where three facts fit on a line.
 *
 * What it cannot have is the two buttons: auth is JWT with no session table,
 * so nothing can be enumerated to end, and `note` says so with the numbers.
 */
export interface SettingsSignins {
  rows: SettingRow[]
  meta: string
  note: string
}

function signinsOf(d: SettingsData): SettingsSignins {
  const total = d.signins.reduce((s, r) => s + r.signins, 0)

  return {
    rows: d.signins.map((r) => ({
      label: r.agent,
      detail:
        `${count(r.signins)} sign-in${r.signins === 1 ? "" : "s"} from ` +
        `${count(r.addresses)} address${r.addresses === 1 ? "" : "es"}`,
      value: ago(r.last),
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
