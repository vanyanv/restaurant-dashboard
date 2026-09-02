"use client"

import Link from "next/link"
import { DeskHandoff, MList, MStrip, Note, Section, useCounterTransition } from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { StoreFileSections } from "@/lib/counter/adapters/stores"

/**
 * One store's file, on a phone — `P.storecosts.phone()`.
 *
 * A masthead, a two-cell strip, the four operating inputs, the fixed expense
 * lines, and one button. The desk's prorating arithmetic, its location file,
 * its commission rates, its targets and its "where it lands" map are all
 * desk-only: `P.storecosts.phone()` leaves every one of them out, and they are
 * the parts you read to understand the number rather than to check it.
 *
 * The button is a LINK to the desk file rather than a save. The prototype's is
 * "Save inputs", and editing four currency fields on a phone is the thing this
 * design says elsewhere it does not want — `P.countnew`'s own words are "the
 * desk is for choosing the shape of the count, not for typing 31 numbers into
 * a table". Six currency fields are the same argument. A button that opens the
 * place you can edit is honest; one that saves fields this surface does not
 * show would be a lie.
 */
export function CounterPhoneStoreFileClient({
  sections,
}: {
  sections: SectionSources<StoreFileSections>
}) {
  const { pending } = useCounterTransition()

  return (
    <>
      {/* The page's own NAME is a constant, so it is drawn in every state.
          Inside the section it was not: a failed headline left this phone
          page with no title at all, showing "Store file unavailable" where
          its name belongs. Only the sub-line needs the data. Same rule the
          desk states on /dashboard/decisions — "the head is drawn in every
          state, including before that data exists". `Section bare` emits no
          DOM of its own, so the ready-state markup is unchanged. */}
      <div>
        <h2 className="mtitle">Store file</h2>
        <Section bare title="Store file" data={sections.head} pending={pending}>
          {(h) => (
            <p className="msub">{h.sub}</p>
          )}
        </Section>
      </div>

      <Section bare title="The figures" data={sections.head} pending={pending}>
        {(h) => <MStrip cells={h.phoneCells} />}
      </Section>

      <Section
        title="The four inputs"
        meta={() => "the ones the P&L expects"}
        data={sections.operating}
        pending={pending}
      >
        {(o) => (
          <>
            <MList
              rows={o.rows.map((r) => ({
                key: r.key,
                title: r.label,
                detail: r.note ?? "",
                value: r.unitLeads ? `${r.unit}${r.value}` : `${r.value}${r.unit}`,
              }))}
            />
            <Note>
              {o.note}
            </Note>
          </>
        )}
      </Section>

      <Section
        title="Fixed expenses"
        meta={(e) => e.meta}
        data={sections.expenses}
        pending={pending}
      >
        {(e) => <MList rows={e.phoneRows} />}
      </Section>

      {/* `P.storecosts.phone()`'s closing `.mbtn`, outside every section. It
          was a `<Link>` to the desk file and could not work: the proxy sends a
          phone straight back off `/dashboard/**`, so it landed where it
          started. `DeskHandoff` sets `prefer-desktop` first. */}
      <Section bare title="Edit" data={sections.head} pending={pending}>
        {(h) => (
          <DeskHandoff href={`/dashboard/stores/${h.storeId}`}>
            Edit this file on the desk
          </DeskHandoff>
        )}
      </Section>
    </>
  )
}
