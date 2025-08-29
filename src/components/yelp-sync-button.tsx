"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw, Star } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

interface YelpSyncButtonProps {
  storeId: string
  storeName: string
  hasAddress: boolean
  lastSync?: Date | string | null
  variant?: "default" | "outline" | "ghost"
  size?: "sm" | "default" | "lg"
}

export function YelpSyncButton({
  storeId,
  storeName,
  hasAddress,
  lastSync,
  variant = "outline",
  size = "sm"
}: YelpSyncButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSync = async () => {
    if (!hasAddress) {
      toast.error("Cannot sync Yelp data for store without address")
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/yelp/sync/${storeId}`, {
        method: "POST",
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to sync Yelp data")
      }

      if (data.found) {
        toast.success(`✨ ${data.message}`)
      } else {
        toast.warning(`🔍 ${data.message}`)
      }
      
      // Refresh the page to show updated data
      router.refresh()
      
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to sync Yelp data")
    } finally {
      setIsLoading(false)
    }
  }

  const getLastSyncText = () => {
    if (!lastSync) return "Never synced"
    const date = typeof lastSync === 'string' ? new Date(lastSync) : lastSync
    const now = new Date()
    const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffHours < 1) return "Synced recently"
    if (diffHours < 24) return `Synced ${diffHours}h ago`
    if (diffHours < 168) return `Synced ${Math.floor(diffHours / 24)}d ago`
    return "Synced over a week ago"
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleSync}
      disabled={isLoading || !hasAddress}
      className="flex items-center gap-2"
      title={
        !hasAddress 
          ? "Add store address to sync Yelp rating" 
          : `Sync Yelp rating for ${storeName} - ${getLastSyncText()}`
      }
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      {size !== "sm" && (
        <span>
          {isLoading ? "Syncing..." : "Sync Yelp"}
        </span>
      )}
    </Button>
  )
}

// Bulk sync button for syncing all stores
export function YelpSyncAllButton() {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSyncAll = async () => {
    setIsLoading(true)
    try {
      const response = await fetch("/api/yelp/sync", {
        method: "POST",
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to sync Yelp data")
      }

      const { synced, failed, skipped } = data
      
      if (synced > 0) {
        toast.success(`✨ Synced ${synced} store${synced === 1 ? '' : 's'}!${failed > 0 ? ` (${failed} failed)` : ''}`)
      } else if (skipped > 0) {
        toast.info(`⏭️ ${skipped} store${skipped === 1 ? '' : 's'} skipped (recently synced)`)
      } else {
        toast.warning("No stores were synced")
      }
      
      // Show details in console for debugging
      if (process.env.NODE_ENV === 'development') {
        console.log("Yelp sync results:", data.details)
      }
      
      // Refresh the page to show updated data
      router.refresh()
      
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to sync Yelp data")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      onClick={handleSyncAll}
      disabled={isLoading}
      className="flex items-center gap-2"
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Star className="h-4 w-4" />
      )}
      {isLoading ? "Syncing All..." : "Sync All Yelp Ratings"}
    </Button>
  )
}