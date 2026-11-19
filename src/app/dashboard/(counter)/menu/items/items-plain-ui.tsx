"use client"

import Link from "next/link"
import { useSurfaceHref } from "@/components/counter"
import { useUrlParam } from "@/components/counter/keep/use-url-param"
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
import { matchesFilter, type ItemsPlain, type ItemsPlainDish } from "@/lib/counter/menu-items-plain"

/**
 * Menu > Items made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 2). Every figure
 * and word arrives from `menu-items-plain.ts`; this file only lays it out.
 */
export function ItemsPlainView({ p }: { p: ItemsPlain }) {
  const href = useSurfaceHref()
  const [filter, setFilter] = useUrlParam("show", "all")
  const active = p.filters.some((f) => f.key === filter) ? filter : "all"

  const columns: RowsColumn<ItemsPlainDish>[] = [
    {
      key: "name",
      label: "Dish",
      slot: "title",
      render: (r) => <Link href={href(r.href)}>{r.name}</Link>,
    },
    { key: "detail", label: "Plate", slot: "detail", render: (r) => r.detail },
    {
      key: "status",
      label: "Status",
      slot: "status",
      render: (r) => (
        <span title={r.why}>
          <Status tone={r.status.tone}>{r.status.text}</Status>
        </span>
      ),
    },
    { key: "keep", label: "Keeps a plate", slot: "amount", align: "end", render: (r) => r.keep },
  ]
  const shown = p.dishes.filter((d) => matchesFilter(d, active))

  return (
    <div className="cu-stack">
      <Card label="Menu items in a sentence">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber label={p.big.label} value={p.big.value} sub={p.big.sub} missing={p.big.missing} />
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
      <NeedsYou
        groups={p.needs.map((n) => ({
          key: n.key,
          what: n.what,
          why: n.why,
          action: (
            <ButtonLink variant="primary" href={href(n.act.href)}>
              {n.act.label}
            </ButtonLink>
          ),
        }))}
      />
      <Card caption="Every dish">
        <div className="mi-chips cu-chips" role="group" aria-label="Show">
          {p.filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className="mi-chip"
              aria-pressed={active === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label} {f.n}
            </button>
          ))}
        </div>
        {/* Keyed on the filter so the list arrives again (a short rise) rather than jumping. */}
        <div key={active} className="cu-filtered">
          <Rows columns={columns} rows={shown} rowKey={(r) => r.key} />
        </div>
      </Card>
    </div>
  )
}
