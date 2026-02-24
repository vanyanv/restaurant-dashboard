"use client"

import { useState, useCallback, useRef } from "react"
import type { InvoiceSyncProgressEvent } from "@/types/invoice"

interface UseInvoiceSyncReturn {
  isSyncing: boolean
  isComplete: boolean
  isError: boolean
  progress: InvoiceSyncProgressEvent | null
  startSync: () => void
  reset: () => void
}

export function useInvoiceSync(onComplete?: () => void): UseInvoiceSyncReturn {
  const [isSyncing, setIsSyncing] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [isError, setIsError] = useState(false)
  const [progress, setProgress] = useState<InvoiceSyncProgressEvent | null>(null)
  const syncingRef = useRef(false)

  const startSync = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setIsSyncing(true)
    setIsComplete(false)
    setIsError(false)
    setProgress(null)

    try {
      const response = await fetch("/api/invoices/sync", {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        signal: AbortSignal.timeout(150_000),
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
          const event: InvoiceSyncProgressEvent = JSON.parse(dataLine.slice(6))
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
        counts: { scanned: 0, created: 0, skipped: 0, errors: 0 },
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
