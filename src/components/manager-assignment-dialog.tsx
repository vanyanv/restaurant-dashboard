"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Users, UserPlus, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ManagerCreationDialog } from "./manager-creation-dialog"
import { 
  getManagers, 
  getStoreManagers, 
  assignManager, 
  unassignManager 
} from "@/app/actions/manager-actions"

interface Manager {
  id: string
  name: string
  email: string
  _count: {
    reports: number
  }
}

interface AssignedManager extends Manager {
  assignmentId: string
  assignedAt: string
}

interface ManagerAssignmentDialogProps {
  storeId: string
  storeName: string
}

export function ManagerAssignmentDialog({
  storeId,
  storeName
}: ManagerAssignmentDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [availableManagers, setAvailableManagers] = useState<Manager[]>([])
  const [assignedManagers, setAssignedManagers] = useState<AssignedManager[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)
  const [selectedManagerId, setSelectedManagerId] = useState<string>("")

  const fetchManagerData = async () => {
    if (!open) return

    try {
      setIsLoading(true)
      
      const [allManagers, storeManagers] = await Promise.all([
        getManagers(),
        getStoreManagers(storeId)
      ])

      setAssignedManagers(storeManagers)
      
      const assignedManagerIds = new Set(storeManagers.map(m => m.id))
      const available = allManagers.filter(m => !assignedManagerIds.has(m.id))
      setAvailableManagers(available)

    } catch (error) {
      console.error('Error fetching manager data:', error)
      toast.error('Failed to load manager data')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAssignManager = async () => {
    if (!selectedManagerId) return

    try {
      setIsAssigning(true)

      const result = await assignManager(storeId, selectedManagerId)

      if (result.error) {
        throw new Error(result.error)
      }

      toast.success('Manager assigned successfully!', {
        description: `Manager is now managing ${storeName}.`,
      })

      setSelectedManagerId("")
      router.refresh()
      await fetchManagerData()

    } catch (error) {
      console.error('Error assigning manager:', error)
      toast.error('Failed to assign manager', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setIsAssigning(false)
    }
  }

  const handleUnassignManager = async (managerId: string, managerName: string) => {
    try {
      const result = await unassignManager(storeId, managerId)

      if (result.error) {
        throw new Error(result.error)
      }

      toast.success('Manager unassigned successfully!', {
        description: `${managerName} is no longer managing ${storeName}.`,
      })

      router.refresh()
      await fetchManagerData()

    } catch (error) {
      console.error('Error unassigning manager:', error)
      toast.error('Failed to unassign manager', {
        description: error instanceof Error ? error.message : 'Please try again.',
      })
    }
  }

  useEffect(() => {
    if (open) {
      fetchManagerData()
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Users className="mr-2 h-4 w-4" />
          Manage Staff
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Manage Store Staff - {storeName}
          </DialogTitle>
          <DialogDescription>
            Assign managers to this store location or remove existing assignments.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading manager data...</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Assign New Manager */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Assign Manager</h3>
                <ManagerCreationDialog 
                  triggerClassName="h-9 px-3"
                />
              </div>
              
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select 
                    value={selectedManagerId} 
                    onValueChange={setSelectedManagerId}
                    disabled={isAssigning}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a manager to assign" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableManagers.length === 0 ? (
                        <div className="p-2 text-sm text-muted-foreground">
                          All managers are already assigned
                        </div>
                      ) : (
                        availableManagers.map((manager) => (
                          <SelectItem key={manager.id} value={manager.id}>
                            <div className="flex flex-col">
                              <span className="font-medium">{manager.name}</span>
                              <span className="text-sm text-muted-foreground">
                                {manager.email}
                              </span>
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  onClick={handleAssignManager}
                  disabled={!selectedManagerId || isAssigning}
                >
                  {isAssigning ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-current" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      <UserPlus className="mr-2 h-4 w-4" />
                      Assign
                    </>
                  )}
                </Button>
              </div>
            </div>

            <Separator />

            {/* Current Assignments */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Current Assignments</h3>
              
              {assignedManagers.length === 0 ? (
                <div className="text-center py-6 border-2 border-dashed border-muted-foreground/25 rounded-lg">
                  <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground">No managers assigned to this store</p>
                  <p className="text-sm text-muted-foreground">
                    Assign a manager above to get started
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[200px]">
                  <div className="space-y-3">
                    {assignedManagers.map((manager) => (
                      <div key={manager.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{manager.name}</span>
                            <Badge variant="secondary" className="text-xs">
                              {manager._count.reports} reports
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {manager.email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Assigned {new Date(manager.assignedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleUnassignManager(manager.id, manager.name)}
                          className="text-destructive hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}