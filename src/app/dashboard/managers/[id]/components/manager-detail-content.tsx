"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { 
  Users, 
  Mail, 
  Store, 
  FileText, 
  Calendar,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle
} from "lucide-react"
import { toast } from "sonner"
import { assignManager, unassignManager } from "@/app/actions/manager-actions"
import { format } from "date-fns"

interface ManagerDetailProps {
  manager: any
  availableStores: any[]
}

export function ManagerDetailContent({ manager, availableStores }: ManagerDetailProps) {
  const [selectedStoreId, setSelectedStoreId] = useState<string>("")
  const [isAssigning, setIsAssigning] = useState(false)
  const [assignments, setAssignments] = useState(manager.managedStores)

  const handleAssignStore = async () => {
    if (!selectedStoreId) return

    setIsAssigning(true)
    try {
      const result = await assignManager(selectedStoreId, manager.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Manager assigned to store successfully!")
        // Refresh the page or update state
        window.location.reload()
      }
    } catch (error) {
      toast.error("Failed to assign manager to store")
    } finally {
      setIsAssigning(false)
      setSelectedStoreId("")
    }
  }

  const handleUnassignStore = async (storeId: string, storeName: string) => {
    if (!confirm(`Remove ${manager.name} from ${storeName}?`)) return

    try {
      const result = await unassignManager(storeId, manager.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Manager removed from store successfully!")
        // Update state
        setAssignments(prev => prev.filter(a => a.store.id !== storeId))
      }
    } catch (error) {
      toast.error("Failed to remove manager from store")
    }
  }

  const assignedStoreIds = assignments.map(a => a.store.id)
  const unassignedStores = availableStores.filter(store => 
    !assignedStoreIds.includes(store.id)
  )

  return (
    <div className="space-y-6">
      {/* Manager Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-2xl">{manager.name}</CardTitle>
                <CardDescription className="flex items-center gap-2 mt-1">
                  <Mail className="h-4 w-4" />
                  {manager.email}
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary">MANAGER</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Assigned Stores</p>
              <p className="text-2xl font-bold">{manager._count.managedStores}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Total Reports</p>
              <p className="text-2xl font-bold">{manager._count.reports}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Joined Date</p>
              <p className="text-lg">{format(new Date(manager.createdAt), "MMM dd, yyyy")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Store Assignments */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Store Assignments</CardTitle>
              <CardDescription>
                Manage which stores this manager can access and submit reports for
              </CardDescription>
            </div>
            {unassignedStores.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={selectedStoreId} onValueChange={setSelectedStoreId}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select a store" />
                  </SelectTrigger>
                  <SelectContent>
                    {unassignedStores.map(store => (
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
                <Button 
                  onClick={handleAssignStore}
                  disabled={!selectedStoreId || isAssigning}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Assign
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <div className="text-center py-8">
              <Store className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">No Store Assignments</p>
              <p className="text-muted-foreground">
                This manager is not assigned to any stores yet.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {assignments.map(assignment => (
                <div key={assignment.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                      <Store className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{assignment.store.name}</p>
                      {assignment.store.address && (
                        <p className="text-sm text-muted-foreground">{assignment.store.address}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      Since {format(new Date(assignment.createdAt), "MMM dd, yyyy")}
                    </Badge>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleUnassignStore(assignment.store.id, assignment.store.name)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Reports */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Reports</CardTitle>
          <CardDescription>
            Latest daily reports submitted by this manager
          </CardDescription>
        </CardHeader>
        <CardContent>
          {manager.reports.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">No Reports Yet</p>
              <p className="text-muted-foreground">
                This manager hasn't submitted any reports yet.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead>Prep Completion</TableHead>
                  <TableHead>Till Difference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {manager.reports.map((report: any) => {
                  const prepCompletion = report.shift === "MORNING" 
                    ? report.morningPrepCompleted 
                    : report.eveningPrepCompleted
                  const tillDiff = report.endingAmount - report.startingAmount

                  return (
                    <TableRow key={report.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {format(new Date(report.date), "MMM dd, yyyy")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Store className="h-4 w-4 text-muted-foreground" />
                          {report.store.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={report.shift === "MORNING" ? "default" : "secondary"}>
                          {report.shift}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {prepCompletion >= 80 ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-yellow-600" />
                          )}
                          {prepCompletion}%
                        </div>
                      </TableCell>
                      <TableCell className={tillDiff >= 0 ? "text-green-600" : "text-red-600"}>
                        ${tillDiff.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}