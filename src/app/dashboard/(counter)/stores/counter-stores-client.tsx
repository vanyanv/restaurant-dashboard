"use client"

import Link from "next/link"

import {
  PageHead,
  Queue,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { StoresSections } from "@/lib/counter/adapters/stores"

/**
 * Stores, composed from `P.stores.desk()`:
 *
 *   strip -> the operating files -> the worklist.
 *
 * No `DateControl` — `P.stores` sets `nodate: true` and it is right: these are
 * standing inputs, and a date range cannot narrow a rent.
 *
 * `Blended prime · 56.2%` is dropped from the strip. It is the P&L's figure,
 * and this page would be the second place it is computed. The cell goes to
 * commission rates, which nothing else in the product reports and which decide
 * the second largest line on that statement.
 *
 * `Add a store` is BACK, and the argument for dropping it was wrong in a way
 * worth writing down. It read: "a panel whose only content is a link to a page
 * is a link" — true, except there was no link. `/dashboard/stores/new` was
 * referenced from exactly one place in the tree, `app-sidebar.tsx`, which
 * belongs to the retired editorial shell and is not rendered on a Counter
 * page. The form was built, gated and reachable only by typing its URL. The
 * design put an entrance here for a reason.
 */
export type CounterStoresSections = SectionSources<StoresSections>

const STORE_COLUMNS: Column[] = [
  { key: "store", label: "Store" },
  { key: "status", label: "Status" },
  { key: "rent", label: "Rent / mo", numeric: true },
  { key: "fixed", label: "Fixed / mo", numeric: true },
  { key: "target", label: "COGS target", numeric: true },
  { key: "commissions", label: "Commissions" },
]

const ASK_SUGGESTIONS = [
  "Which stores have no rent on file?",
  "What commission rates am I using?",
  "What does each store carry in fixed cost?",
]

export function CounterStoresClient({
  sections,
}: {
  sections: CounterStoresSections
}) {
  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead
        title="Stores"
        sub="Each store carries its own operating inputs, commission rates and COGS target"
      />

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="Store operating files"
        meta={(t) => t.meta}
        data={sections.table}
        pending={pending}
        pad={false}
        askAbout="what commission rates am I using"
      >
        {(t) => (
          <>
            <Table columns={STORE_COLUMNS} rows={t.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {t.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Needs you"
        meta={(w) => w.meta}
        data={sections.work}
        pending={pending}
        askAbout="which stores have no rent on file"
      >
        {(w) => <Queue items={w.items} />}
      </Section>

      {/* `P.stores`' "Add a store", and the four fields it names are the four
          the form actually asks for. */}
      <Section title="Add a store" meta="four fields to start" data={sections.table} pending={pending}>
        {() => (
          <>
            <p style={{ margin: "0 0 12px", fontSize: "var(--ct-t-mid)", lineHeight: 1.5 }}>
              A store needs a <b>name</b>, an <b>address</b> for weather and event signals, a{" "}
              <b>rent</b> figure and a <b>COGS target</b>. Everything else can wait.
            </p>
            <div className="btnrow">
              <Link className="btn btn--primary" href="/dashboard/stores/new">
                New store
              </Link>
            </div>
          </>
        )}
      </Section>
    </>
  )
}
