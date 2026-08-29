"use client"

import {
  PageHead,
  Section,
  Strip,
  Table,
  useCounterTransition,
  usePageChrome,
  type Column,
} from "@/components/counter"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { AuditSections } from "@/lib/counter/adapters/monitoring-ingredients"

/**
 * Ingredient audit — `P.moningredients`.
 *
 * The prototype's note is right about where this belongs: *"This used to sit
 * on the owner's pantry, where its scores and model reasoning were three
 * hundred pixels of diagnostics above the ledger."* It is a developer page,
 * and it opens with a sentence because its two headline metrics — a held rate
 * and a revert rate — cannot be computed on this account. See the adapter.
 */
const CHARGE_COLUMNS: Column[] = [
  { key: "canonical", label: "Canonical ingredient" },
  { key: "recipes", label: "Recipes", numeric: true },
  { key: "lines", label: "Invoice lines", numeric: true },
  { key: "spellings", label: "Spellings", numeric: true },
  { key: "spend", label: "Spend", numeric: true },
]

const DECISION_COLUMNS: Column[] = [
  { key: "when", label: "When" },
  { key: "printed", label: "As printed" },
  { key: "matched", label: "Matched to" },
  { key: "confidence", label: "Score", numeric: true },
  { key: "rung", label: "Rung" },
  { key: "outcome", label: "Outcome" },
]

const UNMATCHED_COLUMNS: Column[] = [
  { key: "vendor", label: "Vendor" },
  { key: "sku", label: "SKU" },
  { key: "printed", label: "As printed" },
  { key: "spend", label: "Spend", numeric: true },
  { key: "why", label: "Why" },
]

const CANONICAL_COLUMNS: Column[] = [
  { key: "canonical", label: "Canonical ingredient" },
  { key: "spellings", label: "Spellings", numeric: true },
  { key: "skus", label: "SKUs", numeric: true },
  { key: "recipes", label: "Recipes", numeric: true },
  { key: "spend", label: "Spend", numeric: true },
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
        title="Not ingredients"
        meta={(c) => c.meta}
        data={sections.charges}
        pending={pending}
        pad={false}
        askAbout="which canonical ingredients are not ingredients"
      >
        {(c) => (
          <>
            <Table columns={CHARGE_COLUMNS} rows={c.rows} />
            {/* No `.sec__body` — a table section emits the table alone. */}
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {c.note}
            </p>
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
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {d.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Still unmatched"
        meta={(u) => u.meta}
        data={sections.unmatched}
        pending={pending}
        pad={false}
        askAbout="which invoice lines are still unmatched"
      >
        {(u) => (
          <>
            <Table columns={UNMATCHED_COLUMNS} rows={u.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {u.note}
            </p>
          </>
        )}
      </Section>

      <Section
        title="Spellings held together"
        meta={(c) => c.meta}
        data={sections.canonicals}
        pending={pending}
        pad={false}
        askAbout="which ingredients have the most spellings"
      >
        {(c) => (
          <>
            <Table columns={CANONICAL_COLUMNS} rows={c.rows} />
            <p className="mono" style={{ margin: 0, padding: "13px 15px" }}>
              {c.note}
            </p>
          </>
        )}
      </Section>
    </>
  )
}
