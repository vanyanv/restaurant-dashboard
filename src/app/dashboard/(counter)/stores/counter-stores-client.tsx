"use client"

import Link from "next/link"

import {
  Lede,
  Note,
  PageHead,
  Queue,
  Section,
  Strip,
  SubNav,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import { ready } from "@/lib/counter/section-data"
import { storesViewTabs } from "@/lib/counter/nav"
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
  storeId,
}: {
  sections: CounterStoresSections
  storeId: string | null
}) {
  usePageChrome({ askSuggestions: ASK_SUGGESTIONS })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead
        title="Stores"
        sub="Each store carries its own operating inputs, commission rates and COGS target"
      />

      {/* `VIEWS.stores` — see `storesViewTabs` in `nav.ts`. The phone grew this
          bar first; the desk had a "New store" button on the list page and
          nothing at all on the other two, so the create form and the store file
          each sat with no way back to their siblings. Same three tabs, same
          order, one helper. */}
      <SubNav items={storesViewTabs("/dashboard/stores", storeId)} label="Stores" />

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
            <Note flush>
              {t.note}
            </Note>
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

      {/*
        * `P.stores`' "Add a store", naming the fields the form ACTUALLY asks
        * for.
        *
        * This said "four fields to start" and named name, address, rent and a
        * COGS target, under a comment asserting those were "the four the form
        * actually asks for". The form asks for three — name, address, phone —
        * and `/dashboard/stores/new` says so in its own head, so the two pages
        * of one flow disagreed about what starting a store takes. An owner
        * arrived expecting to enter a rent figure and a COGS target, found
        * neither, and was asked for a phone number nobody had mentioned.
        *
        * Rent and the COGS target are real and still needed — they are set on
        * the store's own file afterwards, which is where this page's own
        * "Needs you" sends people. Saying so is better than dropping them:
        * the reader learns the shape of the whole job, not just the form.
        *
        * The three are NOT equally required, and an earlier pass got this
        * wrong by listing them flat. Driven in a browser: "Create the store"
        * is disabled on an empty form and on a whitespace-only name, and
        * enabled the moment a real name is typed — so the name is the only
        * field enforced. The form marks the other two itself, "Recorded now,
        * geocoded later" and "Optional", and this sentence now matches those
        * words rather than outranking them.
        */}
      {/*
        * ALWAYS READY. This block uses none of `sections.table` — its child
        * ignores the argument — and binding it to that section meant the one
        * account that needs it most never saw it: with no stores the table is
        * `empty`, so `Section` replaced the sentence explaining what a store
        * needs, and the primary button under it, with an empty state. The way
        * out survived only as the "New store" tab in the sub-nav.
        *
        * `ready(null)` rather than a `bare` Section, which would drop the
        * panel and its heading along with the gating.
        */}
      <Section title="Add a store" meta="three fields to start" data={ready(null)} pending={pending}>
        {() => (
          <>
            <Lede>
              A store needs a <b>name</b> — it is the only field the form will not let you skip. An{" "}
              <b>address</b> is what turns on weather and event signals once it is geocoded, and a{" "}
              <b>phone</b> number is optional. Its <b>rent</b> and <b>COGS target</b> are set on the
              store&rsquo;s own file, which is where creating one takes you.
            </Lede>
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
