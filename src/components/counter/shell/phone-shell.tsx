"use client"

import { useCallback, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { MTop } from "./m-top"
import { MDateSheet } from "./m-date-sheet"
import { PageChromeContext, type PageChrome } from "./page-chrome"
import type { SwitchableStore } from "./store-switcher"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { hasWindow, phoneTrail, storeScopeHref } from "@/lib/counter/route-shape"
import type { ComparisonId, DateRange, PresetId } from "@/lib/counter/date-range"

/**
 * The phone's chrome, and the counterpart of `AppShell` on the surface a phone
 * actually renders (`src/middleware.ts` redirects `/dashboard` to `/m` on a
 * phone user agent, so this — not the desk island — is what
 * `npm run fidelity`'s `fidelity-mobile` project measures).
 *
 * `.ct-root` and `.ct-phone` sit ONE ELEMENT ABOVE `.mscroll`, so that `.mtop`
 * is inside them too. This is `.pframe`'s own arrangement: the prototype's
 * token root wraps the top chrome, the scroll region and the sheets, and is
 * none of them. `.mtop` reads `--chrome` and `--line`, which the alias layer
 * declares only on a Counter root.
 *
 * `.ct-root` is what makes every ported rule below live — it is the alias
 * layer's own selector and the element `container-name: fr` sits on.
 * `.ct-phone` is `.pframe`'s type scale, a step larger than the desk's at
 * every step because a phone is held closer and the column is 316px wide;
 * worn WITH `.ct-root`, never instead of it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A LAYOUT NOW
 * ---------------------------------------------------------------------------
 *
 * Every phone Counter island used to open with this same three-element frame,
 * so a tab change destroyed and rebuilt `.mtop`, its store sheet and its date
 * sheet. `src/app/(mobile)/m/(counter)/layout.tsx` mounts it once instead.
 *
 * The route group is not decoration: `src/app/(mobile)/m/layout.tsx` is shared
 * with a dozen editorial `/m` pages that have their own toolbar, and
 * `counter-phone-overview-client.tsx` said so — "it moves to the shell the day
 * the shell is Counter." A `(counter)` group is that shell, wrapping the four
 * Counter routes and nothing else.
 *
 * Both controls write the SAME three parameters the desk writes, through the
 * same `writeCounterParams`. What is page-specific comes off the ROUTE
 * (`route-shape.ts`: the back trail, whether there is a window at all, where
 * picking a store goes) so it is right on the first paint, or through
 * `PageChromeContext` for the two things only a page's data knows.
 */
export function PhoneShell({
  stores,
  today,
  children,
}: {
  stores: SwitchableStore[]
  today?: Date
  children: ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  const resolvedToday = useMemo(() => today ?? new Date(), [today])
  const params = useMemo(
    () => new URLSearchParams(searchParams?.toString() ?? ""),
    [searchParams],
  )
  const { presetId, comparisonId, range, storeId } = useMemo(
    () => readCounterParams(params, resolvedToday),
    [params, resolvedToday],
  )

  /**
   * Every control here goes through this, exactly as the desk's do.
   * `writeCounterParams` drops anything sitting at its default, so the URL a
   * reader shares off a phone is the same short URL the desk produces.
   *
   * push, not replace: a range change is a real navigation an owner expects
   * the back button to undo.
   */
  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1], href = pathname) => {
      const qs = writeCounterParams(params, next).toString()
      router.push(qs ? `${href}?${qs}` : href, { scroll: false })
    },
    [params, pathname, router],
  )

  const [page, setPage] = useState<PageChrome>({})

  const onSelectStore = useCallback(
    (id: string | null) => push({ storeId: id }, storeScopeHref(pathname)),
    [push, pathname],
  )
  const selectedStoreId = page.storeId !== undefined ? page.storeId : storeId

  const trail = phoneTrail(pathname)
  const windowed = hasWindow(pathname)

  return (
    <div className="ct-root ct-phone">
      {/* The store and the range, in the prototype's own phone chrome. Outside
          `.mscroll`, and so outside the fidelity surface — which is why it
          went missing without a gate noticing. */}
      <MTop
        stores={stores}
        selectedStoreId={selectedStoreId}
        onSelectStore={onSelectStore}
        /*
         * `phoneFor()` writes `(p.nodate ? '' : CD.chip())`, and `P.order` is
         * `nodate: true` (line 6569): one order does not have a range. `MTop`
         * emits the slot only when there is something in it, so the chip is
         * absent rather than present and inert — note 46's exact defect is a
         * control that is drawn and does nothing.
         */
        date={
          windowed ? (
            <MDateSheet
              presetId={presetId}
              comparisonId={comparisonId}
              range={range}
              onPreset={(id: PresetId) => push({ presetId: id })}
              onComparison={(id: ComparisonId) => push({ comparisonId: id })}
              onRange={(next: DateRange) => push({ range: next })}
            />
          ) : undefined
        }
        back={trail ? <PhoneBack href={trail.href} label={trail.label} /> : undefined}
      />

      {/* `.mscroll` is the phone page's grid: 12px of padding, 11px between
          blocks, and the staggered entry `counter-repairs.css` already repairs
          for `.mscroll > *`. */}
      <div className="mscroll">
        <PageChromeContext.Provider value={setPage}>{children}</PageChromeContext.Provider>
      </div>
    </div>
  )
}

/**
 * `.mback`, the phone's back button. `trailOf('order')` is `['orders']`, so
 * `phoneFor()` emits one with the parent's own name; a root tab has none.
 *
 * A `<Link>` rather than the prototype's `<button data-goto>`, the same trade
 * `MList` makes: `.mback` styles an `<a>` unchanged, and an anchor gets
 * middle-click, "open in new tab", the correct role and keyboard activation
 * for free. It points at the PHONE's list — a link is also what lands in the
 * address bar and in anything the reader shares.
 */
function PhoneBack({ href, label }: { href: string; label: string }) {
  return (
    <Link className="mback" href={href}>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        aria-hidden="true"
      >
        <path d="M10 3.5L5.5 8l4.5 4.5" />
      </svg>
      {label}
    </Link>
  )
}
