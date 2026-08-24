// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CounterThemeProvider, useCounterTheme } from "@/components/counter/theme-provider"

function Probe() {
  const { theme, resolved, setTheme } = useCounterTheme()
  return (
    <>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("system")}>system</button>
    </>
  )
}

describe("counter theme", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-theme")
  })

  it("defaults to system and stamps nothing", () => {
    render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
    expect(screen.getByTestId("theme").textContent).toBe("system")
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
  })

  it("stamps data-theme on an explicit choice and persists it", () => {
    render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
    act(() => { screen.getByText("dark").click() })
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
    expect(localStorage.getItem("counter-theme")).toBe("dark")
  })

  it("removes the stamp when returning to system", () => {
    render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
    act(() => { screen.getByText("dark").click() })
    act(() => { screen.getByText("system").click() })
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
    expect(localStorage.getItem("counter-theme")).toBe("system")
  })

  it("restores a persisted choice on mount", () => {
    localStorage.setItem("counter-theme", "dark")
    render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
    expect(screen.getByTestId("theme").textContent).toBe("dark")
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
  })

  it("survives a storage accessor that throws", () => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error("blocked") }
    // The patch must not leak to later tests in this file if render() throws
    // for some unrelated reason — try/finally, not a bare reassignment after.
    try {
      expect(() =>
        render(<CounterThemeProvider><Probe /></CounterThemeProvider>),
      ).not.toThrow()
    } finally {
      Storage.prototype.getItem = original
    }
  })
})

/**
 * C1 regression (review finding, 2026-08-23): counter.css's `:root` used to
 * declare `color-scheme: light dark`, which hands every `light-dark()`
 * token to the OS preference — including on the "system" theme, where
 * CounterThemeProvider deliberately stamps nothing. Since 24 of the 30
 * shadcn token mappings in globals.css are still frozen at light HSL values
 * (nothing ever applies a `.dark` class), an OS dark preference did not
 * make the app dark — it half-inverted it: Counter surfaces went dark,
 * frozen shadcn surfaces stayed light, producing near-1:1 contrast in
 * places like `<SidebarInset>`. The fix pins `:root` to `color-scheme:
 * light`; only an explicit choice (inline `style.colorScheme`) may still
 * resolve dark.
 *
 * This asserts the actual property that broke — the resolved CSS
 * `color-scheme` used value, read off the DOM through the real
 * counter.css file, not an attribute the app sets on itself — and ties it
 * to a real colour by reading --ct-paper's own declared light/dark halves
 * out of that same file.
 */
describe("C1: color-scheme resolution under counter.css", () => {
  const COUNTER_CSS = readFileSync(join(process.cwd(), "src", "styles", "counter.css"), "utf8")

  function paperHalves(): { light: string; dark: string } {
    const m = COUNTER_CSS.match(
      /--ct-paper:\s*light-dark\(\s*(.+?)\s*,\s*(.+?)\s*\);/,
    )
    if (!m) throw new Error("--ct-paper is not declared as a light-dark() pair in counter.css")
    return { light: m[1], dark: m[2] }
  }

  function injectRealCounterCss(): () => void {
    const style = document.createElement("style")
    style.setAttribute("data-test", "counter-css")
    style.textContent = COUNTER_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }

  function mockSystemPrefersDark(prefersDark: boolean): () => void {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes("dark") ? prefersDark : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
    return () => {
      window.matchMedia = original
    }
  }

  beforeEach(() => {
    document.documentElement.style.colorScheme = ""
  })

  it("resolves the used color-scheme to light — not the OS preference — with no stored theme", () => {
    const restoreCss = injectRealCounterCss()
    const restoreMedia = mockSystemPrefersDark(true) // OS says dark
    try {
      render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
      expect(screen.getByTestId("theme").textContent).toBe("system")

      // The real used value the browser would resolve every light-dark()
      // token against, read straight off the DOM — not data-theme.
      const usedScheme = getComputedStyle(document.documentElement).colorScheme
      expect(usedScheme).toBe("light")

      // light-dark(A, B) picks A exactly when the used color-scheme is
      // "light" (CSS Color 5 §4.2) — so tie the resolved scheme to the
      // actual colour --ct-paper's background token would render as.
      const { light, dark } = paperHalves()
      const rendersAs = usedScheme === "light" ? light : dark
      expect(rendersAs).toBe(light)
      expect(light).toContain("96.2%") // the frozen light value
      expect(dark).toContain("19%") // what OS-dark would have picked pre-fix
    } finally {
      restoreMedia()
      restoreCss()
    }
  })

  it("an explicit dark choice still resolves the used color-scheme to dark", () => {
    const restoreCss = injectRealCounterCss()
    const restoreMedia = mockSystemPrefersDark(false) // OS says light, choice overrides
    try {
      render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
      act(() => { screen.getByText("dark").click() })

      const usedScheme = getComputedStyle(document.documentElement).colorScheme
      expect(usedScheme).toBe("dark")

      const { dark } = paperHalves()
      expect(dark).toContain("19%")
    } finally {
      restoreMedia()
      restoreCss()
    }
  })
})
