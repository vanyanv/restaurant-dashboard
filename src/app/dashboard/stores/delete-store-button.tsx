"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Trash2, AlertTriangle, Loader2 } from "lucide-react"
import { deleteStore } from "@/app/actions/store-actions"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

interface DeleteStoreButtonProps {
  storeId: string
  storeName: string
  hasReports: boolean
  hasManagers: boolean
}

export function DeleteStoreButton({
  storeId,
  storeName,
  hasReports,
  hasManagers
}: DeleteStoreButtonProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()

  const handleDelete = async () => {
    setIsDeleting(true)
    
    try {
      const result = await deleteStore(storeId)

      if (result.error) {
        throw new Error(result.error)
      }

      toast.success("Store deactivated successfully", {
        description: `${storeName} has been deactivated and can be reactivated later.`,
      })
      
      router.refresh()
      
    } catch (error) {
      console.error("Error deleting store:", error)
      toast.error("Failed to delete store", {
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const getWarningMessage = () => {
    const warnings = []
    if (hasReports) warnings.push(`${hasReports ? 'existing' : 'no'} reports`)
    if (hasManagers) warnings.push(`${hasManagers ? 'assigned' : 'no'} managers`)
    
    return warnings.length > 0 
      ? `This store has ${warnings.join(' and ')}. `
      : ''
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="mr-1 h-3 w-3" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete Store: {storeName}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              Are you sure you want to delete this store? This action will deactivate the store
              and remove all manager assignments.
            </p>
            {(hasReports || hasManagers) && (
              <div className="rounded-md bg-orange-50 p-3 border border-orange-200">
                <p className="text-sm text-orange-800">
                  <strong>Warning:</strong> {getWarningMessage()}
                  The store will be deactivated (not permanently deleted) so data is preserved.
                </p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              You can reactivate this store later if needed.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete Store"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}