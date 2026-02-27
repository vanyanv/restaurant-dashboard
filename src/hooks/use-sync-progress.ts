"use client"

import { useState, useCallback, useRef } from "react"
import type { SyncProgressEvent } from "@/types/sync"

interface UseSyncProgressReturn {
  isSyncing: boolean
  isComplete: boolean
  isError: boolean
  progress: SyncProgressEvent | null
  startSync: () => void
  reset: () => void
}

export function useSyncProgress(onComplete?: () => void): UseSyncProgressReturn {
  const [isSyncing, setIsSyncing] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [isError, setIsError] = useState(false)
  const [progress, setProgress] = useState<SyncProgressEvent | null>(null)
  const syncingRef = useRef(false)

  const startSync = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setIsSyncing(true)
    setIsComplete(false)
    setIsError(false)
    setProgress(null)

    try {
      const response = await fetch("/api/otter/sync", {
        method: "POST",
        headers: { Accept: "text/event-stream" },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Sync failed")
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split("\n\n")
        buffer = chunks.pop() || ""

        for (const chunk of chunks) {
          const dataLine = chunk
            .split("\n")
            .find((l) => l.startsWith("data: "))
          if (!dataLine) continue
          const event: SyncProgressEvent = JSON.parse(dataLine.slice(6))
          setProgress(event)

          if (event.phase === "complete") {
            setIsSyncing(false)
            setIsComplete(true)
            syncingRef.current = false
            onComplete?.()
          }
          if (event.phase === "error") {
            setIsSyncing(false)
            setIsError(true)
            syncingRef.current = false
          }
        }
      }
    } catch (err) {
      setIsSyncing(false)
      setIsError(true)
      syncingRef.current = false
      setProgress({
        phase: "error",
        status: "error",
        totalProgress: 0,
        detail: err instanceof Error ? err.message : "Connection lost",
        counts: { daily: 0, categories: 0, items: 0, modifiers: 0 },
        error: err instanceof Error ? err.message : "Connection lost",
      })
    }
  }, [onComplete])

  const reset = useCallback(() => {
    setIsComplete(false)
    setIsError(false)
    setProgress(null)
  }, [])

  return { isSyncing, isComplete, isError, progress, startSync, reset }
}
