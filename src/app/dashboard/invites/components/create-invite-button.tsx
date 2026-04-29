"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { createInvite } from "@/app/actions/invite-actions"

export function CreateInviteButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [latestUrl, setLatestUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleCreate() {
    setError(null)
    startTransition(async () => {
      const result = await createInvite()
      if ("error" in result && result.error) {
        setError(result.error)
        return
      }
      if (result.success && result.data) {
        setLatestUrl(result.data.url)
        setCopied(false)
        router.refresh()
      }
    })
  }

  async function handleCopy() {
    if (!latestUrl) return
    try {
      await navigator.clipboard.writeText(latestUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Could not copy to clipboard")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleCreate}
        disabled={isPending}
        className="inline-flex items-center justify-center self-start px-4 py-2 text-[12px] uppercase tracking-[0.08em] disabled:opacity-50"
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--paper)",
          background: "var(--ink)",
          borderRadius: 2,
        }}
      >
        {isPending ? "Generating…" : "Generate invite link"}
      </button>

      {error && (
        <div
          className="text-[12px]"
          style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}
        >
          {error}
        </div>
      )}

      {latestUrl && (
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{
            border: "1px solid var(--hairline-bold)",
            borderRadius: 2,
            background: "var(--paper)",
          }}
        >
          <code
            className="flex-1 text-[12px] truncate"
            style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}
          >
            {latestUrl}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="text-[11px] uppercase tracking-[0.08em] px-2 py-1"
            style={{
              fontFamily: "var(--font-mono)",
              color: copied ? "var(--accent)" : "var(--ink-muted)",
              border: "1px solid var(--hairline)",
              borderRadius: 2,
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  )
}
