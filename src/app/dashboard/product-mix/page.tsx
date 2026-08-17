import { redirect } from "next/navigation"

/**
 * Retired — Product Mix and Menu Profit both ranked menu items by contribution,
 * and this page's own successor documents it as superseded: the Menu Profit
 * docblock describes itself as "the corrected classifier, not the price-proxy
 * scatter on /dashboard/product-mix". Two nav entries where one was documented
 * as wrong, so this one now forwards.
 *
 * The mobile surface at /m/product-mix is unaffected — it is the phone's only
 * menu-performance view and shares no code with the retired desktop page.
 */
export default function ProductMixRetiredPage() {
  redirect("/dashboard/menu-profit")
}
