// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
const { record, finish, refresh } = vi.hoisted(() => ({ record: vi.fn(), finish: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("@/lib/counter/actions/stock-count", () => ({ recordCountLine: record, finishStockCount: finish }))
import { useCountEntry } from "@/lib/counter/use-count-entry"
const row = { ingredientId: "beef", name: "Beef", category: "Food", unit: "lb", estimate: null, entered: 5 }
const entry = { countId: "count", open: true, rows: [row], meta: "", note: "" }
beforeEach(() => { vi.clearAllMocks(); record.mockResolvedValue({ ok: true }); finish.mockResolvedValue({ ok: true }) })

describe("stock-count saves", () => {
  it("persists a correction back to the originally loaded quantity", async () => {
    const { result } = renderHook(() => useCountEntry(entry))
    act(() => result.current.setValue("beef", "7"))
    await act(async () => { await result.current.commit(row) })
    act(() => result.current.setValue("beef", "5"))
    await act(async () => { await result.current.commit(row) })
    expect(record.mock.calls.map(([input]) => input.qty)).toEqual([7, 5])
    expect(result.current.saved.beef).toBe("ok")
  })

  it("orders rapid edits even while the first request is pending", async () => {
    let resolve!: (value: { ok: boolean }) => void
    record.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const { result } = renderHook(() => useCountEntry(entry))
    let first!: Promise<boolean>, second!: Promise<boolean>
    await act(async () => { result.current.setValue("beef", "7"); first = result.current.commit(row) })
    act(() => { result.current.setValue("beef", "5"); second = result.current.commit(row) })
    expect(record).toHaveBeenCalledTimes(1)
    await act(async () => { resolve({ ok: true }); await Promise.all([first, second]) })
    expect(record.mock.calls.map(([input]) => input.qty)).toEqual([7, 5])
  })

  it("turns a rejected request into a retryable failure", async () => {
    record.mockRejectedValueOnce(new Error("offline"))
    const { result } = renderHook(() => useCountEntry(entry))
    act(() => result.current.setValue("beef", "7"))
    await act(async () => { await result.current.commit(row) })
    expect(result.current.saved.beef).toBe("failed")
    await act(async () => { await result.current.commit(row) })
    expect(result.current.saved.beef).toBe("ok")
    expect(record).toHaveBeenCalledTimes(2)
  })

  it("saves the focused field before closing and prevents closing after a failed save", async () => {
    const { result } = renderHook(() => useCountEntry(entry))
    act(() => result.current.setValue("beef", "9"))
    record.mockResolvedValueOnce({ ok: false })
    await act(async () => result.current.finish())
    expect(finish).not.toHaveBeenCalled()
    expect(result.current.finishError).toContain("not saved")
    await act(async () => result.current.finish())
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ qty: 9 }))
    expect(finish).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("leaves untouched blanks alone but persists a typed zero", async () => {
    const blank = { ...row, entered: null }
    const { result } = renderHook(() => useCountEntry({ ...entry, rows: [blank] }))
    await act(async () => { await result.current.commit(blank) })
    expect(record).not.toHaveBeenCalled()
    act(() => result.current.setValue("beef", "0"))
    await act(async () => { await result.current.commit(blank) })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ qty: 0 }))
  })
})
