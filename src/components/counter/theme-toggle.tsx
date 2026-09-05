"use client"

import { useCounterTheme, type Theme } from "./theme-provider"

/**
 * The theme control, as a `.seg` — the prototype's own segmented control
 * (counter-prototype.html line 206), the same one the date control and the
 * view switchers use, so a preference reads like every other choice on a
 * Counter page rather than like a widget from somewhere else.
 *
 * Two options, not three. `CounterThemeProvider` knows "system", but
 * counter.css pins `:root { color-scheme: light }` (see the comment there:
 * the editorial routes still carry a frozen-light shadcn token set that an
 * OS-followed preference half-inverts), so "system" currently MEANS light.
 * A "System" button that always produced the light page would be a control
 * that lies. Until that pin flips to `light dark` (spec §6 Phase F), the
 * stored "system" is shown as Light, and choosing Light writes "light"
 * explicitly. Add the third option back the day the pin goes.
 *
 * The switch itself is Tier 4 motion: `data-theme-switching` on `<html>`
 * for 320ms lets every colour cross-fade (counter-repairs.css) instead of
 * cutting; reduced motion drops the transition and the cut is the design.
 */

const OPTIONS: Array<{ value: Exclude<Theme, "system">; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

const SWITCH_MS = 320

export function ThemeToggle() {
  const { theme, setTheme } = useCounterTheme()
  const shown: Exclude<Theme, "system"> = theme === "dark" ? "dark" : "light"

  function choose(next: Exclude<Theme, "system">) {
    if (next === shown) return
    const root = document.documentElement
    root.setAttribute("data-theme-switching", "")
    window.setTimeout(() => root.removeAttribute("data-theme-switching"), SWITCH_MS)
    setTheme(next)
  }

  return (
    <div className="seg" role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={shown === value}
          aria-pressed={shown === value}
          onClick={() => choose(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * The control on a `.kv` row, so Settings can put it under Timezone and the
 * other preferences without a second layout for the one row that is live.
 */
export function ThemeRow() {
  return (
    <div className="kv">
      <div>
        <span>Theme</span>
        <ThemeToggle />
      </div>
    </div>
  )
}
