"use client"

import { useRouter } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Props {
  stores: { id: string; name: string }[]
  selectedStoreId: string
}

export function CountEntryStorePicker({ stores, selectedStoreId }: Props) {
  const router = useRouter()
  if (stores.length <= 1) return null
  return (
    <Select
      value={selectedStoreId}
      onValueChange={(value) => {
        router.push(`/dashboard/operations/inventory/count/new?storeId=${value}`)
      }}
    >
      <SelectTrigger className="h-8 w-[160px] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {stores.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
