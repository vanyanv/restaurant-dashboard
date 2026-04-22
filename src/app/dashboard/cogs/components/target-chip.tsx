"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { setStoreTargetCogsPct } from "@/app/actions/cogs-actions"

export function TargetChip({
  storeId,
  initialValue,
}: {
  storeId: string
  initialValue: number | null
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState<string>(
    initialValue != null ? String(initialValue) : ""
  )
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const submit = () => {
    const next = value.trim() === "" ? null : Number(value)
    startTransition(async () => {
      const r = await setStoreTargetCogsPct({
        storeId,
        targetCogsPct: next,
      })
      if ("error" in r) {
        toast.error(r.error)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="cogs-target-stamp"
        onClick={() => setEditing(true)}
        aria-label="Edit COGS target"
      >
        Target ·{" "}
        <span className="cogs-target-stamp__value">
          {initialValue != null ? `${initialValue.toFixed(1)}%` : "set"}
        </span>
      </button>
    )
  }

  return (
    <span className="cogs-target-stamp">
      Target ·{" "}
      <input
        type="number"
        min={0}
        max={100}
        step={0.1}
        autoFocus
        disabled={isPending}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit()
          if (e.key === "Escape") {
            setValue(initialValue != null ? String(initialValue) : "")
            setEditing(false)
          }
        }}
        className="w-12 bg-transparent border-b border-(--hairline-bold) font-mono text-[11px] text-(--ink) focus:outline-none"
      />
      <span className="font-mono">%</span>
    </span>
  )
}
