"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import {
  COMPARISONS, PRESETS, comparisonRange, dayCount, stepRange,
  type ComparisonId, type DateRange, type PresetId,
} from "@/lib/counter/date-range"
import { useFramePlacement } from "./frame-placement"

/**
 * The most-used control in the product. Every figure on every page is a
 * claim about a window of time, so the window is a first-class control
 * here, not a filter buried in a settings menu.
 *
 * All the date arithmetic already lives in date-range.ts — note 19 ("a
 * range that only changes the label is a lie") is why: regenerating the
 * series, not just relabelling it, is the CALLER's job once
 * onPreset/onComparison/onStep fires. This component is only the surface
 * over that logic: two menus and two steppers.
 *
 * Note 21: "A popover that leaves its frame is broken, not clever." Frame
 * placement (right-anchor by default, clamp the width, flip to an explicit
 * `left` only when right-anchoring would overflow) lives in
 * `./frame-placement` — shared with `StoreSwitcher`'s own popover — rather
 * than duplicated here. jsdom reports zero-sized boxes for every element, so
 * none of it can be proven by a unit test; see
 * docs/counter/controls-verification.md for the real-browser measurements.
 */

type MenuId = "range" | "comparison" | null

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function fmtRange(r: DateRange): string {
  return r.start.getTime() === r.end.getTime() ? fmtDay(r.start) : `${fmtDay(r.start)} – ${fmtDay(r.end)}`
}

function menuItemClass(checked: boolean): string {
  return checked
    ? "flex items-center justify-between gap-3 px-3 py-1.5 text-left font-semibold text-ct-accent-hi bg-ct-accent-wash"
    : "flex items-center justify-between gap-3 px-3 py-1.5 text-left text-ct-ink-2 hover:bg-ct-sunk hover:text-ct-ink"
}

export interface DateControlProps {
  presetId: PresetId
  comparisonId: ComparisonId
  range: DateRange
  onPreset: (id: PresetId) => void
  onComparison: (id: ComparisonId) => void
  onStep: (direction: -1 | 1) => void
}

