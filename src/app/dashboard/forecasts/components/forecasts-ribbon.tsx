"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import type { ForecastSection } from "../lib/sections"
import { FORECAST_SECTIONS } from "../lib/sections"

interface Props {
  current: ForecastSection
  /** Per-section flag — when false, the section has no cards to show and we
   *  hide its ribbon entry rather than offering an empty filter. */
  available: Record<ForecastSection, boolean>
}

export function ForecastsRibbon({ current, available }: Props) {
  const searchParams = useSearchParams()
  const storeId = searchParams.get("storeId")

  const buildHref = (section: ForecastSection) => {
    const sp = new URLSearchParams()
    if (storeId) sp.set("storeId", storeId)
    sp.set("section", section)
    return `/dashboard/forecasts?${sp.toString()}`
  }

  return (
    <nav className="forecasts-ribbon" aria-label="Forecast sections">
      <ul className="forecasts-ribbon__list">
        {FORECAST_SECTIONS.map((s) => {
          if (!available[s.id]) return null
          const isActive = current === s.id
          return (
            <li key={s.id} className="forecasts-ribbon__item-wrap">
              <Link
                href={buildHref(s.id)}
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={
                  "forecasts-ribbon__item" + (isActive ? " is-active" : "")
                }
              >
                <span className="forecasts-ribbon__marker" aria-hidden="true">
                  §
                </span>
                <span className="forecasts-ribbon__label">{s.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
