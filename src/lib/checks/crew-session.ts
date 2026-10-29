import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * The crew member's pass between entering a PIN and submitting the check.
 *
 * Crew have no account, so the PIN step hands back a signed token naming the
 * store, the person, the check and its business day. Submit accepts nothing
 * else. It expires after the window could have closed anyway, and it is held
 * in the page's memory only, so closing the tab signs the person out.
 */

export type CrewPass = {
  storeId: string
  crewMemberId: string
  kind: string
  day: string
  /** Epoch ms. */
  exp: number
}

// Long enough for a morning list opened at 9:00 am and submitted at 5:30 pm.
const TTL_MS = 10 * 60 * 60 * 1000

function secret(): string {
  const s = process.env.CHECKS_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!s) throw new Error("NEXTAUTH_SECRET is not set")
  return s
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(`crew-pass:${body}`).digest("base64url")
}

export function issueCrewPass(p: Omit<CrewPass, "exp">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...p, exp: now + TTL_MS })).toString("base64url")
  return `${body}.${sign(body)}`
}

export function readCrewPass(token: string, now = Date.now()): CrewPass | null {
  const [body, mac] = token.split(".")
  if (!body || !mac) return null
  const expected = Buffer.from(sign(body))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as CrewPass
    if (typeof p.exp !== "number" || p.exp < now) return null
    return p
  } catch {
    return null
  }
}
