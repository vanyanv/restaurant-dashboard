"use server"

import bcrypt from "bcryptjs"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/auth-scope"
import { chargeAttemptKey, clearAttemptKey } from "@/lib/rate-limit"
import {
  CONNECTIONS,
  KEY_NAME_PATTERN,
  findKey,
  githubOnlyKeyNames,
  isNeverShownKey,
  isPlatformKey,
} from "@/lib/counter/connections"
import { buildEnvFile, type EnvFileGroup, type EnvFileKey } from "@/lib/developer/env-file"
import { canUseKeys } from "@/lib/developer/platform-access"
import {
  UNLOCK_COOKIE,
  UNLOCK_TTL_MS,
  issueUnlockToken,
  sessionFingerprint,
  unlockTokenIsValid,
} from "@/lib/developer/unlock-token"
import { listVercelEnv } from "@/lib/developer/vercel-env"

/**
 * Reading the live site's keys. The only code in the app that hands a secret
 * value to a browser, so every step is refused unless it can be shown to be
 * allowed.
 *
 * ## Who gets through
 *
 * 1. A signed-in DEVELOPER of the one account `DEVELOPER_PORTAL_ACCOUNT_ID`
 *    names (`canUseKeys` in `src/lib/developer/platform-access.ts`).
 *    DEVELOPER is a role inside an account and these keys are the whole
 *    platform's, so the role alone is not enough; with the setting unset,
 *    nobody gets through. A direct role comparison: `hasOwnerAccess` also
 *    accepts owners and is the wrong helper here.
 * 2. Who typed their own password in the last five minutes (`unlockKeys`).
 *    That is held as a signed, httpOnly, same-site cookie tied to their user
 *    id and to the sign-in it was typed in, so a session left open on a
 *    shared computer is not enough and a copied pass is no use elsewhere.
 * 3. Who is still an active developer in the database at the moment of the
 *    read. The session's role is not trusted for this: `revealKey` and
 *    `exportEnvFile` look the person up again, as `unlockKeys` does.
 * 4. Asking for a name on the list. `revealKey` never looks up whatever name
 *    it is handed: the name must have the shape of a key, must not be one the
 *    platform sets, and must be in `connections.ts` or held by Vercel.
 *
 * ## What nobody gets
 *
 * The keys that sign sessions and passes (`NEVER_SHOWN_KEY_NAMES`):
 * `revealKey` answers `withheld`, and the exported file carries a commented
 * line saying to make your own. Whoever holds the signing key can make any
 * session and any pass, so this gate cannot be the thing that hands it out.
 *
 * ## Wrong passwords
 *
 * Every try is counted BEFORE the password is checked, five per developer
 * per fifteen minutes, so tries sent at the same moment cannot all be
 * checked. The right password clears the count. If the count cannot be kept
 * (Redis set up but not answering), nobody unlocks until it can.
 *
 * ## Where the values come from
 *
 * The running server's own environment. Vercel refuses to return variables
 * marked Sensitive, and the app already holds its keys in memory.
 *
 * ## What is recorded
 *
 * Each reveal and each export writes one line to the server log: what
 * happened, who, which name, when. Never the value. There is no table for
 * this yet: a lasting in-app record needs a change to the live database that
 * has not been agreed.
 *
 * Server actions are POST requests and their results are never cached; these
 * also read cookies, which keeps them out of any cache.
 */

export type UnlockKeysResult =
  | { ok: true; /** ISO time the unlock stops working. */ expiresAt: string }
  | { ok: false }

/**
 * - `forbidden`: not signed in as a developer of the account allowed to read
 *   keys, or no longer one.
 * - `locked`: the password has not been typed in the last five minutes, in
 *   this sign-in.
 * - `unknown`: not a name this page may show.
 * - `withheld`: a key that is never shown to anyone (it signs sessions and
 *   passes). Make your own for local work.
 * - `notSet`: a known name with no value on this server.
 */
export type KeyRefusal = "forbidden" | "locked" | "unknown" | "withheld" | "notSet"

export type RevealKeyResult = { ok: true; value: string } | { ok: false; code: KeyRefusal }

