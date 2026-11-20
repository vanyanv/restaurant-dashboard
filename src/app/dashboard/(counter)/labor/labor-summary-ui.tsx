"use client"

import { useState, type ReactNode } from "react"
import { Section } from "@/components/counter"
import { Answer, BarRows, Card, ChartKey, Compare, Rows, SplitBars, Status, StoreCard, StoreCardGrid, Tabs, type RowsColumn } from "@/components/counter/ui"
import type { LaborSections, LeakRowView, LeaksSection } from "@/lib/counter/adapters/labor"
import type { LaborClockView, LaborHoursView, LaborPeopleView, LaborPersonRow } from "@/lib/counter/labor-crew"
import type { SectionSources } from "@/lib/counter/adapters/types"
import { parseIsoDay, type DateRange } from "@/lib/counter/date-range"
import { compareLaborWeeks, type LaborSummary, type LaborWeeksView } from "@/lib/counter/labor-summary"

/**
 * The Labor page's detail, shared by the desk and the phone and by the group
 * and store pages (mock https://claude.ai/artifact/VVoyXKUEykrCL6MK5K78ms).
 * Every figure, word and bar length arrives from `labor-summary.ts`. Every
 * piece drawn is a shared block (`@/components/counter/ui`): this file only
 * hands them their rows and keeps two pieces of state, the open tab and
 * which two weeks are side by side. There is no stylesheet of its own.
 */

/**
 * Each day's share, the stores side by side, and the cost by role. `show`
 * picks the half a tab draws; left out, all of it is drawn.
 */
export function LaborDetailView({
  s,
  onStore,
  show,
}: {
  s: LaborSummary
  onStore?: (storeId: string) => void
  show?: "days" | "stores"
}) {
  const days = show !== "stores"
  const rest = show !== "days"
  return (
    <div className="cu-stack">
      {days && s.days.length > 0 ? (
        <Card as="section" label="Each day" caption="Each day">
          <ChartKey
            items={[
              { kind: "fill", label: "labor, share of sales" },
              ...(s.dayMarkLabel ? [{ kind: "mark" as const, label: `the range, ${s.dayMarkLabel}` }] : []),
              ...(s.days.some((d) => d.missing) ? [{ kind: "hatched" as const, label: "labor missing" }] : []),
            ]}
          />
          <BarRows
            cells
            mark={s.dayMark}
            rows={s.days.map((d) => ({
              key: d.key,
              title: d.dow,
              sub: d.date,
              value: d.share,
              fill: d.fill,
              detail: d.detail,
              tag: d.provisional ? "so far" : undefined,
              hatched: d.missing && d.fill === 0,
              ariaLabel: d.aria,
            }))}
          />
          {s.dayNote ? <p className="cu-note">{s.dayNote}</p> : null}
        </Card>
      ) : null}

      {rest && s.stores.length > 0 ? (
        <StoreCardGrid>
          {s.stores.map((st) => (
            <StoreCard
              key={st.storeId}
              name={st.name}
              status={st.status}
              figures={st.figures}
              onClick={onStore ? () => onStore(st.storeId) : undefined}
            />
          ))}
        </StoreCardGrid>
      ) : null}

      {rest && s.roles.length > 0 ? (
        <Card as="section" label="What labor is made of" caption="What labor is made of">
          <BarRows rows={s.roles.map((r) => ({ key: r.key, title: r.label, value: r.cost, fill: r.fill, detail: r.detail }))} />
          {s.rolesNote ? <p className="cu-note">{s.rolesNote}</p> : null}
        </Card>
      ) : null}
    </div>
  )
}

