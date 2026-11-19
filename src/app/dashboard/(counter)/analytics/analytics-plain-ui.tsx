"use client"

import { Answer, Freshness, BigNumber, BigNumbers, Card, Rows, type RowsColumn } from "@/components/counter/ui"
import type { AnalyticsPlain, AnalyticsPlainChannel } from "@/lib/counter/analytics-plain"

/**
 * Analytics made plain, shared by the desk and the phone and by the group and
 * store pages (mock https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4). Every
 * figure and word arrives from `analytics-plain.ts`; this file only lays it out.
 */
const COLUMNS: RowsColumn<AnalyticsPlainChannel>[] = [
  { key: "name", label: "Channel", slot: "title", render: (r) => r.name },
  { key: "share", label: "Share", slot: "detail", align: "end", render: (r) => r.share },
  { key: "sales", label: "Sales", slot: "amount", align: "end", render: (r) => r.sales },
]

export function AnalyticsPlainView({ p }: { p: AnalyticsPlain }) {
  return (
    <div className="cu-stack">
      <Card label="Where sales came from">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber label={p.big.label} value={p.big.value} vs={p.vs ?? undefined} />
        </BigNumbers>
      </Card>
      {p.channels.length > 0 ? (
        <Card caption="By channel">
          <Rows columns={COLUMNS} rows={p.channels} rowKey={(r) => r.key} />
        </Card>
      ) : null}
    </div>
  )
}
