"use client"

import Link from "next/link"
import { useSurfaceHref } from "@/components/counter"
import {
  Answer,
  Freshness,
  BigNumber,
  BigNumbers,
  Card,
  Rows,
  Status,
  Statuses,
  type RowsColumn,
} from "@/components/counter/ui"
import { count } from "@/lib/counter/format"
import type { PlainTone, OrderPlain, OrderPlainLine, OrdersPlain, OrdersPlainLatest } from "@/lib/counter/orders-plain"

/**
 * Orders and one order made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4). Every figure and word
 * arrives from `orders-plain.ts`; this file only lays it out. `Rows` is a
 * table on the desk and stacked cards on the phone.
 */

function StatusList({ items }: { items: Array<{ tone: PlainTone; text: string }> }) {
  if (items.length === 0) return null
  return (
    <Statuses>
      {items.map((s) => (
        <Status key={s.text} tone={s.tone}>
          {s.text}
        </Status>
      ))}
    </Statuses>
  )
}

export function OrdersPlainView({ p }: { p: OrdersPlain }) {
  const href = useSurfaceHref()
  const columns: RowsColumn<OrdersPlainLatest>[] = [
    { key: "what", label: "Order", slot: "title", render: (r) => <Link href={href(r.href)}>{r.what}</Link> },
    { key: "sub", label: "Details", slot: "detail", render: (r) => r.sub },
    { key: "ticket", label: "Ticket", slot: "amount", align: "end", render: (r) => r.ticket },
    { key: "net", label: "You keep", slot: "status", align: "end", render: (r) => r.net },
  ]
  return (
    <div className="cu-stack">
      <Card label="Orders in a sentence">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber
            label="Orders"
            value={count(p.orders)}
            sub={p.sub || undefined}
            vs={p.vs ? { change: p.vs.text, tone: p.vs.tone, against: "" } : { change: "", tone: "flat", against: "no comparison set" }}
          />
        </BigNumbers>
      </Card>
      <StatusList items={p.statuses} />
      {p.latest.length > 0 ? (
        <Card caption="Latest orders">
          <Rows columns={columns} rows={p.latest} rowKey={(r) => r.key} />
        </Card>
      ) : null}
    </div>
  )
}

export function OrderPlainView({ p }: { p: OrderPlain }) {
  const columns: RowsColumn<OrderPlainLine>[] = [
    { key: "label", label: "", slot: "title", render: (r) => (r.total ? <b>{r.label}</b> : r.label) },
    { key: "value", label: "", slot: "amount", align: "end", render: (r) => (r.total ? <b>{r.value}</b> : r.value) },
  ]
  return (
    <div className="cu-stack">
      <Card label="This order in a sentence">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber label={p.big.label} value={p.big.value} sub={p.big.sub || undefined} missing={p.big.missing} />
        </BigNumbers>
      </Card>
      <StatusList items={p.statuses} />
      <Card caption="Where the money went">
        <Rows columns={columns} rows={p.lines} rowKey={(r) => r.key} />
      </Card>
    </div>
  )
}
