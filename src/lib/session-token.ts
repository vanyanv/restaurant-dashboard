import "server-only"
import { cookies } from "next/headers"
import { getToken, type JWT } from "next-auth/jwt"

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
