"use client"

import { useSurfaceHref } from "@/components/counter"
import {
  Answer,
  Freshness,
  BigNumber,
  BigNumbers,
  ButtonLink,
  Card,
  NeedsYouItem,
  NeedsYouList,
  Status,
  Statuses,
} from "@/components/counter/ui"
import { money } from "@/lib/counter/format"
import type { DecisionsPlain } from "@/lib/counter/decisions-plain"

/**
 * The Decisions page made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4). Every figure and word
 * arrives from `decisions-plain.ts`; this file only lays it out.
 */
export function DecisionsPlainView({ p }: { p: DecisionsPlain }) {
  const href = useSurfaceHref()
  return (
    <div className="cu-stack">
      <Card label="The week ahead">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber
            label="Expected sales this week"
            value={p.total === null ? null : money(p.total)}
            vs={{ change: p.vs, tone: p.vsTone, against: "" }}
            sub={p.sub}
            missing={p.total === null ? "no forecast yet" : undefined}
          />
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
      {p.runOut.length > 0 ? (
        <Card caption="Running out before delivery">
          <NeedsYouList>
            {p.runOut.map((r) => (
              <NeedsYouItem
                key={r.key}
                bad
                what={r.store ? `${r.name} · ${r.store}` : r.name}
                why={`Out ${r.when}${r.qty ? ` · bring in ${r.qty}` : ""}`}
              >
                <ButtonLink href={href(r.href)} variant="primary">
                  Order
                </ButtonLink>
              </NeedsYouItem>
            ))}
          </NeedsYouList>
        </Card>
      ) : null}
      {p.calls.length > 0 ? (
        <Card caption="This week's calls">
          <NeedsYouList numbered>
            {p.calls.map((c) => (
              <NeedsYouItem key={c.key} what={c.title} why={`${c.worth} · ${c.when}. ${c.why}`}>
                {c.action ? <ButtonLink href={href(c.action.href)}>{c.action.label}</ButtonLink> : null}
              </NeedsYouItem>
            ))}
          </NeedsYouList>
        </Card>
      ) : null}
    </div>
  )
}
