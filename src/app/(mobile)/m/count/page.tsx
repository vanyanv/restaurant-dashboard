import { permanentRedirect } from "next/navigation"

/**
 * `/m/count` — a redirect shim onto `/m/operations/inventory/count/new`, and
 * the last pre-Counter screen anywhere on the phone.
 *
 * What was here was the editorial counting flow: `start-session-form.tsx` and
 * a 972-line `count-flow.tsx`. Counter pages linked to it — "Start the count"
 * on the phone's Inventory and in `adapters/inventory.ts` — so an owner
 * pressed a rebuilt button and landed on the old product. It could not move
 * until the Counter session page could take a number, which it could not until
 * 2311daa5.
 *
 * The whole loop was then driven on an iPhone 13 viewport: begin, six boxes,
 * two quantities typed, both surviving a reload and priced, then closed. That
 * was the first `StockCount` ever to reach COMPLETED here — the status the
 * on-hand model calibrates on, and the one this account's own inventory page
 * says has never happened.
 *
 * ## What the Counter flow does not do, said plainly
 *
 * The page this replaces could do two things its replacement cannot, and both
 * are worth naming rather than discovering:
 *
 *   - **Three-tier entry.** It took cases, inner packs and loose units and
 *     converted them to the recipe unit. The Counter form asks for one number
 *     in the recipe unit, which means someone holding eight cases does the
 *     arithmetic themselves. Nothing on this account has ever defined a pack
 *     tier (`recipeUnitsPerCase` is null on every ingredient), so nothing is
 *     losing a conversion it was using — but the walk is worse for a store
 *     that would have.
 *   - **Adjustments.** `logAdjustment` wrote `InventoryAdjustment` rows with a
 *     reason. It is now unreferenced, and it is deliberately NOT deleted with
 *     the flow that called it: the Counter Inventory page already draws an
 *     "Adjust on hand" section with the same five reasons, and that section
 *     has no writer. One of them is a form waiting for an action and the other
 *     is an action waiting for a form; deleting the action would turn a loose
 *     wire into a missing feature.
 *
 * Both are follow-ups on the Counter session, not reasons to keep a second
 * counting screen alive — the editorial one is in git if either needs reading.
 */
export default async function MobileCountRedirect() {
  permanentRedirect("/m/operations/inventory/count/new")
}
