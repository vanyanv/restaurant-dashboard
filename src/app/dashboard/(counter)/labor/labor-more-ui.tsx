"use client"

import { Answer, BarRows, Card, ChartKey, Rows, Status, type RowsColumn } from "@/components/counter/ui"
import type { LeakRowView, LeaksSection } from "@/lib/counter/adapters/labor"
import type { LaborClockView, LaborHoursView, LaborPeopleView, LaborPersonRow } from "@/lib/counter/labor-crew"

/**
 * The Labor page's Hours, People and Time clock tabs. Shared blocks only.
 * Its own file so `LaborDetail` can load it when one of those tabs is
 * opened, and not with the page.
 */

/** The day after the range, hour by hour: people on the schedule against forecast orders. */
export function LaborHoursBlock({ h }: { h: LaborHoursView }) {
  return (
    <div className="cu-stack">
      <Card as="section" label="Hours of the day" caption={`Hours of the day · ${h.day}`}>
        <Answer>{h.sentence}</Answer>
        <ChartKey items={[{ kind: "fill", label: "people on the schedule" }]} />
        <BarRows
          rows={h.rows.map((r) => ({
            key: r.key,
            title: r.title,
            value: r.value,
            fill: r.fill,
            detail: r.detail,
            tag: r.tight ? "tightest hour" : undefined,
          }))}
        />
        <p className="cu-note">{h.note}</p>
      </Card>
    </div>
  )
}

const PERSON_COLUMNS: RowsColumn<LaborPersonRow>[] = [
  { key: "name", label: "Person", slot: "title", render: (r) => r.name },
  { key: "shifts", label: "Shifts", slot: "detail", render: (r) => (r.store ? `${r.shifts} · ${r.store}` : r.shifts) },
  { key: "hours", label: "Scheduled", slot: "amount", align: "end", render: (r) => r.hours },
  {
    key: "records",
    label: "To look at",
    slot: "status",
    render: (r) =>
      r.over || r.records ? (
        <Status plain tone={r.over ? "warn" : "wait"}>
          {[r.over, r.records].filter(Boolean).join(" · ")}
        </Status>
      ) : null,
  },
]

/** Each person's published hours, and who is past 40 hours or has a punch flagged. */
export function LaborPeopleBlock({ p }: { p: LaborPeopleView }) {
  return (
    <div className="cu-stack">
      <Card as="section" label="People" caption="People · published schedule">
        <Answer>{p.sentence}</Answer>
        <Rows columns={PERSON_COLUMNS} rows={p.rows} rowKey={(r) => r.key} />
        <p className="cu-note">{p.note}</p>
      </Card>
    </div>
  )
}

/** Missed punches, store by store. */
export function LaborClockBlock({ c }: { c: LaborClockView }) {
  return (
    <div className="cu-stack">
      <Card as="section" label="Missed punches" caption="Missed punches">
        <Answer>{c.sentence}</Answer>
        <BarRows rows={c.stores.map((s) => ({ key: s.key, title: s.name, value: s.value, fill: s.fill, detail: s.detail }))} />
        <p className="cu-note">{c.note}</p>
      </Card>
    </div>
  )
}

const LEAK_COLUMNS: RowsColumn<LeakRowView>[] = [
  { key: "leak", label: "What happened", slot: "title", render: (r) => r.leak },
  { key: "alerts", label: "Times", slot: "detail", render: (r) => `${r.alerts} ${r.alerts === "1" ? "time" : "times"} · ${r.people} ${r.people === "1" ? "person" : "people"}` },
  { key: "hours", label: "Hours", slot: "status", align: "end", render: (r) => r.hours },
  { key: "cost", label: "Cost", slot: "amount", align: "end", render: (r) => r.cost },
]

/**
 * Early and late minutes, in hours and dollars: the leak ledger's own rows.
 * Only the rows the crew was paid for outside the schedule: clocking in late
 * and leaving early ran the other way and are not a cost, and the rows with
 * no duration are missed punches, in the card above. The ledger's note
 * accounts for both.
 */
export function LaborMinutesBlock({ l }: { l: LeaksSection }) {
  const rows = l.rows.filter((r) => r.kind === "leak")
  return (
    <div className="cu-stack">
      <Card as="section" label="Early and late minutes" caption="Early and late minutes">
        {rows.length > 0 ? <Rows columns={LEAK_COLUMNS} rows={rows} rowKey={(r) => r.key} /> : null}
        <p className="cu-note">
          Paid for outside the schedule: {l.total.hours}, {l.total.cost}. {l.note}
        </p>
      </Card>
    </div>
  )
}
