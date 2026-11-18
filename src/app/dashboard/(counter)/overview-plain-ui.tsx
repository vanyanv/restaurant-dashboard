"use client"

import { useSurfaceHref } from "@/components/counter"
import {
  Answer,
  BigNumber,
  BigNumbers,
  ButtonLink,
  ButtonRow,
  Card,
  NeedsYou,
  Status,
  Statuses,
  StoreCard,
  StoreCardGrid,
  WeekBars,
  type StatusTone,
} from "@/components/counter/ui"
import { count, money, pct, plural } from "@/lib/counter/format"
import { isoDay, readWeekWindow, type DateRange } from "@/lib/counter/date-range"
import type { OverviewPlain, OverviewTone } from "@/lib/counter/overview-plain"

/**
 * The Overview "made plain", shared by the desk and the phone so the two say
 * the same thing in the same words (mock
 * https://claude.ai/artifact/8ZrnRsGAYWc2WV6tg6wb5D). Built only from the
 * shared blocks; every figure arrives formatted-ready from
 * `overview-plain.ts`, which reads the P&L's own calculation.
 */

const TONE: Record<OverviewTone, StatusTone> = { good: "good", warn: "warn", bad: "bad" }

const signedMoney = (v: number) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${pct(Math.abs(v))}`

/** The sentence, sales and kept, and the last eight weeks of sales as the week picker. */
export function OverviewHero({
  o,
  range,
  onWeek,
}: {
  o: OverviewPlain
  range: DateRange
  onWeek: (range: DateRange) => void
}) {
  const href = useSurfaceHref()
  const v = o.salesVs
  return (
    <>
      <Card label="How the period went">
        <Answer>{o.sentence}</Answer>
        <BigNumbers>
          <BigNumber
            label="Sales"
            value={money(o.sales)}
            vs={
              v
                ? {
                    change: `${v.amount >= 0 ? "▲" : "▼"} ${signedMoney(v.amount)}${v.pct === null ? "" : ` · ${signedPct(v.pct)}`}`,
                    tone: v.amount >= 0 ? "up" : "down",
                    against: `vs ${v.label}`,
                  }
                : { change: "", tone: "flat", against: "no earlier period to compare" }
            }
          />
          <BigNumber
            label="Kept after every cost"
            value={o.sales > 0 ? money(o.kept) : null}
            atMost={o.sales > 0 && o.keptAtMost !== null}
            sub={o.sales > 0 ? `${pct(o.keptPct)} of sales` : undefined}
            missing={o.keptAtMost ?? undefined}
          />
        </BigNumbers>
        <ButtonRow>
          <ButtonLink href={href("/dashboard/pnl")}>Open P&amp;L</ButtonLink>
        </ButtonRow>
      </Card>
      <WeekBars
        title={`Sales, last ${o.weeks.length} weeks · tap a week`}
        weeks={o.weeks.map((w) => ({
          key: w.window.start,
          label: w.label,
          value: w.sales,
          top: w.sales > 0 ? compact(w.sales) : "—",
          selected: w.window.start === isoDay(range.start) && w.window.end === isoDay(range.end),
          ariaLabel: `Week of ${w.label}: sales ${money(w.sales)}`,
        }))}
        onPick={(key) => {
          const w = o.weeks.find((x) => x.window.start === key)
          if (!w) return
          const r = readWeekWindow(w.window)
          onWeek({ start: r.start, end: r.end })
        }}
      />
    </>
  )
}

/** "$63.4k": a bar label has room for four characters. */
function compact(v: number): string {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return money(v)
}

export function OverviewStatuses({ o }: { o: OverviewPlain }) {
  if (o.statuses.length === 0) return null
  return (
    <Statuses>
      {o.statuses.map((s) => (
        <Status key={s.text} tone={TONE[s.tone]}>
          {s.text}
        </Status>
      ))}
    </Statuses>
  )
}

/** One card per store, all open: sales, the change, orders and labor. */
export function OverviewStores({ o, onStore }: { o: OverviewPlain; onStore: (storeId: string) => void }) {
  if (o.stores.length === 0) return null
  return (
    <StoreCardGrid>
      {o.stores.map((s) => (
        <StoreCard
          key={s.storeId}
          name={s.name}
          onClick={() => onStore(s.storeId)}
          status={
            s.sales <= 0
              ? { tone: "off", label: "No sales" }
              : s.salesChangePct === null
                ? { tone: "off", label: "Nothing to compare" }
                : s.salesChangePct >= 0
                  ? { tone: "good", label: `▲ ${pct(s.salesChangePct)}` }
                  : { tone: "bad", label: `▼ ${pct(Math.abs(s.salesChangePct))}` }
          }
          figures={[
            { label: "Sales", value: money(s.sales) },
            { label: "Orders", value: s.orders === null ? "—" : count(s.orders) },
            {
              label: "Labor",
              value: s.laborMissingDays > 0 ? `${plural(s.laborMissingDays, "day")} missing` : `${pct(s.laborPct)} of sales`,
            },
          ]}
        />
      ))}
    </StoreCardGrid>
  )
}

/** Needs you in a few groups, folded by default (owner, 2026-11-03), one button each. */
export function OverviewNeeds({ o }: { o: OverviewPlain }) {
  const href = useSurfaceHref()
  return (
    <NeedsYou
      groups={o.needs.map((n) => ({
        key: n.key,
        what: n.what,
        why: n.why ?? undefined,
        action: (
          <ButtonLink href={href(n.action.href)} variant={n.tone === "bad" ? "primary" : "plain"}>
            {n.action.label}
          </ButtonLink>
        ),
      }))}
    />
  )
}
