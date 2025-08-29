"use client"

import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Store } from "lucide-react"

interface Store {
  id: string
  name: string
  address: string | null
  phone: string | null
  isActive: boolean
}

interface StoreSelectorProps {
  value: string
  onChange: (storeId: string) => void
}

export function StoreSelector({ value, onChange }: StoreSelectorProps) {
  const [stores, setStores] = useState<Store[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchStores = async () => {
      try {
        const response = await fetch("/api/manager/stores")
        if (response.ok) {
          const data = await response.json()
          setStores(data.filter((store: Store) => store.isActive))
          
          // Auto-select if only one store
          if (data.length === 1 && !value) {
            onChange(data[0].id)
          }
        }
      } catch (error) {
        console.error("Failed to fetch stores:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchStores()
  }, [onChange, value])

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label>Store Location</Label>
        <div className="h-10 bg-muted animate-pulse rounded-md" />
      </div>
    )
  }

  if (stores.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Store Location</Label>
        <div className="text-sm text-muted-foreground p-3 border rounded-md">
          No stores assigned. Please contact your administrator.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="store">Store Location *</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="store">
          <SelectValue placeholder="Select a store">
            {value && (
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4" />
                <span>{stores.find(s => s.id === value)?.name}</span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {stores.map((store) => (
            <SelectItem key={store.id} value={store.id}>
              <div className="flex flex-col">
                <span className="font-medium">{store.name}</span>
                {store.address && (
                  <span className="text-xs text-muted-foreground">{store.address}</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}