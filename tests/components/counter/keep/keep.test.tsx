// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

let search = ""
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}))

import { useUrlParam, useUrlFlag } from "@/components/counter/keep/use-url-param"
import { useDraft, readDraft, writeDraft } from "@/components/counter/keep/use-draft"
import { useLeaveGuard } from "@/components/counter/keep/use-leave-guard"

beforeEach(() => {
  search = ""
  window.history.replaceState(null, "", "/dashboard/invoices/all?store=s1")
  window.localStorage.clear()
})

describe("useUrlParam", () => {
  it("reads the URL and writes picks back without dropping other params", () => {
    search = "store=s1&view=gaps"
    const { result } = renderHook(() => useUrlParam("view", "all"))
    expect(result.current[0]).toBe("gaps")
    act(() => result.current[1]("needs"))
    expect(result.current[0]).toBe("needs")
    expect(window.location.search).toBe("?store=s1&view=needs")
  })

  it("removes the key when set back to the default", () => {
    window.history.replaceState(null, "", "/x?view=gaps&store=s1")
    const { result } = renderHook(() => useUrlParam("view", "all"))
    act(() => result.current[1]("all"))
    expect(window.location.search).toBe("?store=s1")
  })

  it("waits before writing typed text", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useUrlParam("q", "", 300))
    act(() => result.current[1]("fries"))
    expect(result.current[0]).toBe("fries")
    expect(window.location.search).toBe("?store=s1")
    act(() => vi.advanceTimersByTime(300))
    expect(window.location.search).toBe("?store=s1&q=fries")
    vi.useRealTimers()
  })

  it("flags write 1 or nothing", () => {
    const { result } = renderHook(() => useUrlFlag("misses"))
    act(() => result.current[1](true))
    expect(window.location.search).toBe("?store=s1&misses=1")
    act(() => result.current[1](false))
    expect(window.location.search).toBe("?store=s1")
  })
})

describe("useDraft", () => {
  it("brings back a saved draft and clears it", () => {
    writeDraft("ask", "how were sales")
    const { result } = renderHook(() => useDraft("ask", ""))
    expect(result.current[0]).toBe("how were sales")
    act(() => result.current[1]("how were sales yesterday"))
    expect(readDraft("ask")).toBe("how were sales yesterday")
    act(() => result.current[2]())
    expect(readDraft("ask")).toBeUndefined()
  })

  it("drops a draft older than its age limit", () => {
    window.localStorage.setItem("ct-draft:old", JSON.stringify({ v: "x", at: Date.now() - 2 * 86_400_000 }))
    expect(readDraft("old")).toBeUndefined()
  })

  it("does not keep an empty value", () => {
    const { result } = renderHook(() => useDraft("q", "", { isEmpty: (v) => v === "" }))
    act(() => result.current[1]("a"))
    act(() => result.current[1](""))
    expect(window.localStorage.getItem("ct-draft:q")).toBeNull()
  })
})

describe("useLeaveGuard", () => {
  afterEach(() => vi.unstubAllGlobals())

  function clickLink(href: string) {
    const a = document.createElement("a")
    a.href = href
    document.body.appendChild(a)
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
    a.dispatchEvent(ev)
    a.remove()
    return ev.defaultPrevented
  }

  it("asks before following a link to another page while dirty", () => {
    const confirm = vi.fn(() => false)
    vi.stubGlobal("confirm", confirm)
    renderHook(() => useLeaveGuard(true))
    expect(clickLink("/dashboard/menu")).toBe(true)
    expect(confirm).toHaveBeenCalledOnce()
  })

  it("lets same-page links and clean pages through", () => {
    const confirm = vi.fn(() => false)
    vi.stubGlobal("confirm", confirm)
    const { rerender } = renderHook(({ d }) => useLeaveGuard(d), { initialProps: { d: true } })
    expect(clickLink("/dashboard/invoices/all?store=s2")).toBe(false)
    rerender({ d: false })
    expect(clickLink("/dashboard/menu")).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })
})
