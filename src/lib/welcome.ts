import "server-only"
import { cookies } from "next/headers"
import { randomBytes } from "node:crypto"
import { getRedis } from "@/lib/cache/redis"

const COOKIE_NAME = "welcome_kid"
const TTL_SECONDS = 60 * 60 * 24 * 7
const PENDING_TTL_SECONDS = 60

type WelcomeRecord = {
  firstName: string
  userId: string
}

const welcomeKey = (kid: string) => `welcome:${kid}`
const pendingKey = (userId: string) => `pending_welcome:${userId}`
const cleanLogoutKey = (userId: string) => `clean_logout:${userId}`

export function extractFirstName(name: string | null | undefined): string | null {
  if (!name) return null
  const first = name.trim().split(/\s+/)[0]
  return first || null
}

export async function getFirstNameByKid(): Promise<string | null> {
  try {
    const redis = getRedis()
    if (!redis) return null
    const store = await cookies()
    const kid = store.get(COOKIE_NAME)?.value
    if (!kid) return null
    const record = await redis.get<WelcomeRecord>(welcomeKey(kid))
    return record?.firstName ?? null
  } catch {
    return null
  }
}

export async function markSignIn(args: {
  userId: string
  name: string | null | undefined
}): Promise<void> {
  const firstName = extractFirstName(args.name)
  if (!firstName) return

  let kid: string
  try {
    const store = await cookies()
    const existing = store.get(COOKIE_NAME)?.value
    kid = existing ?? randomBytes(16).toString("hex")
    if (!existing) {
      store.set({
        name: COOKIE_NAME,
        value: kid,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: TTL_SECONDS,
      })
    }
  } catch {
    return
  }

  const redis = getRedis()
  if (!redis) return

  try {
    const [previous, wasCleanLogout] = await Promise.all([
      redis.get<WelcomeRecord>(welcomeKey(kid)),
      redis.getdel(cleanLogoutKey(args.userId)),
    ])
    const writes: Promise<unknown>[] = [
      redis.set(
        welcomeKey(kid),
        { firstName, userId: args.userId } satisfies WelcomeRecord,
        { ex: TTL_SECONDS },
      ),
    ]
    if (!wasCleanLogout && previous) {
      writes.push(
        redis.set(pendingKey(args.userId), 1, { ex: PENDING_TTL_SECONDS }),
      )
    }
    await Promise.all(writes)
  } catch {
    // feature self-disables on Redis errors
  }
}

export async function markSignOut(userId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(cleanLogoutKey(userId), 1, { ex: TTL_SECONDS })
  } catch {
    // swallow
  }
}

export async function consumePendingWelcome(userId: string): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false
  try {
    const value = await redis.getdel(pendingKey(userId))
    return value === 1 || value === "1"
  } catch {
    return false
  }
}
