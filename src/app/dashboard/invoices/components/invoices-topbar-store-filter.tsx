"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { Building2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface InvoicesStoreFilterProps {
  stores: { id: string; name: string }[]
  current: string
}

export function InvoicesStoreFilter({
  stores,
  current,
}: InvoicesStoreFilterProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleChange = (value: string) => {
    startTransition(() => {
      const params = new URLSearchParams()
      if (value !== "all") params.set("storeId", value)
      const qs = params.toString()
      router.replace(
        qs ? `/dashboard/invoices?${qs}` : "/dashboard/invoices",
        { scroll: false }
      )
    })
  }

  if (stores.length === 0) return null

  return (
    <Select value={current} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="w-[160px] h-8 text-xs">
        <Building2 className="h-3.5 w-3.5 mr-1.5 shrink-0 text-muted-foreground" />
        <SelectValue placeholder="All Stores" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Stores</SelectItem>
        {stores.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
