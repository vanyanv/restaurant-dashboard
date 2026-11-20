/**
 * A password change ends every session signed in before it.
 *
 * `User.passwordChangedAt` is stamped by every path that sets a password on an
 * existing row (Settings, a re-invite of a removed person), and the jwt
 * callback in `src/lib/auth.ts` refuses a token issued before it. Kept apart
 * from `auth.ts` so the writers do not pull next-auth in to get a timestamp.
 */

/**
 * Was this token issued before the password last changed? Then it belongs to
 * a session the change was meant to end.
 *
 * `iat` is whole seconds (next-auth re-stamps it every time it re-encodes the
 * cookie); `passwordChangedAt` is stored on a whole second for this reason,
 * and the changer's own cookie is re-issued after it, so their `iat` is never
 * earlier and they stay signed in.
 */
export function issuedBeforePasswordChange(iat: unknown, passwordChangedAt: Date | null | undefined): boolean {
  if (!passwordChangedAt) return false
  // A token with no iat cannot show it postdates the change.
  if (typeof iat !== "number") return true
  return iat * 1000 < passwordChangedAt.getTime()
}

/** A password change's timestamp, on a whole second (see `issuedBeforePasswordChange`). */
export function passwordChangeStamp(now = Date.now()): Date {
  return new Date(Math.floor(now / 1000) * 1000)
}
