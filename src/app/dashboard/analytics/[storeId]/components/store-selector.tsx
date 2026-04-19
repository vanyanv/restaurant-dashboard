"use client"

import { useRouter } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BarChart3 } from "lucide-react"

interface StoreSelectorProps {
  currentStoreId: string
  allStores: { id: string; name: string }[]
}

export function StoreSelector({
  currentStoreId,
  allStores,
}: StoreSelectorProps) {
  const router = useRouter()
  const handleChange = (newStoreId: string) => {
    if (newStoreId === "all") {
      router.push("/dashboard/analytics")
    } else {
      router.push(`/dashboard/analytics/${newStoreId}`)
    }
  }

  return (
    <Select value={currentStoreId} onValueChange={handleChange}>
      <SelectTrigger className="h-8 w-[140px] sm:w-[180px] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5" />
            All Stores
          </div>
        </SelectItem>
        {allStores.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
