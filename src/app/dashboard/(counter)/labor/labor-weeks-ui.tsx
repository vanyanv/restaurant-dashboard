"use client"

import { useState } from "react"
import { Answer, Card, ChartKey, Compare, SplitBars } from "@/components/counter/ui"
import { parseIsoDay, type DateRange } from "@/lib/counter/date-range"
import { compareLaborWeeks, type LaborWeeksView } from "@/lib/counter/labor-summary"

/**
 * The Labor page's Compare weeks tab. Its own file so `LaborDetail` can load
 * it when the tab is opened: the desk Labor routes sit at their first-load
 * budget, and a tab nobody has opened should not be in it.
 */

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
