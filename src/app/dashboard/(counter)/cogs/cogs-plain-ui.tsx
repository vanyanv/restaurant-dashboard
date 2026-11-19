"use client"

import { useSurfaceHref } from "@/components/counter"
import {
  Answer,
  Freshness,
  BigNumber,
  BigNumbers,
  ButtonLink,
  Card,
  NeedsYou,
  Rows,
  Status,
  Statuses,
  type RowsColumn,
} from "@/components/counter/ui"
import type { CogsPlain, CogsPlainMoveRow } from "@/lib/counter/cogs-plain"

/**
 * Food cost made plain, shared by the desk and the phone and by the group and
 * store pages (mock https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4). Every
 * figure and word arrives from `cogs-plain.ts`; this file only lays it out.
 */
const COLUMNS: RowsColumn<CogsPlainMoveRow>[] = [
  { key: "name", label: "Ingredient", slot: "title", render: (r) => r.name },
  { key: "prices", label: "Price per recipe unit", slot: "detail", render: (r) => r.prices },
  { key: "change", label: "Change", slot: "amount", align: "end", render: (r) => r.change },
]

export function CogsPlainView({ p }: { p: CogsPlain }) {
  const href = useSurfaceHref()
  return (
    <div className="cu-stack">
      <Card label="Food cost in a sentence">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber label={p.big.label} value={p.big.value} sub={p.big.sub} vs={p.vs ?? undefined} missing={p.big.missing} />
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
      {p.moved.length > 0 ? (
        <Card caption="What went up">
          <Rows columns={COLUMNS} rows={p.moved} rowKey={(r) => r.key} />
        </Card>
      ) : null}
      {p.invoices ? (
        <NeedsYou
          groups={[
            {
              key: "invoices",
              what: p.invoices.what,
              why: "Their prices reach food cost once they are checked.",
              action: (
                <ButtonLink variant="primary" href={href(p.invoices.href)}>
                  Invoices
                </ButtonLink>
              ),
            },
          ]}
        />
      ) : null}
    </div>
  )
}
