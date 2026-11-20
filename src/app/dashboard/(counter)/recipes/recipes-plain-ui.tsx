"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { useSurfaceHref } from "@/components/counter"
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
import type { RecipesPlain } from "@/lib/counter/adapters/recipes"

/**
 * Recipes made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 7). Every figure
 * and word arrives from the recipes adapter's `plain` section. `add` is the
 * desk's new-recipe form; the phone has no create path.
 */
type Row = RecipesPlain["rows"][number]

export function RecipesPlainView({ p, add }: { p: RecipesPlain; add?: ReactNode }) {
  const href = useSurfaceHref()
  const columns: RowsColumn<Row>[] = [
    { key: "name", label: "Recipe", slot: "title", render: (r) => <Link href={href(r.href)}>{r.name}</Link> },
    { key: "detail", label: "Category", slot: "detail", render: (r) => r.detail },
    {
      key: "cost",
      label: "Per serving",
      slot: "amount",
      align: "end",
      render: (r) => (r.tone === "bad" ? <Status tone="bad">{r.cost}</Status> : r.cost),
    },
  ]
  return (
    <div className="cu-stack">
      <Card label="Recipes in a sentence">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber label={p.big.label} value={p.big.value} sub={p.big.sub} />
        </BigNumbers>
      </Card>
      {p.components > 0 ? (
        <Statuses>
          <Status tone="good">{`${p.components} component ${p.components === 1 ? "recipe" : "recipes"}, used inside others`}</Status>
        </Statuses>
      ) : null}
      <NeedsYou
        groups={p.needs.map((n) => ({
          key: n.key,
          what: n.what,
          why: n.why,
          action: (
            <ButtonLink variant="primary" href={href(n.href)}>
              {n.act}
            </ButtonLink>
          ),
        }))}
      />
      {p.rows.length > 0 ? (
        <Card caption={p.more > 0 ? `Sold most · ${p.rows.length} of ${p.rows.length + p.more}` : "Sold most"}>
          <Rows columns={columns} rows={p.rows} rowKey={(r) => r.key} />
          {add}
        </Card>
      ) : add ? (
        <Card caption="Start one">{add}</Card>
      ) : null}
    </div>
  )
}
