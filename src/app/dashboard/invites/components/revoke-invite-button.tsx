"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { revokeInvite } from "@/app/actions/invite-actions"

export function RevokeInviteButton({ id }: { id: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleRevoke() {
    if (!confirm("Revoke this invite? The link will stop working immediately.")) return
    startTransition(async () => {
      const result = await revokeInvite(id)
      if ("error" in result && result.error) {
        alert(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleRevoke}
      disabled={isPending}
      className="text-[11px] uppercase tracking-[0.08em] disabled:opacity-50"
      style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}
    >
      {isPending ? "Revoking…" : "Revoke"}
    </button>
  )
}
