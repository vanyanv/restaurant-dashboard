"use client"

import {
  Answer,
  BigNumber,
  BigNumbers,
  Button,
  ButtonLink,
  Card,
  Freshness,
  openFold,
  Rows,
  Status,
  Statuses,
  type RowsColumn,
} from "@/components/counter/ui"
import type { RecipePlain } from "@/lib/counter/adapters/recipe"

/**
 * One recipe made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 8). The cost and
 * its biggest line come first; editing is one button away. The phone edits on
 * its own page (`editHref`); the desk opens the editor folded below
 * (`editFold`).
 */
type Line = { key: string; label: string; value: string; missing?: boolean; total?: boolean }

const COLUMNS: RowsColumn<Line>[] = [
  { key: "label", label: "Line", slot: "title", render: (r) => (r.total ? <strong>{r.label}</strong> : r.label) },
  {
    key: "value",
    label: "Cost",
    slot: "amount",
    align: "end",
    render: (r) =>
      r.missing ? <Status tone="bad">{r.value}</Status> : r.total ? <strong>{r.value}</strong> : r.value,
  },
]

export function RecipePlainView({
  p,
  editHref,
  editFold,
}: {
  p: RecipePlain
  editHref?: string
  editFold?: string
}) {
  const rows: Line[] = [
    ...p.lines,
    ...(p.rest ? [{ key: "rest", label: `${p.rest.n} more ${p.rest.n === 1 ? "line" : "lines"}`, value: p.rest.value }] : []),
    { key: "total", label: "Per serving", value: p.total, total: true },
  ]
  return (
    <div className="cu-stack">
      <Card label="The recipe in a sentence">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber label={p.big.label} value={p.big.value} sub={p.big.sub} vs={p.vs ?? undefined} />
        </BigNumbers>
      </Card>
      <Statuses>
        {p.statuses.map((s) => (
          <Status key={s.text} tone={s.tone}>
            {s.text}
          </Status>
        ))}
      </Statuses>
      {p.lines.length > 0 ? (
        <Card caption="What one is made of">
          <Rows columns={COLUMNS} rows={rows} rowKey={(r) => r.key} />
        </Card>
      ) : null}
      <div>
        {editHref ? (
          <ButtonLink variant="primary" href={editHref}>
            Edit recipe
          </ButtonLink>
        ) : editFold ? (
          <Button variant="primary" onClick={() => openFold(editFold)}>
            Edit recipe
          </Button>
        ) : null}
      </div>
    </div>
  )
}
