import { permanentRedirect } from "next/navigation"

/**
 * `/m/pnl/<id>` — a redirect shim onto `/m/pnl?store=<id>`, the phone's copy
 * of the decision `src/app/dashboard/pnl/[storeId]/page.tsx` took for the desk.
 *
 * What was here until now was 214 lines of the pre-Counter editorial design —
 * `PageHead`, `MastheadFigures`, `Panel`, `MPnLToolbar` and its five `?period=`
 * chips — reached from the Counter Overview's own "Open this store's P&L"
 * button. An owner on a rebuilt phone pressed a Counter button and landed on
 * the old product, which is the single largest remaining mismatch between this
 * surface and the design.
 *
 * It is a shim rather than a Counter rebuild because the rebuild already
 * happened somewhere else, and doing it again here would be the regression
 * `pnl-store.ts` warns about: "a store is a PARAM on one P&L, `?store=` is what
 * `writeCounterParams` writes." The prototype's `P.pnlstore` content lands on
 * the group page — the strip, the cascade, the eight weeks and the statement
 * take a `storeId` and always have, and "What this store carries" is now
 * rendered there from the same `getStoreFixedSectionPromises` the desk uses.
 *
 * THE QUERY IS CARRIED, unlike the desk's shim. `storeViewTabs` builds the
 * "One store" tab as `/m/pnl/<id>?range=…`, so dropping the query would make
 * that tab silently reset the window every time it was pressed — note 42's
 * defect, introduced by the bar rather than fixed by it. `store` is dropped on
 * the way through because the id is in the path and two sources for one fact
 * is how they come to disagree.
 *
 * No session check, for the reason the desk shim gives: this resolves to a
 * redirect and nothing else, and `/m/pnl` carries the gate a line later.
 */
export default async function MobileStorePnlRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { storeId } = await params
  const sp = await searchParams

  const carried = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (key === "store") continue
    if (typeof value === "string") carried.set(key, value)
  }
  const prefix = carried.toString()

  // `encodeURIComponent` for the id rather than a third `set` on `carried`:
  // `URLSearchParams` writes a space as `+`, and this shim has emitted `%20`
  // since it was written. Both decode the same, and neither is worth changing
  // the output of a redirect owners have bookmarked.
  permanentRedirect(
    `/m/pnl?${prefix ? `${prefix}&` : ""}store=${encodeURIComponent(storeId)}`,
  )
}
