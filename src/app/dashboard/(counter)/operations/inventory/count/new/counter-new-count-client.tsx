"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import { beginStockCount } from "@/lib/counter/actions/stock-count"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { NewCountSections } from "@/lib/counter/adapters/new-count"

/**
 * Start a count — `P.newcount`.
 *
 * The prototype's shape is kept: choose what to count, read the sheet, then
 * hand over to the phone. Its own words for the handover are the reason the
 * desk page exists at all, and are kept verbatim below — *"the desk is for
 * choosing the shape of the count and reading the result, not for typing 31
 * numbers into a table."*
 *
 * What is not kept is the four room toggles, because no room exists in this
 * data. See the adapter.
 */
const SHEET_COLUMNS: Column[] = [
  { key: "n", label: "#", numeric: true },
  { key: "ingredient", label: "Ingredient" },
  { key: "category", label: "Category" },
  { key: "unit", label: "Counted in" },
  { key: "last", label: "Last counted" },
]

const OPEN_COLUMNS: Column[] = [
  { key: "store", label: "Store" },
  { key: "started", label: "Started" },
  { key: "age", label: "Age" },
  { key: "lines", label: "Lines entered", numeric: true },
]

export function CounterNewCountClient({
  sections,
  targetStoreId,
}: {
  sections: SectionSources<NewCountSections>
  targetStoreId: string | null
}) {
  usePageChrome({
    leaf: "Start a count",
    askSuggestions: ["When was the last stock count?", "What is on the count sheet?"],
  })
  const { pending } = useCounterTransition()
  const router = useRouter()
  const [busy, startBusy] = useTransition()
  const [problem, setProblem] = useState<string | null>(null)
  // Categories left out of the count. Absent from the set means counted —
  // a fresh page counts everything, which is what a first count should do.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())

  function toggle(category: string) {
    setSkipped((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  function begin() {
    if (targetStoreId === null) return
    setProblem(null)
    startBusy(async () => {
      const result = await beginStockCount({ storeId: targetStoreId })
      if (!result.ok) {
        setProblem(result.error)
        return
      }
      router.push(`/dashboard/operations/inventory/counts/${result.stockCountId}`)
    })
  }

  return (
    <>
      <PageHead
        title="Start a count"
        sub="Choose the shape of the count here; count it on the phone"
      />

      <Section bare title="Verdict" data={sections.headline} pending={pending}>
        {(h) => (
          <div className="sec">
            <div className="sec__body">
              <p className="verdictline" style={{ margin: 0 }}>
                {h.verdict}
              </p>
            </div>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="Counts already open"
        meta={(o) => o.meta}
        data={sections.open}
        pending={pending}
        pad={false}
        askAbout="which stock counts are still open"
      >
        {(o) => (
          <>
            <Table columns={OPEN_COLUMNS} rows={o.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {o.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="What to count"
        meta={(g) => g.meta}
        data={sections.groups}
        pending={pending}
        askAbout="what is on the count sheet"
      >
        {(g) => (
          <>
            {g.groups.map((group) => {
              const on = !skipped.has(group.category)
              return (
                <div className="setrow" key={group.category}>
                  <div className="tx">
                    <b>{group.category}</b>
                    <span>
                      {group.lines} {group.lines === 1 ? "line" : "lines"} ·{" "}
                      {group.inRecipe} in a recipe · {group.everCounted} counted before
                    </span>
                  </div>
                  <button
                    className="sw"
                    type="button"
                    aria-pressed={on}
                    aria-label={`Count ${group.category}`}
                    onClick={() => toggle(group.category)}
                  >
                    <i />
                  </button>
                </div>
              )
            })}
            <p className="mono" style={{ margin: "10px 0 0" }}>
              {g.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="The sheet"
        meta={(s) => s.meta}
        data={sections.sheet}
        pending={pending}
        pad={false}
      >
        {(s) => (
          <>
            <Table columns={SHEET_COLUMNS} rows={s.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {s.note}
            </p>
          </>
        )}
      </Section>

      <Section bare title="Then what" data={sections.open} pending={pending}>
        {(o) => (
          <div className="sec">
            <div className="sec__head">
              <h2>Then what</h2>
              <span className="meta">the handover</span>
            </div>
            <div className="sec__body">
              <p style={{ margin: "0 0 12px", lineHeight: 1.5 }}>
                Counting happens on the phone, one line at a time. The desk is for
                choosing the shape of the count and reading the result — not for typing
                seventy-six numbers into a table.
              </p>
              <div className="btnrow">
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={begin}
                  disabled={busy || targetStoreId === null}
                >
                  {busy
                    ? "Opening…"
                    : o.resumes
                      ? "Resume the open count"
                      : "Start on this device"}
                </button>
              </div>
              <p className="mono" style={{ margin: "10px 0 0" }}>
                {problem === null
                  ? "There is no send-to-phone and no print. Neither exists behind the prototype's other two buttons, and a button that does nothing is worse than one that is absent."
                  : `Could not open a count: ${problem}.`}
              </p>
            </div>
          </div>
        )}
      </Section>
    </>
  )
}
