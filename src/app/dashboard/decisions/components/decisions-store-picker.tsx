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
  selectedStoreId: string | undefined
}

const ALL_STORES = "__all__"

export function DecisionsStorePicker({ stores, selectedStoreId }: Props) {
  const router = useRouter()
  if (stores.length <= 1) return null
  return (
    <Select
      value={selectedStoreId ?? ALL_STORES}
      onValueChange={(value) => {
        if (value === ALL_STORES) {
          router.push("/dashboard/decisions")
        } else {
          router.push(`/dashboard/decisions?storeId=${value}`)
        }
      }}
    >
      <SelectTrigger className="h-8 w-[160px] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_STORES}>All stores</SelectItem>
        {stores.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
