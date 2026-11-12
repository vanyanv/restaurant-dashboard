"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Work in progress that survives leaving the page: a half-typed question, a
 * count in the middle of the walk, a waste entry not yet logged. Kept in this
 * browser's localStorage under `ct-draft:<key>`, dropped after `maxAgeMs`
 * (default a day) and by `clear()` once the work is saved.
 *
 * The first render uses `initial` and the stored value is read after mount,
 * so the server render and the first client render agree (no hydration
 * mismatch). `restored` turns true once that read has happened, for callers
 * that must not save before it.
 */
const DAY_MS = 24 * 60 * 60 * 1000

interface Stored<T> {
  v: T
  at: number
}

function storageKey(key: string) {
  return `ct-draft:${key}`
}

export function readDraft<T>(key: string, maxAgeMs = DAY_MS): T | undefined {
  try {
    const raw = window.localStorage.getItem(storageKey(key))
    if (!raw) return undefined
    const s = JSON.parse(raw) as Stored<T>
    if (!s || typeof s.at !== "number" || Date.now() - s.at > maxAgeMs) {
      window.localStorage.removeItem(storageKey(key))
      return undefined
    }
    return s.v
  } catch {
    return undefined
  }
}

export function writeDraft<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify({ v: value, at: Date.now() } satisfies Stored<T>))
  } catch {
    /* storage full or blocked: the draft simply is not kept */
  }
}

export function clearDraft(key: string) {
  try {
    window.localStorage.removeItem(storageKey(key))
  } catch {
    /* nothing to clear */
  }
}

export function useDraft<T>(
  key: string | null,
  initial: T,
  { maxAgeMs = DAY_MS, isEmpty }: { maxAgeMs?: number; isEmpty?: (v: T) => boolean } = {},
): [T, (next: T | ((prev: T) => T)) => void, () => void, boolean] {
  const [value, setValue] = useState<T>(initial)
  const [restored, setRestored] = useState(false)
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    setRestored(false)
    if (!key) {
      setRestored(true)
      return
    }
    const saved = readDraft<T>(key, maxAgeMs)
    if (saved !== undefined) setValue(saved)
    setRestored(true)
    // `initial` and `maxAgeMs` are read once per key on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!restored || !key) return
    if (isEmpty?.(value)) clearDraft(key)
    else writeDraft(key, value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, restored, key])

  const clear = useCallback(() => {
    if (keyRef.current) clearDraft(keyRef.current)
  }, [])

  return [value, setValue, clear, restored]
}