export function DateControl({
  presetId,
  comparisonId,
  range,
  onPreset,
  onComparison,
  onStep,
}: DateControlProps) {
  const [openMenu, setOpenMenu] = useState<MenuId>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rangeTriggerRef = useRef<HTMLButtonElement>(null)
  const cmpTriggerRef = useRef<HTMLButtonElement>(null)

  // Escape and an outside click both close whatever is open without
  // choosing anything — a stray click or a reflex Escape must never fire
  // onPreset or onComparison.
  useEffect(() => {
    if (!openMenu) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null)
    }
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("mousedown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("mousedown", onPointerDown)
    }
  }, [openMenu])

  // Preset lengths ("Last 30 days · 30 days") are each preset's OWN span,
  // not the currently selected range's — so a reader picks by span, not by
  // name. Most presets have a fixed length; the calendar-anchored ones
  // (this week, month-to-date, ...) need SOME "today" to resolve against,
  // and the real one is fine here since it only feeds display text, never
  // the actual range (that stays entirely the caller's job).
  const today = useMemo(() => new Date(), [])

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]
  const comparison = COMPARISONS.find((c) => c.id === comparisonId) ?? COMPARISONS[0]

  const rangePlacement = useFramePlacement(openMenu === "range", rangeTriggerRef)
  const cmpPlacement = useFramePlacement(openMenu === "comparison", cmpTriggerRef)

  // Filter by what comparisonRange ACTUALLY returns for this range, rather
  // than a hardcoded length check — that is what drops "weekday" past 7
  // days without the component re-deriving date-range.ts's own rule.
  //
  // "none" is a deliberate exception: comparisonRange(range, "none") always
  // returns null BY DESIGN (see date-range.ts) — it is not a range that
  // failed to resolve, it is the caller opting out of a comparison
  // entirely. Filtering it out alongside "weekday" would leave only 3
  // options even on a short range, which is not what the option means.
  const comparisonOptions = COMPARISONS.filter(
    (c) => c.id === "none" || comparisonRange(range, c.id) !== null,
  )

  const prevPreview = stepRange(range, -1)
  const nextPreview = stepRange(range, 1)

  const toggle = (menu: MenuId) => setOpenMenu((m) => (m === menu ? null : menu))

  return (
    <div ref={containerRef} className="inline-flex items-stretch gap-2 font-ct-sans text-ct-body text-ct-ink">
      <div className="inline-flex items-stretch">
        <button
          type="button"
          aria-label={`Previous period (${fmtRange(prevPreview)})`}
          onClick={() => onStep(-1)}
          className="grid w-[26px] place-items-center rounded-l-ct-sm border border-r-0 border-ct-line-strong bg-ct-surface text-ct-ink-2 hover:bg-ct-sunk hover:text-ct-ink"
        >
          <span aria-hidden>‹</span>
        </button>

        <div className="relative">
          <button
            type="button"
            ref={rangeTriggerRef}
            aria-haspopup="menu"
            aria-expanded={openMenu === "range"}
            onClick={() => toggle("range")}
            className="flex h-full items-center gap-2 whitespace-nowrap border border-ct-line-strong bg-ct-surface px-2.5 py-1 hover:bg-ct-sunk"
          >
            <span className="font-semibold">{preset.name}</span>
            <ChevronDown aria-hidden className="size-[11px] text-ct-ink-3" />
          </button>
          {openMenu === "range" && (
            <div
              role="menu"
              aria-label="Range"
              style={{
                width: rangePlacement.width,
                ...(rangePlacement.left != null ? { left: rangePlacement.left } : { right: 0 }),
              }}
              className="absolute top-[calc(100%+7px)] z-30 grid max-h-[420px] overflow-y-auto rounded-ct border border-ct-line-strong bg-ct-surface py-1"
            >
              {PRESETS.map((p) => {
                const len = dayCount(p.resolve(today))
                const checked = p.id === presetId
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    onClick={() => {
                      onPreset(p.id)
                      setOpenMenu(null)
                    }}
                    className={menuItemClass(checked)}
                  >
                    <span>{p.name}</span>
                    <span className="font-ct-mono text-ct-micro text-ct-ink-3">
                      · {len} {len === 1 ? "day" : "days"}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <button
          type="button"
          aria-label={`Next period (${fmtRange(nextPreview)})`}
          onClick={() => onStep(1)}
          className="grid w-[26px] place-items-center rounded-r-ct-sm border border-l-0 border-ct-line-strong bg-ct-surface text-ct-ink-2 hover:bg-ct-sunk hover:text-ct-ink"
        >
          <span aria-hidden>›</span>
        </button>
      </div>

      <div className="relative">
        <button
          type="button"
          ref={cmpTriggerRef}
          aria-haspopup="menu"
          aria-expanded={openMenu === "comparison"}
          onClick={() => toggle("comparison")}
          className="flex items-center gap-2 whitespace-nowrap rounded-ct-sm border border-ct-line-strong bg-ct-surface px-2.5 py-1 hover:bg-ct-sunk"
        >
          <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
            {comparison.label}
          </span>
          <ChevronDown aria-hidden className="size-[11px] text-ct-ink-3" />
        </button>
        {openMenu === "comparison" && (
          <div
            role="menu"
            aria-label="Comparison"
            style={{
              width: Math.max(200, Math.min(cmpPlacement.width, 260)),
              ...(cmpPlacement.left != null ? { left: cmpPlacement.left } : { right: 0 }),
            }}
            className="absolute top-[calc(100%+7px)] z-30 grid overflow-hidden rounded-ct border border-ct-line-strong bg-ct-surface py-1"
          >
            {comparisonOptions.map((c) => {
              const checked = c.id === comparisonId
              return (
                <button
                  key={c.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  onClick={() => {
                    onComparison(c.id)
                    setOpenMenu(null)
                  }}
                  className={menuItemClass(checked)}
                >
                  <span>{c.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
