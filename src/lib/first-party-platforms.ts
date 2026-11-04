/**
 * The Otter platform slugs that are the restaurant's OWN channels — money
 * that arrives without a marketplace in between, so no commission is owed on
 * it. The one list: the commission estimate (`counter/commission-core.ts`),
 * the house channel (`counter/channel-mix.ts`), the Orders page's marketplace
 * split, the P&L's first-party sales lines (`pnl.ts`) and the Otter sync's
 * first-party bucketing all read it. Pure: no imports, so the sync layer, the
 * statement and the scripts can all depend on it without a cycle.
 *
 * - `css-pos` — the in-store POS.
 * - `bnm-web` — the restaurant's own web ordering, as the DAILY SUMMARY
 *   (`OtterDailySummary.platform`) names it.
 * - `d2c-eater-website` — the SAME own-website orders, as the ORDER rows
 *   (`OtterOrder.platform`) name them. Otter spells one channel two ways in
 *   its two feeds; left off this list, every website order was a
 *   marketplace order with no rate on file — "commission unknown" — and
 *   fell out of the house channel.
 *
 * A new first-party slug goes here and nowhere else.
 */
export const FIRST_PARTY_PLATFORMS: readonly string[] = [
  "css-pos",
  "bnm-web",
  "d2c-eater-website",
]

const SET = new Set(FIRST_PARTY_PLATFORMS)

export function isFirstPartyPlatform(platform: string | null | undefined): boolean {
  return platform != null && SET.has(platform)
}
