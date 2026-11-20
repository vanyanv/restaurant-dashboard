"use client"

import type { CSSProperties } from "react"
import { useSurfaceHref } from "@/components/counter"
import {
  Answer,
  BigNumber,
  BigNumbers,
  ButtonLink,
  ButtonRow,
  Card,
  Freshness,
  Status,
  Statuses,
} from "@/components/counter/ui"
import type { ItemPlain } from "@/lib/counter/menu-item-plain"

/**
 * One menu item made plain, shared by the desk and the phone (mock
 * https://claude.ai/artifact/YNwJ7EneNdAaC7vDp4HhBe, screen 4). Every figure
 * and word arrives from `menu-item-plain.ts`.
 */
export function ItemPlainView({ p }: { p: ItemPlain }) {
  const href = useSurfaceHref()
  return (
    <div className="cu-stack">
      <Card label="This item in a sentence">
        <Answer>{p.sentence}</Answer>
        <Freshness />
        <BigNumbers>
          <BigNumber label={p.big.label} value={p.big.value} sub={p.big.sub} missing={p.big.missing} />
        </BigNumbers>
      </Card>
      {p.bars.length > 0 ? (
        <Card caption="Kept per plate, by channel">
          <ul className="cu-hbars">
            {p.bars.map((b, i) => (
              <li key={b.key}>
                <span className="cu-hbars__name">
                  {b.channel}
                  <small>{b.sold}</small>
                </span>
                <span className="cu-hbars__track" aria-hidden="true">
                  <span
                    className="cu-hbars__bar"
                    style={{ "--s": b.share, "--i": i, "--tint": b.tint } as CSSProperties}
                  />
                </span>
                <span className="cu-hbars__v">{b.value}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Statuses>
        {p.statuses.map((s) => (
          <Status key={s.text} tone={s.tone}>
            {s.text}
          </Status>
        ))}
      </Statuses>
      {p.recipe ? (
        <ButtonRow>
          <ButtonLink href={href(p.recipe.href)}>{p.recipe.label}</ButtonLink>
        </ButtonRow>
      ) : null}
    </div>
  )
}
