"use client"

import { Answer, Freshness, BigNumber, BigNumbers, Card, Status, Statuses } from "@/components/counter/ui"
import type { LaborPlain } from "@/lib/counter/labor-plain"

/**
 * Labor made plain, shared by the desk and the phone and by the group and
 * store pages (mock https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4). Every
 * figure and word arrives from `labor-plain.ts`; this file only lays it out.
 */
export function LaborPlainView({ p, title = "Labor in a sentence" }: { p: LaborPlain; title?: string }) {
  // The cost is already the lead figure's own sub; the other lines sit beside it.
  const side = p.lines.filter((l) => l.key !== "cost")
  return (
    <div className="cu-stack">
      <Card label={title}>
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber
            label={p.big.label}
            value={p.big.value}
            sub={p.big.sub}
            vs={p.vs ?? undefined}
            missing={p.big.missing}
          />
          {side.map((l) => (
            <BigNumber key={l.key} label={l.label} value={l.value} />
          ))}
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
    </div>
  )
}
