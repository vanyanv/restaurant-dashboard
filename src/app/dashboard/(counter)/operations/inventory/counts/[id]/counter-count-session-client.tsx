"use client"

import { useState } from "react"

import {
  Kv,
  Note,
  PageHead,
  Queue,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
  type Row,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  CountSessionEntry,
  CountSessionEntryRow,
  CountSessionSections,
} from "@/lib/counter/adapters/stock-counts"
import { useCountEntry } from "@/lib/counter/use-count-entry"

/**
 * One count session — `P.countsession`.
 *
 * No `DateControl`: a count happened at a time, and a range cannot narrow one.
 * The `Variance` section is the list page's own, unchanged — the reason a
 * variance cannot be stated is a property of the account rather than of this
 * session, and telling it differently in two places would be two explanations
 * of one absence.
 */
const LINE_COLUMNS: Column[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "native", label: "Counted as", numeric: true },
  { key: "qty", label: "In recipe units", numeric: true },
  { key: "cost", label: "Unit cost", numeric: true },
  { key: "value", label: "Value", numeric: true },
]


const ENTRY_COLUMNS: Column[] = [
  { key: "ingredient", label: "Ingredient" },
  { key: "category", label: "Where" },
  // STILL no "Expected" column — but no longer for the reason this comment
  // used to give. The 180-second measurement was of the PER-INGREDIENT walk;
  // since 2026-09-20 `loadCountEntry` computes every expectation in six
  // store-wide queries and `row.estimate` arrives here populated. Adding the
  // column is a render change, and `npm run fidelity` — the only gate that
  // can see one — needs a dev server and a database. So it waits for a run,
  // not for a measurement. Until then the number is carried down with each
  // save and shown to nobody.
  { key: "counted", label: "On the shelf", numeric: true },
]

/**
 * ENTERING THE COUNT — the input this page never had.
 *
 * `beginStockCount` has been wired since the Counter inventory pages were
 * built, and it pushes the owner straight here. This page rendered the lines
 * of a count, its value, its variance and a worklist, and carried nowhere to
 * type a number: you could START a count and then not count anything. That is
 * worse than a missing feature because it looks like a working one, and this
 * account's three attempts — all in May, the fullest ten lines of soda syrup —
 * are what a flow that dead-ends leaves behind.
 *
 * ## SAVING ON BLUR, NOT ON A BUTTON
 *
 * `saveStockCountLine` upserts on (count, ingredient), so re-entering a number
 * corrects it instead of doubling it. That is what makes per-box saving safe,
 * and per-box saving is what a count actually needs: someone walking a
 * walk-in with a phone or a laptop should never lose twenty lines because the
 * page reloaded before they reached a Save button at the bottom of seventy-six
 * ingredients.
 *
 * ## NO EXPECTED COLUMN YET — AND THE OLD REASON NO LONGER HOLDS
 *
 * The model's expected on-hand belongs beside the box — it catches a 4 typed
 * where 40 belongs, and the gap between the two is the training signal for
 * the on-hand model. This docblock used to say it was absent because
 * computing it cost the page three minutes to open. That was true of the
 * per-ingredient walk and is no longer true of anything: `loadCountEntry`
 * takes every expectation at `StockCount.startedAt` through
 * `loadStoreInventoryContext`, six store-wide queries however many
 * ingredients there are, and `row.estimate` is populated by the time this
 * component renders. It travels back down on every save and feeds the
 * calibration.
 *
 * What is left is that adding a column changes what this page RENDERS, and
 * the only gate that can see a render change is `npm run fidelity`, which
 * needs a dev server on :3000 and a live database. So the column is a
 * deliberate omission pending that run, not a performance trade — and until
 * it lands, the entry note's "N of M ingredients also record what was
 * expected" is telling the counter about a number this page does not show
 * them. The phone twin
 * (`src/app/(mobile)/m/(counter)/operations/inventory/counts/[id]/`) is in
 * exactly the same position and should gain it in the same change.
 *
 * ## CLOSING IS WHAT MAKES IT COUNT
 *
 * `StockCount.status` has never once been COMPLETED on this account, and the
 * on-hand model calibrates on COMPLETED counts. Every count ever taken here
 * has therefore been invisible to the thing it exists to feed. The button is
 * the point of the section, not an afterthought at the end of it.
 *
 * The state machine moved to `useCountEntry` when the PHONE needed the same
 * one — see that hook for the saving rules. What is left here is the desk's
 * shape for it, a table, which is the only part that should differ.
 */
