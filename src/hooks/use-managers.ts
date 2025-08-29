import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export interface Manager {
  id: string
  name: string
  email: string
  _count: {
    reports: number
  }
  managedStores?: {
    store: {
      id: string
      name: string
      address: string
    }
  }[]
}

export interface AssignedManager extends Manager {
  assignmentId: string
  assignedAt: string
}

export interface CreateManagerData {
  name: string
  email: string
  password: string
}

export interface AssignManagerData {
  managerId: string
}

const managersQueryKey = ['managers']
const storeManagersQueryKey = (storeId: string) => ['store-managers', storeId]

// Fetch all managers
async function fetchManagers(): Promise<Manager[]> {
  const response = await fetch('/api/managers')
  
  if (!response.ok) {
    throw new Error('Failed to fetch managers')
  }
  
  return response.json()
}

// Fetch managers for a specific store
async function fetchStoreManagers(storeId: string): Promise<AssignedManager[]> {
  const response = await fetch(`/api/stores/${storeId}/managers`)
  
  if (!response.ok) {
    throw new Error('Failed to fetch store managers')
  }
  
  return response.json()
}

// Create a new manager
async function createManager(data: CreateManagerData): Promise<Manager> {
  const response = await fetch('/api/managers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Failed to create manager')
  }

  return response.json()
}

// Assign manager to store
async function assignManager(storeId: string, data: AssignManagerData) {
  const response = await fetch(`/api/stores/${storeId}/managers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Failed to assign manager')
  }

  return response.json()
}

// Unassign manager from store
async function unassignManager(storeId: string, managerId: string) {
  const response = await fetch(`/api/stores/${storeId}/managers?managerId=${managerId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const errorData = await response.json()
    throw new Error(errorData.error || 'Failed to unassign manager')
  }

  return response.json()
}

// Hook to fetch all managers
export function useManagers() {
  return useQuery({
    queryKey: managersQueryKey,
    queryFn: fetchManagers,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

// Hook to fetch managers for a specific store
export function useStoreManagers(storeId: string) {
  return useQuery({
    queryKey: storeManagersQueryKey(storeId),
    queryFn: () => fetchStoreManagers(storeId),
    enabled: !!storeId,
    staleTime: 2 * 60 * 1000, // 2 minutes (more frequent updates for assignments)
  })
}

// Hook to create a manager
export function useCreateManager() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createManager,
    onSuccess: (newManager) => {
      // Add to managers cache
      queryClient.setQueryData<Manager[]>(managersQueryKey, (old) => 
        old ? [...old, newManager] : [newManager]
      )

      // Refetch managers to ensure consistency
      queryClient.invalidateQueries({ queryKey: managersQueryKey })

      toast.success('Manager created successfully!', {
        description: `${newManager.name} has been added as a manager.`,
      })
    },
    onError: (error) => {
      toast.error('Failed to create manager', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })
}

// Hook to assign manager to store
export function useAssignManager(storeId: string, storeName: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: AssignManagerData) => assignManager(storeId, data),
    onSuccess: (assignment) => {
      // Invalidate both managers list and store managers
      queryClient.invalidateQueries({ queryKey: managersQueryKey })
      queryClient.invalidateQueries({ queryKey: storeManagersQueryKey(storeId) })
      queryClient.invalidateQueries({ queryKey: ['stores'] }) // Update store manager counts

      toast.success('Manager assigned successfully!', {
        description: `${assignment.manager.name} is now managing ${storeName}.`,
      })
    },
    onError: (error) => {
      toast.error('Failed to assign manager', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })
}

// Hook to unassign manager from store
export function useUnassignManager(storeId: string, storeName: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (managerId: string) => unassignManager(storeId, managerId),
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: managersQueryKey })
      queryClient.invalidateQueries({ queryKey: storeManagersQueryKey(storeId) })
      queryClient.invalidateQueries({ queryKey: ['stores'] })

      toast.success('Manager unassigned successfully!', {
        description: `Manager is no longer managing ${storeName}.`,
      })
    },
    onError: (error) => {
      toast.error('Failed to unassign manager', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })
}

// Hook to get available managers (not assigned to a specific store)
export function useAvailableManagers(storeId: string) {
  const { data: allManagers = [] } = useManagers()
  const { data: storeManagers = [] } = useStoreManagers(storeId)
  
  const assignedManagerIds = new Set(storeManagers.map(m => m.id))
  const availableManagers = allManagers.filter(m => !assignedManagerIds.has(m.id))
  
  return {
    data: availableManagers,
    isLoading: false, // Derived data, not loading
  }
}