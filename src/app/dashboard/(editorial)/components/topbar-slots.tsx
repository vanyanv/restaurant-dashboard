"use client"

import { useRouter } from "next/navigation"
import { Store } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"

export function MobileStoreSwitcher({
  stores,
}: {
  stores: { id: string; name: string }[]
}) {
  const router = useRouter()
  if (stores.length <= 1) return null

  return (
    <Select onValueChange={(id) => router.push(`/dashboard/analytics/${id}`)}>
      <SelectTrigger className="sm:hidden h-8 w-8 px-0 justify-center [&>svg:last-child]:hidden">
        <Store className="h-3.5 w-3.5" />
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
