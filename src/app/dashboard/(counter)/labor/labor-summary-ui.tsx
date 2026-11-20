"use client"

import { useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { Section } from "@/components/counter"
import { BarRows, Card, ChartKey, StoreCard, StoreCardGrid, Tabs } from "@/components/counter/ui"
import type { LaborSections } from "@/lib/counter/adapters/labor"
import type { SectionSources } from "@/lib/counter/adapters/types"
import type { DateRange } from "@/lib/counter/date-range"
import type { LaborSummary } from "@/lib/counter/labor-summary"

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
              ...(s.dayMarkLabel ? [{ kind: "mark" as const, label: s.dayMarkLabel }] : []),
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
              tag: d.provisional ? "so far" : d.over ? "over target" : undefined,
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

const LaborWeeksBlock = dynamic(() => import("./labor-weeks-ui").then((m) => m.LaborWeeksBlock), { loading: () => null })
const LaborHoursBlock = dynamic(() => import("./labor-more-ui").then((m) => m.LaborHoursBlock), { loading: () => null })
const LaborPeopleBlock = dynamic(() => import("./labor-more-ui").then((m) => m.LaborPeopleBlock), { loading: () => null })
const LaborClockBlock = dynamic(() => import("./labor-more-ui").then((m) => m.LaborClockBlock), { loading: () => null })
const LaborMinutesBlock = dynamic(() => import("./labor-more-ui").then((m) => m.LaborMinutesBlock), { loading: () => null })

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
 * opens (`cu-stack`). Every tab but Summary is loaded when it is first
 * opened (`labor-weeks-ui`, `labor-more-ui`), which keeps the page's first
 * load inside its budget.
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
