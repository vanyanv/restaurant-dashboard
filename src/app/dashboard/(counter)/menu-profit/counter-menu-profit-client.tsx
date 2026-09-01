"use client"

import { useCallback, useMemo } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  DateControl,
  Matrix,
  PageHead,
  Queue,
  RankBars,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type SwitchableStore,
  SubNav,
} from "@/components/counter"
import { MENU_TABS } from "@/lib/counter/nav"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"
import { rangeLabel, stepRange } from "@/lib/counter/date-range"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { CoverageSection, MenuProfitSections } from "@/lib/counter/adapters/menu-profit"

/**
 * Menu profit, composed from `P.menu.desk()`
 * (`docs/counter/counter-prototype.html:5445`) in the prototype's own order:
 *
 *   strip → the split of the matrix and the opportunities → the honesty
 *   section → the item ledger.
 *
 * ## The honesty section reports a different column than the prototype's
 *
 * It is headed the same — "What these figures did not see" — and it is about
 * PARTIAL cost rather than unmapped items, because measured here the unmapped
 * gap is sixty-two dollars and the partial one is $26,690. The adapter's own
 * docblock argues it; this file just renders what it is handed.
 *
 * ## Two figures are the statement's, and the prototype asked for that
 *
 * Revenue and Food cost come from the same rollup the P&L and COGS read, which
 * `P.menu`'s own comment demands: *"the same two figures every other page
 * reads, from the same place."* Blended margin is on MENU revenue and says so
 * in its own delta — a different question, named rather than reconciled.
 */
export type CounterMenuProfitSections = SectionSources<MenuProfitSections>

const LEDGER_COLUMNS: Column[] = [
  { key: "item", label: "Item" },
  { key: "quadrant", label: "Quadrant" },
  { key: "sold", label: "Sold", numeric: true },
  { key: "margin", label: "Margin", numeric: true },
  { key: "contribution", label: "Contribution", numeric: true },
]

const ASK_SUGGESTIONS = [
  "Which menu items make me the least money per order?",
  "Which items sell well but earn badly?",
  "How much of the menu is only partly costed?",
]

/** The lead figure beside the bars — the prototype's own two-column block. */
function CoverageBlock({ c }: { c: CoverageSection }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 18,
        alignItems: "center",
      }}
    >
      <div>
        <span className="k" style={{ display: "block" }}>
          Fully costed
        </span>
        <span
          style={{
            fontSize: "var(--t-hero)",
            fontWeight: 600,
            letterSpacing: "-.03em",
            lineHeight: 1.1,
          }}
        >
          {c.headline}
        </span>
      </div>
      <div>
        <RankBars
          rows={c.bars.map((b) => ({
            label: b.label,
            value: b.value,
            weight: b.share,
            tone: b.tone,
          }))}
        />
        <p className="callout" style={{ marginTop: 11 }}>
          {c.callout}
        </p>
        <div className="btnrow" style={{ marginTop: 11 }}>
          {c.actions.map((a) => (
            <Link key={a.href} className={a.primary ? "btn btn--primary" : "btn"} href={a.href}>
              {a.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CounterMenuProfitClient({
  params: paramsString,
  stores,
  today,
  sections,
}: {
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: CounterMenuProfitSections
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
  const storeName =
    stores.find((s) => s.id === counterParams.storeId)?.name ?? "All stores"
  const windowLabel = rangeLabel(range, "custom")

  return (
    <>
      <PageHead title="Menu profit" sub={`${storeName} · ${windowLabel}`}>
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
        <Section
          title="Volume against margin"
          meta={(m) => m.meta}
          data={sections.matrix}
          pending={pending}
          askAbout="which items sell well but earn badly"
        >
          {(m) => (
            <>
              <Matrix
                spec={{
                  points: m.points,
                  medianUnits: m.medianUnits,
                  medianMargin: m.medianMargin,
                }}
                axisLabel={m.axisLabel}
              />
              <p className="mono" style={{ margin: "10px 0 0" }}>
                {m.note}
              </p>
            </>
          )}
        </Section>

        <Section
          title="What to do about it"
          meta={(o) => o.meta}
          data={sections.opportunities}
          pending={pending}
        >
          {(o) => <Queue items={o.items} />}
        </Section>
      </div>

      <Section
        title="What these figures did not see"
        meta={(c) => c.meta}
        data={sections.coverage}
        pending={pending}
        askAbout="how much of the menu is only partly costed"
      >
        {(c) => <CoverageBlock c={c} />}
      </Section>

      <Section
        title="Item ledger"
        meta={(l) => l.meta}
        data={sections.ledger}
        pending={pending}
        pad={false}
        askAbout="which items contribute the most"
      >
        {(l) => (
          <>
            <Table columns={LEDGER_COLUMNS} rows={l.rows} />
            {/* No `.sec__body` wrapper — it is a landmark and the prototype's
                `sec(..., tbl(...))` emits the table alone. The note carries the
                body's own inset inline. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {l.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
