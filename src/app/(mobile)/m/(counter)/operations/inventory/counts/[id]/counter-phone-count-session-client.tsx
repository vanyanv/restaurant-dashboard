"use client"

import { MList, MStrip, Note, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type {
  CountSessionEntry,
  CountSessionSections,
} from "@/lib/counter/adapters/stock-counts"
import { useCountEntry } from "@/lib/counter/use-count-entry"

/**
 * COUNTING, on the surface you count from.
 *
 * This page was handed an `entry` section from the day it was written and
 * rendered nothing from it. So `/m/operations/inventory/count/new` opened a
 * session, pushed the owner here, and here had no box to type a number into —
 * you could start a count on a phone and then not count. That is why "Start
 * the count" on the Counter inventory pages still pointed at the pre-Counter
 * `/m/count`, and why it can stop.
 *
 * The prototype does not draw this. `P.countsession.phone()` shows a CLOSED
 * count — a masthead, two cells and "Biggest gaps" — which is the review, not
 * the walk. The design does say where the typing belongs, in `P.countnew`'s
 * own words: "the desk is for choosing the shape of the count, not for typing
 * 31 numbers into a table". A phone in a walk-in is the other half of that
 * sentence.
 *
 * The rows are `.mli` — the phone's own two-column list, name on the left and
 * the value on the right — with the value slot holding the box instead of a
 * figure. Nothing new is invented for the layout; `.mqty` narrows `.search`
 * from its 214px desk minimum to something that fits beside an ingredient
 * name at 390px, and that is the whole of the CSS.
 */
function PhoneCountEntry({ entry }: { entry: CountSessionEntry }) {
  const { values, saved, setValue, commit, finish, finishing, finishLabel } =
    useCountEntry(entry)

  return (
    <>
      <div className="mlist">
        {entry.rows.map((r) => (
          <div className="mli" key={r.ingredientId}>
            <div>
              <b>{r.name}</b>
              {/*
                * The category is where to find the thing, which is what a
                * reader walking the shelves is actually using this line for.
                * A failed save replaces it, because a line that did not save
                * is the only thing more urgent than where it lives.
                */}
              <span>
                {saved[r.ingredientId] === "failed" ? "not saved — try again" : r.category}
              </span>
            </div>
            <label className="search mqty">
              <input
                type="text"
                inputMode="decimal"
                disabled={!entry.open}
                value={values[r.ingredientId] ?? ""}
                aria-label={`${r.name} counted, in ${r.unit}`}
                placeholder={r.unit}
                onChange={(e) => setValue(r.ingredientId, e.target.value)}
                onBlur={() => commit(r)}
              />
            </label>
          </div>
        ))}
      </div>

      <button
        className="mbtn mbtn--primary"
        type="button"
        disabled={!entry.open || finishing}
        onClick={finish}
      >
        {finishLabel}
      </button>

      <Note>{entry.note}</Note>
    </>
  )
}

/**
 * One count session, on a phone — `P.countsession.phone()`.
 *
 * A masthead, a two-cell strip, the entry list and the lines. The prototype
 * calls its list "Biggest gaps" and sorts by variance; there is no variance in
 * this account to sort by, so it is the lines in the order they were counted,
 * which is the order someone walking the shelves entered them.
 *
 * The variance panel and the worklist are desk-only. Both are arguments about
 * what the count cannot tell you yet, and this surface is the one you hold
 * while counting.
 */
export function CounterPhoneCountSessionClient({
  title,
  sections,
}: {
  title: string
  sections: SectionSources<CountSessionSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      <Section bare title={title} data={sections.head} pending={pending}>
        {(h) => (
          <div>
            <h2 className="mtitle">{h.title}</h2>
            <p className="msub">{h.sub}</p>
          </div>
        )}
      </Section>

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      {/* Above "What was counted", not below it: the box you are filling in
          comes before the record of what you already filled in. */}
      <Section
        title="Count the shelf"
        meta={(e) => e.meta}
        data={sections.entry}
        pending={pending}
      >
        {(e) => <PhoneCountEntry entry={e} />}
      </Section>

      <Section title="What was counted" meta={(l) => l.meta} data={sections.lines} pending={pending}>
        {(l) => (
          <>
            <MList rows={l.phoneRows} />
            <Note>
              {l.note}
            </Note>
          </>
        )}
      </Section>
    </>
  )
}
