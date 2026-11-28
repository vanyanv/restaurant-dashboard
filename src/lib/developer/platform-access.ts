import "server-only"

/**
 * Who may read the live site's key values.
 *
 * DEVELOPER is a role INSIDE one account: every account can have its own
 * developers. The keys are not inside any account. One database URL, one
 * mail key, one set of everything serves every account on the platform, so
 * "is a developer" cannot be the whole test, or the first developer of a
 * second account could read the keys to the first account's data.
 *
 * `DEVELOPER_PORTAL_ACCOUNT_ID` names the one account whose developers may,
 * the way `INVOICE_ACCOUNT_ID` names the account the invoice mailbox belongs
 * to (`src/lib/invoice-mailbox.ts`). Unlike that one there is no fallback:
 * while it is unset NOBODY may read a value. A missing setting must never
 * widen who gets in.
 *
 * The checks live here and nowhere else. `unlockKeys`, `revealKey` and
 * `exportEnvFile` call `canUseKeys`; the pages call `canSeeDeveloperPortal`
 * to decide whether to draw at all; the adapter calls `keysAccessFor` to tell
 * the page, in a word, why showing values is off.
 */

type Env = Record<string, string | undefined>

/** Just the parts of a session these checks read. */
type SessionLike =
  | { user?: { role?: string | null; accountId?: string | null } | null }
  | null
  | undefined

/**
 * Why values cannot be shown.
 *
 * - `notSetUp`: `DEVELOPER_PORTAL_ACCOUNT_ID` is not set on this server.
 * - `otherAccount`: it is set, and names a different account.
 */
export type KeysOffReason = "notSetUp" | "otherAccount"

export type KeysAccess = { available: true } | { available: false; reason: KeysOffReason }

/** The account the setting names, or null when it is unset or blank. */
export function portalAccountId(env: Env = process.env): string | null {
  const id = env.DEVELOPER_PORTAL_ACCOUNT_ID?.trim()
  return id ? id : null
}

/** Whether key values are available to this account, and if not, why. */
export function keysAccessFor(accountId: string | null | undefined, env: Env = process.env): KeysAccess {
  const pinned = portalAccountId(env)
  if (pinned === null) return { available: false, reason: "notSetUp" }
  if (typeof accountId !== "string" || accountId === "" || accountId !== pinned) {
    return { available: false, reason: "otherAccount" }
  }
  return { available: true }
}

/**
 * May this session unlock, show and download key values: a DEVELOPER of the
 * named account. False for everyone while the setting is unset.
 *
 * A direct role comparison on purpose: `hasOwnerAccess` also accepts owners.
 */
export function canUseKeys(session: SessionLike, env: Env = process.env): boolean {
  const user = session?.user
  if (!user || user.role !== "DEVELOPER") return false
  return keysAccessFor(user.accountId, env).available
}

/**
 * May this session open the developer page at all.
 *
 * - Not a DEVELOPER: no.
 * - The setting names another account: no. The page describes the whole
 *   platform's wiring, which is not that account's to read.
 * - The setting is unset: yes, with the keys locked off (`canUseKeys` is
 *   false), so the page can say what is missing.
 */
export function canSeeDeveloperPortal(session: SessionLike, env: Env = process.env): boolean {
  const user = session?.user
  if (!user || user.role !== "DEVELOPER") return false
  const access = keysAccessFor(user.accountId, env)
  return access.available || access.reason === "notSetUp"
}