function CountEntry({ entry }: { entry: CountSessionEntry }) {
  const { values, saved, setValue, commit, finish, finishing, finishLabel, finishError } =
    useCountEntry(entry)

  const rows: Row[] = entry.rows.map((r) => ({
    key: r.ingredientId,
    cells: {
      ingredient: r.name,
      category: r.category,
      counted: (
        <label className="search">
          <input
            type="text"
            inputMode="decimal"
            disabled={!entry.open || finishing}
            value={values[r.ingredientId] ?? ""}
            aria-label={`${r.name} counted, in ${r.unit}`}
            placeholder={r.unit}
            onChange={(e) => setValue(r.ingredientId, e.target.value)}
            onBlur={() => commit(r)}
          />
          {saved[r.ingredientId] === "failed" ? <span className="k"> not saved</span> : null}
        </label>
      ),
    },
  }))

  return (
    <>
      <Table columns={ENTRY_COLUMNS} rows={rows} />
      <div className="sec__body">
        <div className="btnrow">
          <button
            className="btn btn--primary"
            type="button"
            disabled={!entry.open || finishing}
            onClick={finish}
          >
            {finishLabel}
          </button>
        </div>
        {finishError ? <p role="alert">{finishError}</p> : null}
        <Note>{entry.note}</Note>
      </div>
    </>
  )
}

const ASK_SUGGESTIONS = [
  "What was counted in this session?",
  "Why does this count have no variance?",
]

export function CounterCountSessionClient({
  title,
  sections,
}: {
  title: string
  sections: SectionSources<CountSessionSections>
}) {
  usePageChrome({ leaf: title, askSuggestions: ASK_SUGGESTIONS })

  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead title={title} sub="Stock count" />

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => (
          <>
            <Note lede>
              {h.sub}
            </Note>
            <Strip cells={h.cells} />
          </>
        )}
      </Section>

      <Section
        title="What was counted"
        meta={(l) => l.meta}
        data={sections.lines}
        pending={pending}
        pad={false}
        askAbout="what was counted in this session"
      >
        {(l) => (
          <>
            <Table columns={LINE_COLUMNS} rows={l.rows} />
            {/* No `.sec__body` — `P.countsession`'s Lines section is a table
                and nothing else, and the counted-stock total this used to
                repeat here is the strip's second cell. */}
            <Note flush>
              {l.note}
            </Note>
          </>
        )}
      </Section>

      {/* `P.countsession`'s "What it taught the model" — same shape, a
          paragraph and a `.kv`, and the same subject: this one lists what a
          calibration would need instead of what it learned. */}
      <Section title="Variance" meta={(v) => v.meta} data={sections.variance} pending={pending}>
        {(v) => (
          <>
            <p className="ans__lead" style={{ margin: "0 0 14px" }}>
              {v.lead}
            </p>
            <Kv rows={v.rows} />
            <Note>
              {v.note}
            </Note>
          </>
        )}
      </Section>

      {/* `P.countsession`'s "What to do". Its own item is a variance pattern
          across counts, which needs an expected quantity; ours is about the
          session itself. See `CountSessionWork`. */}
      <Section title="What to do" meta={(w) => w.meta} data={sections.work} pending={pending}>
        {(w) => <Queue items={w.items} />}
      </Section>

      {/* The clipboard. `P.countsession` has no such section — it draws a
          count that has already happened — and the manifest carries the
          allowance arguing why this one does. See `CountEntry`. */}
      <Section
        title="Entering the count"
        meta={(e) => e.meta}
        data={sections.entry}
        pending={pending}
        pad={false}
      >
        {(e) => <CountEntry entry={e} />}
      </Section>
    </>
  )
}
