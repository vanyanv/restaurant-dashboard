"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"

/**
 * A page pick (a filter, a search, a tab) that lives in the URL, so leaving
 * and coming back — Back, a reload, a reopened tab, the home-screen app
 * reopening its last page — brings it back.
 *
 * The URL is written with `history.replaceState`, which the App Router keeps
 * in step with `useSearchParams` WITHOUT a server round-trip: a keystroke in
 * a search box must not re-run the page's loaders. `replace`, not `push`, so
 * Back leaves the page instead of stepping through every keystroke. Text is
 * written after a short pause; state updates at once.
 *
 * `fallback` is never written: picking the default removes the key, so the
 * plain link stays plain.
 */
export function useUrlParam(
  key: string,
  fallback = "",
  delayMs = 0,
  /** What to show first when the URL has no value (e.g. the server read it). */
  initial?: string,
): [string, (next: string) => void] {
  const params = useSearchParams()
  const fromUrl = params.get(key)
  const [value, setValue] = useState<string>(fromUrl ?? initial ?? fallback)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Another control (Back/Forward, a link with the key) changed the URL.
  const last = useRef(fromUrl)
  useEffect(() => {
    if (fromUrl === last.current) return
    last.current = fromUrl
    setValue(fromUrl ?? fallback)
  }, [fromUrl, fallback])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const set = useCallback(
    (next: string) => {
      setValue(next)
      const write = () => {
        const url = new URL(window.location.href)
        if (next === fallback || next === "") url.searchParams.delete(key)
        else url.searchParams.set(key, next)
        last.current = url.searchParams.get(key)
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
      }
      if (timer.current) clearTimeout(timer.current)
      if (delayMs > 0) timer.current = setTimeout(write, delayMs)
      else write()
    },
    [key, fallback, delayMs],
  )

  return [value, set]
}

/** A yes/no pick in the URL (`key=1` when on). */
export function useUrlFlag(key: string): [boolean, (next: boolean) => void] {
  const [raw, set] = useUrlParam(key, "")
  return [raw === "1", useCallback((next: boolean) => set(next ? "1" : ""), [set])]
}
