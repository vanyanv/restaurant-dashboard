import { prisma } from "@/lib/prisma"
import type { LoginKind } from "@/generated/prisma/client"

const PRESENCE_WINDOW_MS = 8 * 60 * 60 * 1000 // matches NextAuth jwt maxAge

type HeadersLike =
  | Headers
  | Record<string, string | string[] | undefined>
  | undefined
  | null

function pickHeader(h: HeadersLike, key: string): string | null {
  if (!h) return null
  if (typeof (h as Headers).get === "function") {
    return (h as Headers).get(key)
  }
  const raw = (h as Record<string, string | string[] | undefined>)[key.toLowerCase()]
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw ?? null
}

/** Best-effort client IP from request headers. Returns null in local dev
 * where no upstream proxy is in front of Next. */
export function extractIp(headers: HeadersLike): string | null {
  const xff = pickHeader(headers, "x-forwarded-for")
  if (xff) return xff.split(",")[0]?.trim() || null
  return (
    pickHeader(headers, "x-vercel-forwarded-for") ||
    pickHeader(headers, "x-real-ip") ||
    null
  )
}

export function extractUserAgent(headers: HeadersLike): string | null {
  return pickHeader(headers, "user-agent")
}

type LoginEventInput = {
  userId?: string | null
  emailTried: string
  kind: LoginKind
  headers?: HeadersLike
  ipAddress?: string | null
  userAgent?: string | null
}

/** Write one login event. Never throws — auth path must not fail on audit. */
export async function recordLoginEvent(input: LoginEventInput): Promise<void> {
  try {
    const ip = input.ipAddress ?? extractIp(input.headers)
    const ua = input.userAgent ?? extractUserAgent(input.headers)
    await prisma.loginEvent.create({
      data: {
        userId: input.userId ?? null,
        emailTried: input.emailTried,
        kind: input.kind,
        ipAddress: ip,
        userAgent: ua,
      },
    })
  } catch (err) {
    console.error("[login-audit] failed to record event", err)
  }
}

export type PresenceUser = {
  userId: string
  email: string
  name: string
  lastSignInAt: Date
  ipAddress: string | null
}

/** Derive who's "online now" from LoginEvent. JWT strategy means there
 * is no session table to read; we use the login stream instead. A user
 * is considered online if their most recent event within the JWT TTL
 * window is a SIGN_IN (not SIGN_OUT). */
export async function getLivePresence(): Promise<PresenceUser[]> {
  const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS)
  const recent = await prisma.loginEvent.findMany({
    where: { createdAt: { gte: cutoff }, userId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { userId: true, kind: true, createdAt: true, ipAddress: true },
  })
  const seen = new Map<string, { kind: LoginKind; at: Date; ip: string | null }>()
  for (const r of recent) {
    if (!r.userId || seen.has(r.userId)) continue
    seen.set(r.userId, { kind: r.kind, at: r.createdAt, ip: r.ipAddress })
  }
  const onlineIds = [...seen.entries()]
    .filter(([, v]) => v.kind === "SIGN_IN")
    .map(([id]) => id)
  if (onlineIds.length === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: onlineIds } },
    select: { id: true, email: true, name: true },
  })
  return users.map((u) => {
    const meta = seen.get(u.id)!
    return {
      userId: u.id,
      email: u.email,
      name: u.name,
      lastSignInAt: meta.at,
      ipAddress: meta.ip,
    }
  })
}

/** Recent login history with user info for the People drilldown. */
export async function getLoginHistory(limit = 100) {
  const rows = await prisma.loginEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, userId: true, emailTried: true, kind: true,
      ipAddress: true, userAgent: true, createdAt: true,
    },
  })
  return rows
}
