"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw, Check } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

interface RatingsSyncButtonProps {
  variant?: "default" | "outline" | "ghost"
  size?: "sm" | "default" | "lg"
  onSyncComplete?: () => void
}

export function RatingsSyncButton({
  variant = "outline",
  size = "sm",
  onSyncComplete,
}: RatingsSyncButtonProps) {
  const router = useRouter()
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDone, setIsDone] = useState(false)

  const startSync = useCallback(async () => {
    if (isSyncing) return
    setIsSyncing(true)
    setIsDone(false)

    try {
      const response = await fetch("/api/otter/ratings-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 21 }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Ratings sync failed")
      }

      const result = await response.json()
      setIsDone(true)

      if (result.synced > 0) {
        toast.success(`Synced ${result.synced} ratings`)
      } else {
        toast.warning("No ratings found to sync")
      }

      onSyncComplete?.()
      router.refresh()

      setTimeout(() => setIsDone(false), 2000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ratings sync failed")
    } finally {
      setIsSyncing(false)
    }
  }, [isSyncing, onSyncComplete, router])

  return (
    <Button
      variant={variant}
      size={size}
      onClick={startSync}
      disabled={isSyncing}
      className="flex items-center gap-2"
      title="Sync customer ratings from Otter"
    >
      {isDone ? (
        <Check className="h-4 w-4 text-emerald-600" />
      ) : (
        <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
      )}
      {size !== "sm" && <span>{isSyncing ? "Syncing..." : isDone ? "Done" : "Sync Ratings"}</span>}
    </Button>
  )
}