export type ExportEnvFileResult =
  | {
      ok: true
      /** Always `.env.local`. */
      filename: string
      /** The whole file. */
      text: string
      /** How many keys it holds. */
      count: number
      /** Names whose value could not be written to a file safely; copy these one at a time. */
      skipped: string[]
    }
  | { ok: false; code: Exclude<KeyRefusal, "unknown" | "withheld" | "notSet"> }

/** Wrong passwords one developer may type before waiting. */
const UNLOCK_LIMIT = { limit: 5, windowMs: 15 * 60_000 }
/** Longest password bcrypt is asked to check. */
const MAX_PASSWORD = 200

type Developer = { userId: string; accountId: string }

/**
 * The signed-in developer of the account allowed to read keys, or null for
 * anyone else: an owner, another account's developer, and everyone while
 * `DEVELOPER_PORTAL_ACCOUNT_ID` is unset.
 */
async function developer(): Promise<Developer | null> {
  const session = await getSession()
  const user = session?.user
  if (!user || user.role !== "DEVELOPER") return null
  if (!canUseKeys(session)) return null
  if (typeof user.id !== "string" || user.id === "") return null
  return { userId: user.id, accountId: user.accountId }
}

/**
 * Is this person, right now, an active developer of this account in the
 * database. One read by primary key, selecting only the id. A database that
 * does not answer is a no: a value is never handed out on an unchecked role.
 */
async function isStillDeveloper({ userId, accountId }: Developer): Promise<boolean> {
  try {
    const row = await prisma.user.findFirst({
      where: { id: userId, accountId, role: "DEVELOPER", removedAt: null },
      select: { id: true },
    })
    return row !== null
  } catch {
    return false
  }
}

/** The mark of the sign-in this request came in under, or null without one. */
async function currentSignIn(): Promise<string | null> {
  const jar = await cookies()
  return sessionFingerprint(jar.getAll())
}

async function isUnlocked(userId: string): Promise<boolean> {
  const jar = await cookies()
  return unlockTokenIsValid(jar.get(UNLOCK_COOKIE)?.value, userId, sessionFingerprint(jar.getAll()))
}

/** True when the name is set, and not just to spaces, on this server. Reads no value out. */
function isSetHere(name: string): boolean {
  return valueOf(name) !== null
}

/** One line per event, as JSON. Takes only the fields it writes, so a value cannot reach it. */
function record(event: string, userId: string, key: string): void {
  console.info(JSON.stringify({ event, userId, key, at: new Date().toISOString() }))
}

/** The value of a name on this server, or null when unset or blank. */
function valueOf(name: string): string | null {
  const v = process.env[name]
  return typeof v === "string" && v.trim() !== "" ? v : null
}

/**
 * Type the password again to open the keys for five minutes.
 *
 * Fails the same way whatever went wrong, so nothing can be learned from it.
 * Every try is counted before it is checked, and the right password clears
 * the count: after five wrong ones in fifteen minutes even the right one
 * waits.
 */
export async function unlockKeys(password: string): Promise<UnlockKeysResult> {
  try {
    const who = await developer()
    if (!who) return { ok: false }
    const { userId, accountId } = who
    if (typeof password !== "string" || password === "" || password.length > MAX_PASSWORD) {
      return { ok: false }
    }

    // The pass is tied to this sign-in; without one there is nothing to tie it to.
    const signIn = await currentSignIn()
    if (!signIn) return { ok: false }

    // Counted first, checked second. Reading the count, checking, and only
    // then adding to it let any number of tries sent together all be checked.
    // "unavailable" (Redis set up, not answering) is refused like "over".
    const limitKey = `developer-keys-unlock:${userId}`
    if ((await chargeAttemptKey(limitKey, UNLOCK_LIMIT)) !== "allowed") return { ok: false }

    // The role is read again from the row, so someone demoted or removed
    // since their session began is refused here.
    const user = await prisma.user.findFirst({
      where: { id: userId, accountId, role: "DEVELOPER", removedAt: null },
      select: { password: true },
    })
    const matches = user ? await bcrypt.compare(password, user.password) : false
    if (!matches) {
      console.warn(
        JSON.stringify({ event: "developer.keys.unlock_failed", userId, at: new Date().toISOString() }),
      )
      return { ok: false }
    }

    // Their own wrong tries before this one no longer count against them.
    await clearAttemptKey(limitKey)

    const { token, exp } = issueUnlockToken(userId, signIn)
    const jar = await cookies()
    jar.set(UNLOCK_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: Math.floor(UNLOCK_TTL_MS / 1000),
    })
    record("developer.keys.unlocked", userId, "-")
    return { ok: true, expiresAt: new Date(exp).toISOString() }
  } catch {
    return { ok: false }
  }
}

