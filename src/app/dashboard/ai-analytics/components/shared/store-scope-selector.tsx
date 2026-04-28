"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useTransition, useCallback } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface StoreScopeSelectorProps {
  stores: { id: string; name: string }[]
  /** Currently selected store id, or `null` for the all-stores rollup. */
  value: string | null
}

/**
 * The store-scope selector at the top of every AI analytics page. Default
 * value is "All stores" (rollup). Selecting a single store navigates to the
 * same route with `?store=<id>` so the server-rendered page re-runs against
 * a different scope. Routing through the URL keeps the selection bookmarkable
 * and works without client-side state.
 */
export function StoreScopeSelector({ stores, value }: StoreScopeSelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const onChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === "all") {
        params.delete("store")
      } else {
        params.set("store", next)
      }
      const qs = params.toString()
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname)
      })
    },
    [pathname, router, searchParams],
  )

  return (
    <Select value={value ?? "all"} onValueChange={onChange}>
      <SelectTrigger
        className="h-7 gap-2 border border-(--hairline-bold) bg-[rgba(255,255,255,0.55)] px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink) hover:bg-[rgba(255,255,255,0.85)] focus:ring-0 focus:ring-offset-0 [&>svg]:size-3 [&>svg]:opacity-60"
        style={{ borderRadius: 2 }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
          Scope
        </span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        className="border border-(--hairline-bold) bg-(--paper-soft) p-0"
        style={{ borderRadius: 2 }}
      >
        <SelectItem
          value="all"
          className="font-display text-[14px] italic"
        >
          All stores
        </SelectItem>
        {stores.map((s) => (
          <SelectItem
            key={s.id}
            value={s.id}
            className="font-display text-[14px] italic"
          >
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
