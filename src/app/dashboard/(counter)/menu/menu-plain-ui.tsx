"use client"

import { useSurfaceHref } from "@/components/counter"
import {
  Answer,
  BigNumber,
  BigNumbers,
  ButtonLink,
  Card,
  Freshness,
  NeedsYou,
  Rows,
  Status,
  Statuses,
  type RowsColumn,
} from "@/components/counter/ui"
import type { MenuPlain, MenuPlainRank } from "@/lib/counter/menu-plain"

/**
 * The Menu hub made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 1). Every figure
 * and word arrives from `menu-plain.ts`; this file only lays it out.
 */
const COLUMNS: RowsColumn<MenuPlainRank>[] = [
  { key: "name", label: "Item", slot: "title", render: (r) => r.name },
  { key: "note", label: "Why", slot: "detail", render: (r) => r.note ?? "" },
  { key: "value", label: "Kept", slot: "amount", align: "end", render: (r) => r.value },
]

export function MenuPlainView({ p }: { p: MenuPlain }) {
  const href = useSurfaceHref()
  return (
    <div className="cu-stack">
      <Card label="The menu in a sentence">
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
      {p.earners.length > 0 ? (
        <Card caption="Earned the most kept">
          <Rows columns={COLUMNS} rows={p.earners} rowKey={(r) => r.key} />
        </Card>
      ) : null}
      {p.thinnest.length > 0 ? (
        <Card caption="Keeps the least per plate">
          <Rows columns={COLUMNS} rows={p.thinnest} rowKey={(r) => r.key} />
        </Card>
      ) : null}
      <NeedsYou
        groups={p.needs.map((n) => ({
          key: n.key,
          what: n.what,
          why: n.why,
          action: (
            <ButtonLink variant="primary" href={href(n.href)}>
              {n.act}
            </ButtonLink>
          ),
        }))}
      />
    </div>
  )
}
