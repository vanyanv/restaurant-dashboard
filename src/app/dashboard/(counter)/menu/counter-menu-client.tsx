"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
  Donut,
  Note,
  PageHead,
  Queue,
  Section,
  Strip,
  useCounterTransition,
  usePageChrome,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { MENU_TABS } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { MenuHubSections } from "@/lib/counter/adapters/menu-hub"

/**
 * The Menu hub, composed from `P.menuhub.desk()`
 * (`docs/counter/counter-prototype.html:7278`) in the prototype's own order:
 *
 *   strip → the split of "Where to work" and "By category".
 *
 * ## The three destinations are `<Link>`s, not buttons
 *
 * The prototype writes `data-goto` and catches it with a delegated listener.
 * Ours are real hrefs, for the reason the rail already carries: an href is
 * middle-clickable and openable in a new tab, and every `.qitem` rule is
 * class-keyed so it applies unchanged. `Queue`'s own type enforces the choice —
 * `act` arrives with `href` OR with `onAct`, never both and never alone.
 *
 * ## The ring counts ITEMS
 *
 * Its centre is the item count, which is what the prototype draws there
 * (`donut([...], '84')`). A ring by cost is a different picture and lives on
 * the COGS page: Drinks is 23 of 61 items here and 7.1% of cost there. The
 * adapter's note says so on the page rather than leaving a reader to wonder
 * which ring lied.
 */
export type CounterMenuHubSections = SectionSources<MenuHubSections>

const ASK_SUGGESTIONS = [
  "Which menu items have no recipe yet?",
  "What is the blended margin on the menu?",
  "Which modifiers are still uncosted?",
]

export function CounterMenuClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterMenuHubSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })

  const { pending, startTransition } = useCounterTransition()

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const qs = writeCounterParams(params, next).toString()
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
      })
    },
    [params, pathname, router, startTransition],
  )

  const { range, presetId, comparisonId } = counterParams
  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const storeName = selectedStore?.name ?? "All stores"
  const windowLabel = rangeLabel(range, "custom")

  return (
    <>
      <PageHead title="Menu" sub={`${storeName} · ${windowLabel}`}>
        <DateControl
          presetId={presetId}
          comparisonId={comparisonId}
          range={range}
          onPreset={(id) => push({ presetId: id })}
          onComparison={(id) => push({ comparisonId: id })}
          onStep={(direction) => push({ range: stepRange(range, direction) })}
          onRange={(next) => push({ range: next })}
        />
      </PageHead>

      {/* The design's `VIEWS` bar for this family — see `MENU_TABS` in
          `@/lib/counter/nav`. Without it these siblings are pages nothing
          links to; `.seg` is not a fidelity landmark, so it changes no count. */}
      <SubNav items={MENU_TABS} label="Menu" />

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <div className="split">
        {/* No `meta`: the prototype passes an empty subtitle here (`sec('Where
            to work', '', ...)`), because three destinations need no window. */}
        <Section title="Where to work" data={sections.work} pending={pending}>
          {(w) => <Queue items={w.items} />}
        </Section>

        <Section
          title="By category"
          meta={(c) => c.meta}
          data={sections.categories}
          pending={pending}
          askAbout="how the menu splits by category"
        >
          {(c) => (
            <>
              <Donut slices={c.slices} center={c.center} />
              <Note>
                {c.note}
              </Note>
            </>
          )}
        </Section>
      </div>
    </>
  )
}
