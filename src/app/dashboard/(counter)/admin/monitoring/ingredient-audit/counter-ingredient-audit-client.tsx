"use client"

import {
  Note,
  PageHead,
  Section,
  Strip,
  SubNav,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import { MONITORING_TABS } from "@/lib/counter/nav"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { AuditSections } from "@/lib/counter/adapters/monitoring-ingredients"

/**
 * Ingredient audit — `P.moningredients`.
 *
 * The prototype's note is right about where this belongs: *"This used to sit
 * on the owner's pantry, where its scores and model reasoning were three
 * hundred pixels of diagnostics above the ledger."* It is a developer page,
 * and it CLOSES with a sentence — the prototype's trailing `<p class="mono">`
 * — because its two headline metrics, a held rate and a revert rate, cannot be
 * computed on this account. See the adapter.
 *
 * Composed as `P.moningredients.desk()` composes it: strip -> "The audit" ->
 * "Auto-match decisions" -> that closing paragraph. TWO tables, not four.
 * "Not ingredients" is the audit table's State column now, which is exactly
 * what the prototype's own State column is for ("Component, uncosted"), and
 * the unmatched queue is a strip cell and a sentence — also where the design
 * puts it ("Unmatched · 128 · $4,120 of spend uncosted").
 */

/** `P.moningredients`' own audit columns, State included. */
const CANONICAL_COLUMNS: Column[] = [
  { key: "canonical", label: "Canonical ingredient" },
  { key: "spellings", label: "Spellings", numeric: true },
  { key: "skus", label: "SKUs", numeric: true },
  { key: "recipes", label: "Recipes", numeric: true },
  { key: "spend", label: "Spend", numeric: true },
  { key: "state", label: "State" },
]

const DECISION_COLUMNS: Column[] = [
  { key: "when", label: "When" },
  { key: "printed", label: "As printed" },
  { key: "matched", label: "Matched to" },
  { key: "confidence", label: "Score", numeric: true },
  { key: "rung", label: "Rung" },
  { key: "outcome", label: "Outcome" },
]

export function CounterIngredientAuditClient({
  sections,
}: {
  sections: SectionSources<AuditSections>
}) {
  usePageChrome({
    leaf: "Ingredient audit",
    askSuggestions: [
      "Has anything been auto-matched?",
      "Which ingredients are not ingredients?",
    ],
  })
  const { pending } = useCounterTransition()

  return (
    <>
      <PageHead
        title="Ingredient audit"
        sub="Developer-facing · what the matcher decided"
      >
        {/* `viewTabs()` — the eight tabs are chrome on every one of
            them, not a table of links on the first. */}
        <SubNav items={MONITORING_TABS} label="Monitoring" />
      </PageHead>

      <Section bare title="The figures" data={sections.headline} pending={pending}>
        {(h) => <Strip cells={h.cells} />}
      </Section>

      <Section
        title="The audit"
        meta={(c) => c.meta}
        data={sections.canonicals}
        pending={pending}
        pad={false}
        askAbout="which ingredients have the most spellings"
      >
        {(c) => (
          <>
            <Table columns={CANONICAL_COLUMNS} rows={c.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <Note flush>
              {c.note}
            </Note>
          </>
        )}
      </Section>

      <Section
        title="What the ladder decided"
        meta={(d) => d.meta}
        data={sections.decisions}
        pending={pending}
        pad={false}
        askAbout="has anything been auto-matched"
      >
        {(d) => (
          <>
            <Table columns={DECISION_COLUMNS} rows={d.rows} />
            <Note flush>
              {d.note}
            </Note>
          </>
        )}
      </Section>

      {/* `P.moningredients`'s trailing `<p class="mono">`, outside any
          section. This was a verdict block inside a `.sec` until the page was
          measured against its design, which has no verdict panel here — and
          the sentence reads the same at the foot as it did at the head. */}
      <Section bare title="Verdict" data={sections.headline} pending={pending}>
        {(h) => (
          <Note tight>
            {h.verdict}
          </Note>
        )}
      </Section>
    </>
  )
}
