"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

export type Theme = "light" | "dark" | "system"

const STORAGE_KEY = "counter-theme"

interface ThemeContextValue {
  theme: Theme
  resolved: "light" | "dark"
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** localStorage throws outright in some embedded contexts, so every access is guarded. */
function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === "light" || v === "dark" || v === "system" ? v : "system"
  } catch {
    return "system"
  }
}

function writeStored(t: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, t)
  } catch {
    /* a viewer with site data blocked still gets a working page, just not a remembered one */
  }
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
}

/**
 * "system" stamps NOTHING, so bare :root (color-scheme: light dark, resolving
 * every light-dark() token against the OS preference) does the work. An
 * explicit choice stamps data-theme (decorative — nothing in CSS reads it,
 * kept for e2e selectors) and sets color-scheme inline, which overrides the
 * :root default in both directions.
 */
function applyTheme(t: Theme): void {
  const root = document.documentElement
  if (t === "system") {
    root.removeAttribute("data-theme")
    root.style.colorScheme = ""
  } else {
    root.setAttribute("data-theme", t)
    root.style.colorScheme = t
  }
}

export function CounterThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored())
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    if (typeof matchMedia !== "function") return
    const mq = matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    writeStored(t)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolved: theme === "system" ? (systemDark ? "dark" : "light") : theme,
      setTheme,
    }),
    [theme, systemDark, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useCounterTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useCounterTheme must be used inside CounterThemeProvider")
  return ctx
}

/**
 * Runs before first paint. Without it an explicit dark choice paints light for
 * one frame on every navigation that reloads the document.
 */
export const themeNoFlashScript = `
try {
  var t = localStorage.getItem("counter-theme");
  if (t === "light" || t === "dark") {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
  }
} catch (e) {}
`
