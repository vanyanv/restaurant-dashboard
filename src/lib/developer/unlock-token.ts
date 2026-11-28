import { createHash, createHmac, timingSafeEqual } from "node:crypto"

/**
 * The developer's pass between typing their password and reading a key.
 *
 * A signed token naming the developer, the sign-in it was made in and when it
 * stops working, kept in an httpOnly cookie for five minutes. It is signed
 * with NEXTAUTH_SECRET under its own label, so a session cookie or a crew
 * pass can never stand in for it. Same shape as the crew pass in
 * `src/lib/checks/crew-session.ts`.
 *
 * It proves one thing: this user typed their password recently, in this
 * sign-in. Every action still checks the session and the role itself.
 *
 * ## Tied to the sign-in
 *
 * The body carries `sid`, a SHA-256 of the next-auth session cookie the
 * password was typed under, and a pass is refused under any other. So a pass
 * copied out of one browser is no use beside a different session cookie, and
 * signing out (which deletes the session cookie) ends it even though sign-out
 * here is the browser calling next-auth and never touches this cookie.
 *
 * The session cookie's value also changes when next-auth re-issues it: once a
 * day when `useKeepPlace` reads `/api/auth/session`, and on a password
 * change. A pass made just before that stops working early and the password
 * is asked for again. That is the safe direction.
 */

export const UNLOCK_COOKIE = "developer_keys_unlock"
export const UNLOCK_TTL_MS = 5 * 60 * 1000

/**
 * The names next-auth v4 gives its session cookie: `__Secure-` when the site
 * is served over https (the live site), plain otherwise. The secure name is
 * looked for first, because a page cannot plant a `__Secure-` cookie over
 * plain http. Same pair as `src/lib/session-token.ts`.
 */
const SESSION_COOKIE_NAMES = ["__Secure-next-auth.session-token", "next-auth.session-token"] as const

/**
 * A mark of the current sign-in: a SHA-256 of the session cookie's value, or
 * null when there is none. One way, so the pass never carries the session.
 *
 * next-auth splits a long session cookie into `name.0`, `name.1`, …; those
 * are joined in order, as next-auth itself reads them.
 */
export function sessionFingerprint(
  cookies: ReadonlyArray<{ name: string; value: string }>,
): string | null {
  for (const base of SESSION_COOKIE_NAMES) {
    const parts: Array<{ index: number; value: string }> = []
    for (const c of cookies) {
      if (c.name === base) parts.push({ index: -1, value: c.value })
      else if (c.name.startsWith(`${base}.`)) {
        const suffix = c.name.slice(base.length + 1)
        if (/^\d+$/.test(suffix)) parts.push({ index: Number(suffix), value: c.value })
      }
    }
    const value = parts
      .sort((a, b) => a.index - b.index)
      .map((p) => p.value)
      .join("")
    if (value !== "") return createHash("sha256").update(value).digest("base64url")
  }
  return null
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET
  if (!s) throw new Error("NEXTAUTH_SECRET is not set")
  return s
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(`developer-keys-unlock:${body}`).digest("base64url")
}

/**
 * A token for `userId`, in the sign-in marked `sessionId` (from
 * `sessionFingerprint`), that stops working `UNLOCK_TTL_MS` after `now`.
 * Throws without a sign-in to tie it to.
 */
export function issueUnlockToken(
  userId: string,
  sessionId: string,
  now = Date.now(),
): { token: string; exp: number } {
  if (!userId || !sessionId) throw new Error("An unlock pass needs a user and a sign-in")
  const exp = now + UNLOCK_TTL_MS
  const body = Buffer.from(JSON.stringify({ uid: userId, exp, sid: sessionId })).toString("base64url")
  return { token: `${body}.${sign(body)}`, exp }
}

/**
 * True only for a token this server signed, for this user, in this sign-in,
 * that has not run out. Never throws: an unset secret, a cut-off token and a
 * forged one are all simply false.
 */
export function unlockTokenIsValid(
  token: string | undefined | null,
  userId: string,
  sessionId: string | undefined | null,
  now = Date.now(),
): boolean {
  if (!token || !userId || !sessionId) return false
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false
  const [body, mac] = parts
  try {
    const expected = Buffer.from(sign(body))
    const given = Buffer.from(mac)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      uid?: unknown
      exp?: unknown
      sid?: unknown
    }
    if (typeof p.exp !== "number" || p.exp <= now) return false
    // A pass can never outlive its window, whatever the body claims.
    if (p.exp > now + UNLOCK_TTL_MS) return false
    if (typeof p.uid !== "string" || p.uid !== userId) return false
    return typeof p.sid === "string" && p.sid !== "" && p.sid === sessionId
  } catch {
    return false
  }
}
