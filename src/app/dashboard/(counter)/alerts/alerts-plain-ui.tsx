"use client"

import { useSurfaceHref } from "@/components/counter"
import {
  Answer,
  Button,
  ButtonLink,
  Card,
  NeedsYou,
  NeedsYouItem,
  NeedsYouList,
  Status,
  Statuses,
} from "@/components/counter/ui"
import { plural } from "@/lib/counter/format"
import type { AlertsPlain } from "@/lib/counter/alerts-plain"

/**
 * The Alerts page made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/Sr98ngzuijqUUhPbJNJAv4). Every figure and word
 * arrives from `alerts-plain.ts`; this file only lays it out.
 *
 * `onOpen` opens one alert in the list below: the page owns that, because it
 * keeps the store and segment in the URL and unfolds the list.
 */
export function AlertsPlainView({ p, onOpen }: { p: AlertsPlain; onOpen: (id: string) => void }) {
  const href = useSurfaceHref()
  return (
    <div className="cu-stack">
      <Card label="Alerts in a sentence">
        <Answer>{p.sentence}</Answer>
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
      {p.serious.length > 0 ? (
        <Card caption="Serious">
          <NeedsYouList>
            {p.serious.map((s) => (
              <NeedsYouItem key={s.key} what={s.what} why={s.why ?? undefined} bad>
                <Button variant="primary" onClick={() => onOpen(s.id)}>
                  Open it
                </Button>
              </NeedsYouItem>
            ))}
          </NeedsYouList>
          {p.seriousMore > 0 ? (
            <p className="cu-card__cap">
              {plural(p.seriousMore, "more serious alert", "more serious alerts")} in the list below
            </p>
          ) : null}
        </Card>
      ) : null}
      <NeedsYou
        groups={p.groups.map((g) => ({
          key: g.key,
          what: g.what,
          why: g.why ?? undefined,
          action: <ButtonLink href={href(g.action.href)}>{g.action.label}</ButtonLink>,
        }))}
      />
    </div>
  )
}
