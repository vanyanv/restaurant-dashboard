"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import {
  Note,
  PageHead,
  Section,
  SubNav,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import { INVENTORY_TABS } from "@/lib/counter/nav"
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
 *
 * Composed as `P.countnew.desk()` composes it, and no wider: "What to count"
 * -> "The sheet" -> "Then what". There was a verdict block, a four-cell strip
 * and a "Counts already open" table above all three, and this design is a
 * WIZARD — it has no strip at all. Every figure the strip drew was already a
 * clause of the verdict, and the verdict itself is gone: two of its three
 * clauses were already the sheet's note and the button's, and the third — how
 * many counts have ever been finished — is the button's now too, where it
 * belongs. See `NewCountOpen`.
 */
const SHEET_COLUMNS: Column[] = [
  { key: "n", label: "#", numeric: true },
  { key: "ingredient", label: "Ingredient" },
  { key: "category", label: "Category" },
  { key: "unit", label: "Counted in" },
  { key: "last", label: "Last counted" },
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

      {/* The design's `VIEWS` bar for this family — see `INVENTORY_TABS` in
          `nav.ts`. On hand and Counts both draw it; the tab you are standing
          on drew nothing. */}
      <SubNav items={INVENTORY_TABS} label="Inventory" />

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
            <Note>
              {g.note}
            </Note>
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
            <Note flush>
              {s.note}
            </Note>
          </>
        )}
      </Section>

      {/* `P.countnew`'s "Then what", and its handover argument verbatim —
          the reason a desk page exists for a job done on a phone. */}
      <Section title="Then what" meta="the handover" data={sections.open} pending={pending}>
        {(o) => (
          <>
            <p style={{ margin: "0 0 12px", lineHeight: 1.5 }}>
              Counting happens on the phone, one line at a time. The desk is for choosing
              the shape of the count and reading the result — not for typing
              seventy-six numbers into a table.
            </p>
            <div className="btnrow">
              <button
                className="btn btn--primary"
                type="button"
                onClick={begin}
                disabled={busy || targetStoreId === null}
              >
                {busy ? "Opening…" : o.resumes ? "Resume the open count" : "Start on this device"}
              </button>
            </div>
            <Note live tone={problem === null ? undefined : "bad"}>
              {problem === null ? o.note : `Could not open a count: ${problem}.`}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
