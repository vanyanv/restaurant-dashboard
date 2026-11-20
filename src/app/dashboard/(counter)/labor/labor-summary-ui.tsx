"use client"

import { useId, useState, type CSSProperties } from "react"
import { Section } from "@/components/counter"
import { Answer, Card, StoreCard, StoreCardGrid } from "@/components/counter/ui"
import type { LaborSections } from "@/lib/counter/adapters/labor"
import type { SectionSources } from "@/lib/counter/adapters/types"
import { parseIsoDay, type DateRange } from "@/lib/counter/date-range"
import { compareLaborWeeks, type LaborSummary, type LaborWeeksView } from "@/lib/counter/labor-summary"

/**
 * The Labor page's detail, shared by the desk and the phone and by the group
 * and store pages (mock https://claude.ai/artifact/VVoyXKUEykrCL6MK5K78ms).
 * Every figure, word and bar length arrives from `labor-summary.ts`; this
 * file lays them out and keeps the one piece of state there is, which two
 * weeks are set side by side. Layout is `counter-labor.css` (`lb-`).
 */

/** Each day's share, the stores side by side, and the cost by role. */
export function LaborDetailView({ s, onStore }: { s: LaborSummary; onStore?: (storeId: string) => void }) {
  return (
    <div className="cu-stack">
      {s.days.length > 0 ? (
        <Card as="section" label="Each day">
          <div className="lb-top">
            <h3 className="lb-h">Each day</h3>
            <span className="lb-key">
              <span>
                <i className="lb-sw lb-sw--labor" />
                labor, share of sales
              </span>
              {s.dayMarkLabel ? (
                <span>
                  <i className="lb-sw lb-sw--mark" />
                  the range, {s.dayMarkLabel}
                </span>
              ) : null}
              {s.days.some((d) => d.missing) ? (
                <span>
                  <i className="lb-sw lb-sw--miss" />
                  labor missing
                </span>
              ) : null}
            </span>
          </div>
          <div className="lb-days">
            <ul className="lb-days__in">
              {s.days.map((d, i) => (
                <li key={d.key} className="lb-day" data-missing={d.missing && d.fill === 0} aria-label={d.aria}>
                  <span className="lb-day__dow">
                    {d.dow}
                    <small>{d.date}</small>
                  </span>
                  <span className="lb-day__trk" aria-hidden="true">
                    {d.fill > 0 ? <i className="lb-day__fill" style={{ width: `${d.fill}%`, "--i": i } as CSSProperties} /> : null}
                    {s.dayMark !== null && d.fill > 0 ? <i className="lb-day__mark" style={{ left: `${s.dayMark}%` }} /> : null}
                  </span>
                  <span className="lb-day__share">{d.share}</span>
                  <span className="lb-day__det">
                    {d.detail}
                    {d.provisional ? <> <span className="lb-tag">so far</span></> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {s.dayNote ? <p className="lb-note">{s.dayNote}</p> : null}
        </Card>
      ) : null}

      {s.stores.length > 0 ? (
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

      {s.roles.length > 0 ? (
        <Card as="section" label="What labor is made of">
          <h3 className="lb-h">What labor is made of</h3>
          <ul className="lb-roles">
            {s.roles.map((r) => (
              <li key={r.key} className="lb-role">
                <span className="lb-role__name">{r.label}</span>
                <span className="lb-role__cost">{r.cost}</span>
                <span className="lb-role__trk" aria-hidden="true">
                  <i style={{ width: `${r.fill}%` }} />
                </span>
                <span className="lb-role__det">{r.detail}</span>
              </li>
            ))}
          </ul>
          {s.rolesNote ? <p className="lb-note">{s.rolesNote}</p> : null}
        </Card>
      ) : null}
    </div>
  )
}

/** The weeks as sales against labor (tap one to open it), and two of them side by side. */
export function LaborWeeksBlock({ w, onWeek }: { w: LaborWeeksView; onWeek: (range: DateRange) => void }) {
  const idA = useId()
  const idB = useId()
  const [picked, setPicked] = useState<{ a: string; b: string } | null>(null)
  // The picks are remembered only while both weeks are still on screen; a new
  // range brings new weeks, and the comparison opens on its own pair again.
  const has = (k: string) => w.weeks.some((x) => x.key === k)
  const pair = picked !== null && has(picked.a) && has(picked.b) ? picked : w.compare
  const a = pair ? w.weeks.find((x) => x.key === pair.a) : undefined
  const b = pair ? w.weeks.find((x) => x.key === pair.b) : undefined
  const newestFirst = [...w.weeks].reverse()

  return (
    <div className="cu-stack">
      <Card as="section" label="Sales against labor, week by week">
        <div className="lb-top">
          <h3 className="lb-h">Sales against labor, week by week</h3>
          <span className="lb-key">
            <span>
              <i className="lb-sw lb-sw--sales" />
              sales
            </span>
            <span>
              <i className="lb-sw lb-sw--labor" />
              labor
            </span>
            {w.weeks.some((x) => x.missing) ? (
              <span>
                <i className="lb-sw lb-sw--miss" />
                labor missing
              </span>
            ) : null}
          </span>
        </div>
        <div className="lb-weeks">
          <div className="lb-weeks__bars" style={{ gridTemplateColumns: `repeat(${w.weeks.length},minmax(0,1fr))` }}>
            {w.weeks.map((x, i) => (
              <button
                key={x.key}
                type="button"
                className="lb-wk"
                data-missing={x.missing}
                aria-pressed={x.selected}
                aria-label={x.aria}
                onClick={() => {
                  const start = parseIsoDay(x.key)
                  const end = parseIsoDay(x.end)
                  if (start && end) onWeek({ start, end })
                }}
              >
                <span className="lb-wk__top">{x.top}</span>
                <span className="lb-wk__bar" style={{ height: `${Math.max(2, x.salesFill)}%`, "--i": i } as CSSProperties}>
                  {x.laborFill > 0 ? <i style={{ height: `${x.laborFill}%` }} /> : null}
                </span>
                <span className="lb-wk__lbl">{x.label}</span>
              </button>
            ))}
          </div>
        </div>
        <Answer>{w.sentence}</Answer>
        <p className="lb-note">
          Tap a week to open it. The whole bar is what the week sold and the filled part is what labor cost; the number
          on top is labor as a share of sales. To go further back, open an older week: the twelve weeks before it follow.
        </p>
      </Card>

      {a && b ? (
        <Card as="section" label="Two weeks side by side">
          <h3 className="lb-h">Two weeks side by side</h3>
          <div className="lb-cmp">
            <div className="lb-cmp__picks">
              <label className="lb-cmp__pick" htmlFor={idA}>
                <span>This week</span>
                <select id={idA} value={a.key} onChange={(e) => setPicked({ a: e.target.value, b: b.key })}>
                  {newestFirst.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.name}
                      {x.running ? " (so far)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="lb-cmp__pick" htmlFor={idB}>
                <span>Against</span>
                <select id={idB} value={b.key} onChange={(e) => setPicked({ a: a.key, b: e.target.value })}>
                  {newestFirst.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.name}
                      {x.running ? " (so far)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <dl className="lb-cmp__rows">
              <div className="lb-cmp__row lb-cmp__row--head">
                <dt>Figure</dt>
                <dd>{a.name}</dd>
                <dd>{b.name}</dd>
                <dd>Change</dd>
              </div>
              {compareLaborWeeks(a, b).map((r) => (
                <div key={r.key} className="lb-cmp__row">
                  <dt>{r.label}</dt>
                  <dd>{r.a}</dd>
                  <dd>{r.b}</dd>
                  <dd className="lb-cmp__chg" data-tone={r.tone}>
                    {r.change}
                  </dd>
                </div>
              ))}
            </dl>
            {a.missing || b.missing || a.running || b.running ? (
              <p className="lb-note">
                {a.running || b.running ? "A week marked so far is still running, so it is short of a whole week. " : ""}
                {a.missing || b.missing ? "A week with labor missing shows less labor than was worked." : ""}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  )
}

/**
 * The two sections every Labor page shows under its sentence, in one place so
 * the four pages (desk and phone, group and store) cannot drift apart.
 */
export function LaborDetail({
  sections,
  pending,
  onWeek,
  onStore,
}: {
  sections: SectionSources<Pick<LaborSections, "summary" | "weeks">>
  pending: boolean
  onWeek: (range: DateRange) => void
  onStore?: (storeId: string) => void
}) {
  return (
    <>
      <Section bare title="Sales against labor, week by week" data={sections.weeks} pending={pending}>
        {(w) => <LaborWeeksBlock w={w} onWeek={onWeek} />}
      </Section>
      <Section bare title="Each day, the stores and the roles" data={sections.summary} pending={pending}>
        {(d) => <LaborDetailView s={d} onStore={onStore} />}
      </Section>
    </>
  )
}
