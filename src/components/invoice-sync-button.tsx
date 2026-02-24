"use client"

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw, Check } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { useInvoiceSync } from "@/hooks/use-invoice-sync"
import { AnimatePresence, motion } from "framer-motion"

interface InvoiceSyncButtonProps {
  lastSyncAt?: string | null
  variant?: "default" | "outline" | "ghost"
  size?: "sm" | "default" | "lg"
}

function getLastSyncText(lastSyncAt: string | null | undefined): string {
  if (!lastSyncAt) return "Never synced"
  const date = new Date(lastSyncAt)
  const diffHours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60))
  if (diffHours < 1) return "Synced recently"
  if (diffHours < 24) return `Synced ${diffHours}h ago`
  if (diffHours < 168) return `Synced ${Math.floor(diffHours / 24)}d ago`
  return "Synced over a week ago"
}

const PHASE_LABELS: Record<string, string> = {
  "fetching-emails": "Emails",
  extracting: "Extracting",
  matching: "Matching",
  writing: "Saving",
}

export function InvoiceSyncButton({
  lastSyncAt,
  variant = "outline",
  size = "sm",
}: InvoiceSyncButtonProps) {
  const router = useRouter()
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { isSyncing, isComplete, isError, progress, startSync, reset } = useInvoiceSync(() => {
    router.refresh()
  })

  useEffect(() => {
    if (isComplete && progress) {
      const { counts } = progress
      const parts: string[] = []
      if (counts.created > 0) parts.push(`${counts.created} invoices`)
      if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`)
      if (parts.length > 0) {
        toast.success(`Invoice sync: ${parts.join(", ")}`)
      } else {
        toast.info("No new invoices found")
      }
      completeTimerRef.current = setTimeout(reset, 2000)
    }
    return () => {
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current)
    }
  }, [isComplete, progress, reset])

  useEffect(() => {
    if (isError && progress?.error) {
      toast.error(progress.error)
      completeTimerRef.current = setTimeout(reset, 2500)
    }
    return () => {
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current)
    }
  }, [isError, progress?.error, reset])

  const showProgress = isSyncing || isComplete || isError
  const pct = progress?.totalProgress ?? 0
  const phaseLabel = progress ? PHASE_LABELS[progress.phase] || "" : ""

  return (
    <div className="relative">
      <AnimatePresence mode="wait" initial={false}>
        {showProgress ? (
          <motion.div
            key="progress"
            initial={{ opacity: 0, width: size === "sm" ? 32 : 120 }}
            animate={{ opacity: 1, width: 200 }}
            exit={{ opacity: 0, width: size === "sm" ? 32 : 120 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="h-8 rounded-md border border-border relative overflow-hidden cursor-default"
          >
            <motion.div
              className={`absolute inset-y-0 left-0 ${
                isComplete
                  ? "bg-emerald-500/20"
                  : isError
                    ? "bg-destructive/15"
                    : "bg-primary/12"
              }`}
              initial={{ width: "0%" }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />

            {isSyncing && (
              <motion.div
                className="absolute inset-y-0 left-0 w-full"
                style={{
                  background:
                    "linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.06) 50%, transparent 100%)",
                  backgroundSize: "200% 100%",
                }}
                animate={{ backgroundPosition: ["200% 0", "-200% 0"] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
            )}

            <div className="relative flex items-center justify-between px-2.5 h-full text-xs select-none">
              {isComplete ? (
                <motion.div
                  className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Done</span>
                </motion.div>
              ) : isError ? (
                <span className="text-destructive font-medium">Sync failed</span>
              ) : (
                <>
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {pct}%
                  </span>
                  <span className="text-muted-foreground truncate ml-2">
                    {phaseLabel}
                  </span>
                </>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Button
              variant={variant}
              size={size}
              onClick={startSync}
              disabled={isSyncing}
              className="flex items-center gap-2"
              title={`Sync invoices from email — ${getLastSyncText(lastSyncAt)}`}
            >
              <RefreshCw className="h-4 w-4" />
              {size !== "sm" && <span>Sync Invoices</span>}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
