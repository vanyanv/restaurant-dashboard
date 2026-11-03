/**
 * The cache tag on anything that counts open alerts for an account (today:
 * the rail's "Needs you" count in `counter/adapters/shell-status.ts`). Every
 * write in `app/actions/alerts/inbox-actions.ts` busts it.
 */
export function alertsCacheTag(accountId: string): string {
  return `alerts:${accountId}`
}
