"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Chart,
  DateControl,
  PageHead,
  Queue,
  Section,
  Strip,
  SubNav,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
} from "@/components/counter"
import { USAGE_TABS } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { ProductUsageSections } from "@/lib/counter/adapters/product-usage"

/**
 * Product usage, composed from `P.usage.desk()`:
 *
 *   strip -> where the variance sits -> a split of the trend and the worklist.
 *
 * The adapter's docblock argues the arithmetic. Two things about the PAGE are
 * decisions of their own:
 *
 * **No waste cell.** No table in this schema matches `%waste%`; the fourth
 * strip figure is attribution coverage instead, which is what this page owes a
 * reader who is about to read a variance table.
 *
 * **No `Menu item costs` and no `Vendor prices` sections**, though `P.usage`
 * advertises both as tabs. Menu item costs is `/dashboard/menu-profit` and the
 * menu catalog; vendor prices — "the same item, every vendor that sells it" —
 * is the ingredient page's matched-SKU table and the vendor page's basket.
 * All four are built. Rebuilding either here would be one figure computed
 * twice, which is the thing the shared-figure rule exists to stop.
 *
 * The prototype's own objection to that is right, though: "a tab label with
 * nothing behind it is the same broken promise as a shortcut that opens
 * nothing." Its `seg` navigates nowhere, which is why it had to stack all
 * three views onto one page to keep the promise. `USAGE_TABS` keeps it the
 * other way — the labels are links, and they go to the pages that already
 * hold those figures. Declining a section is only honest if the reader can
 * still get to what it would have said.
 */
export type CounterUsageSections = SectionSources<ProductUsageSections>

const VARIANCE_COLUMNS: Column[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "theoretical", label: "Theoretical", numeric: true },
  { key: "purchased", label: "Purchased", numeric: true },
  { key: "gap", label: "Variance", numeric: true },
  { key: "dollars", label: "$ variance", numeric: true },
  { key: "cause", label: "Reads as" },
]

const ASK_SUGGESTIONS = [
  "Where is the biggest gap between theoretical and purchased?",
  "Which ingredients are bought faster than they are used?",
  "How much cost has no ingredient behind it?",
]

export function CounterUsageClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterUsageSections
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  usePageChrome({ leaf: "Product usage", askSuggestions: ASK_SUGGESTIONS })

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
  const storeName = stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"

  return (
    <>
      <PageHead
        title="Product usage"
        sub={`${storeName} · what the recipes say you used against what you bought`}
      >
        {/* `P.usage.seg`. The two views this page declines to rebuild are
            links, not headings — see the docblock. */}
        <SubNav items={USAGE_TABS} label="Product usage" />
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

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="Where the variance sits"
        meta={(v) => v.meta}
        data={sections.variance}
        pending={pending}
        pad={false}
        askAbout="where is the biggest gap between theoretical and purchased"
      >
        {(v) => (
          <>
            <Table columns={VARIANCE_COLUMNS} rows={v.rows} />
            {/* No `.sec__body` — a table section emits the table alone, so the
                note carries the body's own inset inline. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {v.note}
            </p>
          </>
        )}
      </Section>

      <div className="split">
        <Section
          title="Theoretical against purchased"
          meta={(t) => t.meta}
          data={sections.trend}
          pending={pending}
        >
          {(t) => (
            <>
              <Chart {...t.chart} fmt={USD} />
              <p className="mono" style={{ margin: "9px 0 0" }}>
                {t.note}
              </p>
            </>
          )}
        </Section>

        <Section
          title="What to do"
          meta={(w) => w.meta}
          data={sections.work}
          pending={pending}
          askAbout="which ingredients are bought faster than they are used"
        >
          {(w) => <Queue items={w.items} />}
        </Section>
      </div>
    </>
  )
}

/** Whole dollars — a daily cost, not a unit price. */
const USD = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`
