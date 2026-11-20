import "server-only"
import { cookies } from "next/headers"
import { encode, getToken, type JWT } from "next-auth/jwt"

/**
 * Who is signed in, read from the session cookie alone. No database.
 *
 * `getServerSession` runs the `jwt` callback in `src/lib/auth.ts`, which asks
 * the database whether this user still exists on every call. That is right
 * for a page deciding what to show, and wrong for a layout that only needs a
 * first name and a role to draw its frame: the layout's `await` holds the
 * whole response, so while a sleeping Neon compute woke up (2 to 10 s) the
 * phone got no bytes at all, and a home-screen launch sat on a black screen
 * until the database answered.
 *
 * The cookie is the same signed token `src/proxy.ts` already verified before
 * the request got here, so nothing it says is unchecked. What it can be is a
 * little stale: a role change or a removal shows in the frame on the next
 * page load rather than this one. The page under the frame still calls
 * `getServerSession`, so a removed user is still turned away by the page.
 */
export async function readSessionToken(): Promise<JWT | null> {
  try {
    return await getToken({
      req: { cookies: await cookies(), headers: {} } as unknown as Parameters<typeof getToken>[0]["req"],
      secret: process.env.NEXTAUTH_SECRET,
    })
  } catch {
    return null
  }
}

const SESSION_COOKIES = ["__Secure-next-auth.session-token", "next-auth.session-token"] as const
/** Matches `session.maxAge` in `src/lib/auth.ts`. */
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60

/**
 * Re-issue the signed-in person's session cookie with a fresh `iat`.
 *
 * A password change ends every session issued before it (the jwt callback
 * compares `iat` with `User.passwordChangedAt`). The person who made the
 * change should not be one of them, so the action that saves the new
 * password calls this straight after: same claims, new issue time, same
 * cookie name and attributes next-auth itself uses. Server actions and route
 * handlers only (cookies cannot be set from a page render).
 *
 * Returns false when there is no readable session cookie; the caller's
 * session then ends on its next page load, as everyone else's does.
 */
export async function reissueSessionCookie(): Promise<boolean> {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) return false
  const jar = await cookies()
  const name = SESSION_COOKIES.find((n) => jar.get(n))
  if (!name) return false
  const token = await readSessionToken()
  if (!token) return false
  const value = await encode({ token, secret, maxAge: SESSION_MAX_AGE_S })
  jar.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: name.startsWith("__Secure-"),
    maxAge: SESSION_MAX_AGE_S,
  })
  return true
}
