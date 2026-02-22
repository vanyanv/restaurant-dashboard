"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

interface OtterSyncButtonProps {
  lastSyncAt?: Date | string | null
  variant?: "default" | "outline" | "ghost"
  size?: "sm" | "default" | "lg"
}

function getLastSyncText(lastSyncAt: Date | string | null | undefined): string {
  if (!lastSyncAt) return "Never synced"
  const date = typeof lastSyncAt === "string" ? new Date(lastSyncAt) : lastSyncAt
  const diffHours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60))
  if (diffHours < 1) return "Synced recently"
  if (diffHours < 24) return `Synced ${diffHours}h ago`
  if (diffHours < 168) return `Synced ${Math.floor(diffHours / 24)}d ago`
  return "Synced over a week ago"
}

export function OtterSyncButton({
  lastSyncAt,
  variant = "outline",
  size = "sm",
}: OtterSyncButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSync = async () => {
    setIsLoading(true)
    try {
      const response = await fetch("/api/otter/sync", { method: "POST" })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to sync Otter data")
      }

      const { synced, failed, storesProcessed } = data
      if (synced > 0) {
        toast.success(
          `Otter sync complete: ${synced} rows synced across ${storesProcessed} store${storesProcessed === 1 ? "" : "s"}${failed > 0 ? ` (${failed} failed)` : ""}`
        )
      } else {
        toast.warning(data.message || "No rows synced")
      }

      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to sync Otter data")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleSync}
      disabled={isLoading}
      className="flex items-center gap-2"
      title={`Sync Otter financial data — ${getLastSyncText(lastSyncAt)}`}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      {size !== "sm" && (
        <span>{isLoading ? "Syncing..." : "Sync Otter"}</span>
      )}
    </Button>
  )
}
