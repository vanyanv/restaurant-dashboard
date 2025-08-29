"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Store, Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"

interface StoreData {
  id: string
  name: string
  address: string | null
  phone: string | null
  isActive: boolean
  _count: {
    managers: number
    reports: number
  }
}

interface StoreSelectorProps {
  stores: StoreData[]
  currentStoreId?: string
  onStoreSelect?: (storeId: string) => void
  showAllOption?: boolean
  className?: string
}

export function StoreSelector({ 
  stores, 
  currentStoreId, 
  onStoreSelect,
  showAllOption = true,
  className 
}: StoreSelectorProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const handleSelect = (storeId: string) => {
    setOpen(false)
    if (onStoreSelect) {
      onStoreSelect(storeId)
    } else {
      // Default behavior - navigate to store page
      if (storeId === "all") {
        router.push("/dashboard/stores")
      } else {
        router.push(`/dashboard/stores/${storeId}`)
      }
    }
  }

  const currentStore = stores.find(store => store.id === currentStoreId)
  
  const displayText = currentStoreId === "all" 
    ? "All Stores" 
    : currentStore?.name || "Select store..."

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-[300px] justify-between", className)}
        >
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4" />
            <span className="truncate">{displayText}</span>
            {currentStore && (
              <Badge variant={currentStore.isActive ? "default" : "secondary"} className="ml-auto">
                {currentStore.isActive ? "Active" : "Inactive"}
              </Badge>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Search stores..." />
          <CommandList>
            <CommandEmpty>No stores found.</CommandEmpty>
            <CommandGroup>
              {showAllOption && (
                <CommandItem
                  value="all"
                  onSelect={() => handleSelect("all")}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      currentStoreId === "all" ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4" />
                    <span>All Stores</span>
                  </div>
                </CommandItem>
              )}
              {stores.map((store) => (
                <CommandItem
                  key={store.id}
                  value={store.name}
                  onSelect={() => handleSelect(store.id)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      currentStoreId === store.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-1 items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Store className="h-4 w-4" />
                      <div>
                        <div className="font-medium">{store.name}</div>
                        {store.address && (
                          <div className="text-xs text-muted-foreground truncate">
                            {store.address}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={store.isActive ? "default" : "secondary"} className="text-xs">
                        {store.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}