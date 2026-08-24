"use client"

import { Monitor, Moon, Sun } from "lucide-react"
import { useCounterTheme, type Theme } from "./theme-provider"

const OPTIONS: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
]

export function ThemeToggle() {
  const { theme, setTheme } = useCounterTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex rounded-ct-sm border border-ct-line bg-ct-chrome p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          onClick={() => setTheme(value)}
          className={
            theme === value
              ? "rounded-ct-sm bg-ct-surface px-2 py-1 text-ct-ink"
              : "rounded-ct-sm px-2 py-1 text-ct-ink-3 hover:text-ct-ink"
          }
        >
          <Icon size={14} aria-hidden />
        </button>
      ))}
    </div>
  )
}
