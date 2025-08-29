"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { MapPin, Phone, Store, Loader2, ToggleLeft, ToggleRight } from "lucide-react"
import { updateStore } from "@/app/actions/store-actions"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

const updateStoreSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100, "Store name too long"),
  address: z.string().max(200, "Address too long").optional(),
  phone: z.string().max(20, "Phone number too long").optional(),
  isActive: z.boolean(),
})

type UpdateStoreFormValues = z.infer<typeof updateStoreSchema>

interface StoreData {
  id: string
  name: string
  address: string | null
  phone: string | null
  isActive: boolean
}

interface EditStoreFormProps {
  store: StoreData
}

export function EditStoreForm({ store }: EditStoreFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const form = useForm<UpdateStoreFormValues>({
    resolver: zodResolver(updateStoreSchema),
    defaultValues: {
      name: store.name,
      address: store.address || "",
      phone: store.phone || "",
      isActive: store.isActive,
    },
  })

  const onSubmit = async (values: UpdateStoreFormValues) => {
    setIsLoading(true)
    
    try {
      const formData = new FormData()
      formData.append("name", values.name)
      if (values.address) formData.append("address", values.address)
      if (values.phone) formData.append("phone", values.phone)
      formData.append("isActive", values.isActive.toString())

      const result = await updateStore(store.id, formData)

      if (result.error) {
        throw new Error(result.error)
      }

      toast.success("Store updated successfully!", {
        description: `${result.store?.name} has been updated.`,
      })
      
      // Redirect to store detail page
      router.push(`/dashboard/stores/${store.id}`)
      router.refresh()
      
    } catch (error) {
      console.error("Error updating store:", error)
      toast.error("Failed to update store", {
        description: error instanceof Error ? error.message : "Please try again.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <Store className="h-4 w-4" />
                Store Name *
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="Downtown Location"
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormDescription>
                A unique name to identify this store location
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Address
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="123 Main Street, Downtown, CA 90210"
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormDescription>
                The physical address of this store location
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Phone Number
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="(555) 123-4567"
                  {...field}
                  disabled={isLoading}
                />
              </FormControl>
              <FormDescription>
                Contact phone number for this location
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="flex items-center gap-2">
                  {field.value ? (
                    <ToggleRight className="h-4 w-4 text-green-600" />
                  ) : (
                    <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                  )}
                  Store Status
                </FormLabel>
                <FormDescription>
                  {field.value 
                    ? "Store is active and accepting operations" 
                    : "Store is inactive and not accepting operations"
                  }
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={isLoading}
                />
              </FormControl>
            </FormItem>
          )}
        />
        
        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/dashboard/stores/${store.id}`)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              "Update Store"
            )}
          </Button>
        </div>
      </form>
    </Form>
  )
}