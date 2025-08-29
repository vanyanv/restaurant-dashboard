import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export interface StoreData {
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

export interface CreateStoreData {
  name: string
  address?: string
  phone?: string
}

const storesQueryKey = ['stores']

// Fetch all stores
async function fetchStores(): Promise<StoreData[]> {
  const response = await fetch('/api/stores')
  
  if (!response.ok) {
    throw new Error('Failed to fetch stores')
  }
  
  return response.json()
}

// Create a new store
async function createStore(data: CreateStoreData): Promise<StoreData> {
  const response = await fetch('/api/stores', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Failed to create store')
  }

  return response.json()
}

// Hook to fetch stores
export function useStores() {
  return useQuery({
    queryKey: storesQueryKey,
    queryFn: fetchStores,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// Hook to create a store
export function useCreateStore() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createStore,
    onSuccess: (newStore) => {
      // Add the new store to the cache optimistically
      queryClient.setQueryData<StoreData[]>(storesQueryKey, (old) => 
        old ? [...old, newStore] : [newStore]
      )

      // Refetch to ensure data consistency
      queryClient.invalidateQueries({ queryKey: storesQueryKey })

      toast.success('Store created successfully!', {
        description: `${newStore.name} has been added to your locations.`,
      })
    },
    onError: (error) => {
      toast.error('Failed to create store', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })
}

// Hook to get store count for analytics
export function useStoreCount() {
  const { data: stores = [] } = useStores()
  return stores.length
}