// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
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
    expect(() =>
      render(<CounterThemeProvider><Probe /></CounterThemeProvider>),
    ).not.toThrow()
    Storage.prototype.getItem = original
  })
})