/** Close the keys again now instead of waiting out the five minutes. */
export async function lockKeys(): Promise<{ ok: true }> {
  // Read the session like every other action here; anyone may lock.
  await getSession()
  const jar = await cookies()
  jar.delete(UNLOCK_COOKIE)
  return { ok: true }
}

/** Is this a name the page may show: on the list, or held by Vercel, and never the platform's. */
async function isKnownName(name: string): Promise<boolean> {
  if (typeof name !== "string" || !KEY_NAME_PATTERN.test(name)) return false
  if (isPlatformKey(name)) return false
  if (findKey(name)) return true
  // Not on the list: allowed only when Vercel itself lists it.
  const held = await listVercelEnv()
  return held.ok && held.rows.some((r) => r.name === name)
}

/** One key's value, for a developer who has unlocked. */
export async function revealKey(name: string): Promise<RevealKeyResult> {
  const who = await developer()
  if (!who) return { ok: false, code: "forbidden" }
  const { userId } = who
  if (!(await isUnlocked(userId))) return { ok: false, code: "locked" }
  if (!(await isStillDeveloper(who))) return { ok: false, code: "forbidden" }
  if (!(await isKnownName(name))) return { ok: false, code: "unknown" }
  // Before any value is read: these are never handed out.
  if (isNeverShownKey(name)) return { ok: false, code: "withheld" }

  const value = valueOf(name)
  if (value === null) return { ok: false, code: "notSet" }

  record("developer.keys.revealed", userId, name)
  return { ok: true, value }
}

/**
 * The text of a `.env.local` holding every key set on this server, grouped by
 * connection, for a developer who has unlocked. The keys that sign sessions
 * and passes are left out on purpose, with a line saying to make your own.
 */
export async function exportEnvFile(): Promise<ExportEnvFileResult> {
  const who = await developer()
  if (!who) return { ok: false, code: "forbidden" }
  const { userId } = who
  if (!(await isUnlocked(userId))) return { ok: false, code: "locked" }
  if (!(await isStillDeveloper(who))) return { ok: false, code: "forbidden" }

  const groups: EnvFileGroup[] = CONNECTIONS.map((c) => ({
    title: c.name,
    keys: c.keys.flatMap((k): EnvFileKey[] => {
      // A never-shown key's value does not leave `process.env`: the file gets
      // a commented line saying to make your own, when this server has one.
      if (isNeverShownKey(k.name)) {
        return isSetHere(k.name) ? [{ name: k.name, value: "", withheld: true }] : []
      }
      const value = valueOf(k.name)
      return value === null ? [] : [{ name: k.name, value, note: k.localNote }]
    }),
  }))

  // Names Vercel holds that the list does not know, when this server has them.
  const held = await listVercelEnv()
  if (held.ok) {
    const extra = held.rows
      .map((r) => r.name)
      .filter((n) => KEY_NAME_PATTERN.test(n) && !isPlatformKey(n) && !isNeverShownKey(n) && !findKey(n))
      .flatMap((n) => {
        const value = valueOf(n)
        return value === null ? [] : [{ name: n, value }]
      })
    groups.push({ title: "Held by Vercel, not read by the code", keys: extra })
  }

  const file = buildEnvFile({ madeAt: new Date(), groups, byHand: githubOnlyKeyNames() })
  record("developer.keys.exported", userId, "ALL")
  return {
    ok: true,
    filename: ".env.local",
    text: file.text,
    count: file.written,
    skipped: file.skipped,
  }
}