/** The weeks as sales against labor (tap one to open it), and two of them side by side. */
export function LaborWeeksBlock({ w, onWeek }: { w: LaborWeeksView; onWeek: (range: DateRange) => void }) {
  const [picked, setPicked] = useState<{ a: string; b: string; under: string } | null>(null)
  // The picks belong to the week that was open when they were made: tap
  // another week and the comparison opens on that week and the one before.
  const under = w.weeks.find((x) => x.selected)?.key ?? ""
  const has = (k: string) => w.weeks.some((x) => x.key === k)
  const pair = picked !== null && picked.under === under && has(picked.a) && has(picked.b) ? picked : w.compare
  const a = pair ? w.weeks.find((x) => x.key === pair.a) : undefined
  const b = pair ? w.weeks.find((x) => x.key === pair.b) : undefined
  const optionLabel = (x: LaborWeeksView["weeks"][number]) => `${x.name}${x.partWord ? ` (${x.partWord})` : ""}`

  return (
    <div className="cu-stack">
      <Card as="section" label="Sales against labor, week by week" caption="Sales against labor, week by week · tap a week">
        <ChartKey
          items={[
            { kind: "base", label: "sales" },
            { kind: "fill", label: "labor" },
            ...(w.weeks.some((x) => x.missing) ? [{ kind: "hatched" as const, label: "labor missing" }] : []),
          ]}
        />
        <SplitBars
          bars={w.weeks.map((x) => ({
            key: x.key,
            label: x.label,
            top: x.top,
            value: x.salesFill,
            inner: x.laborFill,
            hatched: x.missing,
            selected: x.selected,
            ariaLabel: x.aria,
          }))}
          onPick={(key) => {
            const x = w.weeks.find((v) => v.key === key)
            const start = x ? parseIsoDay(x.key) : null
            const end = x ? parseIsoDay(x.end) : null
            if (start && end) onWeek({ start, end })
          }}
        />
        <Answer>{w.sentence}</Answer>
        <p className="cu-note">
          The whole bar is what the week sold and the filled part is what labor cost; the number on top is labor as a
          share of sales. To go further back, open an older week: it and the eleven weeks before it are drawn. The date
          arrows at the top of the page step forward again.
        </p>
      </Card>

      {a && b ? (
        <Card as="section" label="Two weeks side by side" caption="Two weeks side by side">
          <Compare
            a={{ key: a.key, label: a.name }}
            b={{ key: b.key, label: b.name }}
            rows={compareLaborWeeks(a, b)}
            labels={{ a: "Week", b: "Against" }}
            options={[...w.weeks].reverse().map((x) => ({ key: x.key, label: optionLabel(x) }))}
            onPick={(next) => setPicked({ ...next, under })}
          />
          {a.missing || b.missing || a.running || b.running ? (
            <p className="cu-note">
              {a.running || b.running ? "A week marked so far or part week has fewer than seven days. " : ""}
              {a.missing || b.missing
                ? "A week with labor missing shows less labor than was worked, and its share is on the days with labor."
                : ""}
            </p>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}

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

type LaborTab = "summary" | "weeks" | "stores" | "hours" | "people" | "clock"

/**
 * The Labor page as six short tabs, in one place so the four pages (desk
 * and phone, group and store) cannot drift apart. The owner found the single
 * scroll too long (2026-11-20), so each tab is one question:
 *
 * - Summary: the sentence (the page's own `lead`) and each day;
 * - Compare weeks: sales against labor week by week, and two weeks side by side;
 * - Stores and roles: the stores side by side and the cost by role;
 * - Hours: the next day hour by hour, people scheduled against forecast orders;
 * - People: each person's published hours and flagged time records;
 * - Time clock: missed punches by store, and early and late minutes.
 *
 * The tab is local state: opening another week or store keeps the reader on
 * the tab they were on. A tab that is not open is not rendered, so its
 * section is not read until it is asked for, and its blocks rise in when it
 * opens (`cu-stack`).
 */
export function LaborDetail({
  lead,
  sections,
  pending,
  onWeek,
  onStore,
}: {
  /** The page's sentence card, drawn first on the Summary tab. */
  lead: ReactNode
  sections: SectionSources<Pick<LaborSections, "summary" | "weeks" | "hours" | "people" | "clock" | "leaks">>
  pending: boolean
  onWeek: (range: DateRange) => void
  /** Given on the all-stores page only; it is what makes the third tab "Stores and roles". */
  onStore?: (storeId: string) => void
}) {
  const [tab, setTab] = useState<LaborTab>("summary")
  return (
    <>
      <Tabs
        label="Labor views"
        active={tab}
        onSelect={(k) => setTab(k as LaborTab)}
        items={[
          { key: "summary", label: "Summary" },
          { key: "weeks", label: "Compare weeks" },
          { key: "stores", label: onStore ? "Stores and roles" : "Roles" },
          { key: "hours", label: "Hours" },
          { key: "people", label: "People" },
          { key: "clock", label: "Time clock" },
        ]}
      />
      {tab === "summary" ? (
        <>
          {lead}
          <Section bare title="Each day" data={sections.summary} pending={pending}>
            {(d) => <LaborDetailView s={d} show="days" />}
          </Section>
        </>
      ) : null}
      {tab === "weeks" ? (
        <Section bare title="Sales against labor, week by week" data={sections.weeks} pending={pending}>
          {(w) => <LaborWeeksBlock w={w} onWeek={onWeek} />}
        </Section>
      ) : null}
      {tab === "stores" ? (
        <Section bare title={onStore ? "The stores and the roles" : "The roles"} data={sections.summary} pending={pending}>
          {(d) => <LaborDetailView s={d} show="stores" onStore={onStore} />}
        </Section>
      ) : null}
      {tab === "hours" ? (
        <Section bare title="Hours of the day" data={sections.hours} pending={pending}>
          {(h) => <LaborHoursBlock h={h} />}
        </Section>
      ) : null}
      {tab === "people" ? (
        <Section bare title="People" data={sections.people} pending={pending}>
          {(p) => <LaborPeopleBlock p={p} />}
        </Section>
      ) : null}
      {tab === "clock" ? (
        <>
          <Section bare title="Missed punches" data={sections.clock} pending={pending}>
            {(c) => <LaborClockBlock c={c} />}
          </Section>
          <Section bare title="Early and late minutes" data={sections.leaks} pending={pending}>
            {(l) => <LaborMinutesBlock l={l} />}
          </Section>
        </>
      ) : null}
    </>
  )
}
