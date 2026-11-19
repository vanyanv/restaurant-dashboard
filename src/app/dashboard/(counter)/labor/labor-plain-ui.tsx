"use client"

import { Answer, Freshness, BigNumber, BigNumbers, Card, Rows, Status, Statuses, type RowsColumn } from "@/components/counter/ui"
import type { LaborPlain } from "@/lib/counter/labor-plain"

/**
 * Labor made plain, shared by the desk and the phone and by the group and
 * store pages (mock https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4). Every
 * figure and word arrives from `labor-plain.ts`; this file only lays it out.
 */
type Line = LaborPlain["lines"][number]

const COLUMNS: RowsColumn<Line>[] = [
  { key: "label", label: "", slot: "title", render: (r) => r.label },
  { key: "value", label: "", slot: "amount", align: "end", render: (r) => r.value },
]

export function LaborPlainView({ p, title = "Labor in a sentence" }: { p: LaborPlain; title?: string }) {
  return (
    <div className="cu-stack">
      <Card label={title}>
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber
            label={p.big.label}
            value={p.big.value}
            sub={p.big.sub}
            vs={p.vs ?? undefined}
            missing={p.big.missing}
          />
        </BigNumbers>
      </Card>
      {p.statuses.length > 0 ? (
        <Statuses>
          {p.statuses.map((s) => (
            <Status key={s.text} tone={s.tone}>
              {s.text}
            </Status>
          ))}
        </Statuses>
      ) : null}
      <Card caption="The hours and the money">
        <Rows columns={COLUMNS} rows={p.lines} rowKey={(r) => r.key} />
      </Card>
    </div>
  )
}
