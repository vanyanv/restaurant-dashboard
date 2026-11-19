"use client"

import { useEffect, useOptimistic, useState, useTransition } from "react"

/** What every Counter server action returns. */
export type ActResult = { ok: true } | { ok: false; error: string }

/** Where one tap stands: nothing yet, working, just done, or it did not save. */
export type ActState = "idle" | "busy" | "done" | "failed"

/** How long a done button keeps its tick before it reads as itself again. */
export const DONE_MS = 1600

type Running = { key: string | null; phase: ActState; error: string | null; done?: string }

/**
 * One place for what a tap looks like while it saves: the button that was
 * tapped shows it is working, then a tick; a failure comes back as words the
 * page shows next to it. A page holds one `useAct` per group of buttons and
 * names each tap with a key, so only the tapped button changes.
 *
 * `optimistic` runs inside the same transition before the save is awaited,
 * so a page can show the result straight away (a row leaving, a count going
 * down) with `useOptimistic`; React puts it back by itself if the save fails.
 * Use it only where a failed save is cheap to show and undo: money and
 * anything that writes to the store's books still waits for the answer.
 *
 * ```tsx
 * const { act, stateOf, error } = useAct()
 * <Button state={stateOf("approve")} doneLabel="Approved"
 *   onClick={() => act("approve", () => approve(id), { onDone: () => router.refresh() })}>
 *   Approve and post
 * </Button>
 * ```
 */
export function useAct() {
  const [, start] = useTransition()
  const [run, setRun] = useState<Running>({ key: null, phase: "idle", error: null })

  useEffect(() => {
    if (run.phase !== "done") return
    const t = setTimeout(() => setRun({ key: null, phase: "idle", error: null }), DONE_MS)
    return () => clearTimeout(t)
  }, [run])

  const act = (
    key: string,
    work: () => Promise<ActResult>,
    opts: {
      /** The words the button shows when done, fixed at the tap (the page may refresh under it). */
      done?: string
      optimistic?: () => void
      onDone?: () => void
      onFailed?: (error: string) => void
    } = {},
  ) => {
    setRun({ key, phase: "busy", error: null, done: opts.done })
    start(async () => {
      opts.optimistic?.()
      let result: ActResult
      try {
        result = await work()
      } catch {
        result = { ok: false, error: "network" }
      }
      if (!result.ok) {
        setRun({ key, phase: "failed", error: result.error })
        opts.onFailed?.(result.error)
        return
      }
      setRun({ key, phase: "done", error: null, done: opts.done })
      opts.onDone?.()
    })
  }

  return {
    act,
    /** The state of the button named `key`; every other button reads "idle". */
    stateOf: (key: string): ActState => (run.key === key ? run.phase : "idle"),
    /** The done words the tap on `key` asked for, while it is done. */
    doneOf: (key: string): string | undefined => (run.key === key && run.phase === "done" ? run.done : undefined),
    /** True while any tap in this group is saving, to hold the other buttons. */
    busy: run.phase === "busy",
    /** The error code of the last tap, when it did not save. */
    error: run.phase === "failed" ? run.error : null,
  }
}

/**
 * Rows a tap has just finished, shown leaving at once. A key is marked inside
 * `useAct`'s `optimistic` (so a failed save brings the row back by itself)
 * and kept after a save succeeds, until the refreshed list no longer has it.
 */
export function useLeaving() {
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set())
  const [shown, mark] = useOptimistic(left, (s: ReadonlySet<string>, key: string) => new Set(s).add(key))
  return {
    /** Call inside `optimistic`. */
    mark,
    /** Call in `onDone`, so the row stays gone once the save is in. */
    keep: (key: string) => setLeft((s) => new Set(s).add(key)),
    /** Call in `onUndo`, to bring the row back. */
    restore: (key: string) =>
      setLeft((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      }),
    isLeaving: (key: string) => shown.has(key),
  }
}

/**
 * The attributes a plain `<button>` (not the shared `Button`) needs to show
 * a tap's state: the working mark while it saves, the green tick once done.
 * `counter-motion.css` draws both from these.
 */
export function actMarks(state: ActState) {
  return {
    "aria-busy": state === "busy" || undefined,
    "data-state": state === "busy" || state === "done" ? state : undefined,
  } as const
}
