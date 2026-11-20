"use client"

import {
  Answer,
  BigNumber,
  BigNumbers,
  Card,
  Freshness,
  Rows,
  Status,
  type RowsColumn,
} from "@/components/counter/ui"
import type { MixPlain } from "@/lib/counter/adapters/product-mix"

/**
 * Menu > Mix made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 6). Every figure
 * and word arrives from the product-mix adapter's `plain` section.
 */
type BridgeRow = MixPlain["bridge"][number]
type MovedRow = MixPlain["moved"][number]

const BRIDGE: RowsColumn<BridgeRow>[] = [
  { key: "label", label: "What moved it", slot: "title", render: (r) => (r.total ? <strong>{r.label}</strong> : r.label) },
  { key: "value", label: "Kept share", slot: "amount", align: "end", render: (r) => (r.total ? <strong>{r.value}</strong> : r.value) },
]

const MOVED: RowsColumn<MovedRow>[] = [
  { key: "name", label: "Item", slot: "title", render: (r) => r.name },
  {
    key: "change",
    label: "Change",
    slot: "status",
    align: "end",
    render: (r) => <Status tone={r.up ? "good" : "warn"}>{r.change}</Status>,
  },
]

export function MixPlainView({ p }: { p: MixPlain }) {
  return (
    <div className="cu-stack">
      <Card label="Product mix in a sentence">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber label={p.big.label} value={p.big.value} sub={p.big.sub} vs={p.vs ?? undefined} />
        </BigNumbers>
      </Card>
      {p.bridge.length > 0 ? (
        <Card caption="Why the kept share moved">
          <Rows columns={BRIDGE} rows={p.bridge} rowKey={(r) => r.key} />
        </Card>
      ) : null}
      {p.moved.length > 0 ? (
        <Card caption="Moved most">
          <Rows columns={MOVED} rows={p.moved} rowKey={(r) => r.key} />
        </Card>
      ) : null}
    </div>
  )
}
