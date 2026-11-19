"use client"

import { Answer, BigNumber, BigNumbers, Card, Freshness, Status, Statuses } from "@/components/counter/ui"
import type { ProfitPlain } from "@/lib/counter/menu-profit-plain"

/**
 * Menu > Profit made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 5): the chart's
 * four corners, named. Every word arrives from `menu-profit-plain.ts`.
 */
export function ProfitPlainView({ p }: { p: ProfitPlain }) {
  return (
    <div className="cu-stack">
      <Card label="Menu profit in a sentence">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber label={p.big.label} value={p.big.value} sub={p.big.sub} missing={p.big.missing} />
        </BigNumbers>
      </Card>
      <Statuses>
        {p.statuses.map((s) => (
          <Status key={s.text} tone={s.tone}>
            {s.text}
          </Status>
        ))}
      </Statuses>
      <div className="cu-quad">
        {p.groups.map((g) => (
          <Card key={g.key} caption={g.title}>
            <p className="cu-quad__names">
              {g.names.length === 0 ? "None this time" : g.names.join(", ")}
              {g.more > 0 ? ` and ${g.more} more` : ""}
            </p>
            <Status tone={g.tone}>{g.hint}</Status>
          </Card>
        ))}
      </div>
    </div>
  )
}
