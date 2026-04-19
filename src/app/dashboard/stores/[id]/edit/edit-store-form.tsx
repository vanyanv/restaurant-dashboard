"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import {
  MapPin,
  Phone,
  Store as StoreIcon,
  Loader2,
  ToggleLeft,
  ToggleRight,
  DollarSign,
  Home,
  Shirt,
  Sparkles,
} from "lucide-react"
import { updateStore } from "@/app/actions/store-actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { monthlyFromWeekly, weeklyFromMonthly } from "@/lib/pnl"

const updateStoreSchema = z.object({
  name: z.string().min(1, "Store name is required").max(100, "Store name too long"),
  address: z.string().max(200, "Address too long").optional(),
  phone: z.string().max(20, "Phone number too long").optional(),
  isActive: z.boolean(),
  fixedMonthlyLabor: z.string().optional(),
  fixedMonthlyRent: z.string().optional(),
  weeklyTowels: z.string().optional(),
  fixedMonthlyCleaning: z.string().optional(),
  uberCommissionPct: z.string().optional(),
  doordashCommissionPct: z.string().optional(),
})

type UpdateStoreFormValues = z.infer<typeof updateStoreSchema>

interface StoreData {
  id: string
  name: string
  address: string | null
  phone: string | null
  isActive: boolean
  fixedMonthlyLabor: number | null
  fixedMonthlyRent: number | null
  fixedMonthlyTowels: number | null
  fixedMonthlyCleaning: number | null
  uberCommissionRate: number
  doordashCommissionRate: number
}

interface EditStoreFormProps {
  store: StoreData
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function EditStoreForm({ store }: EditStoreFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const initialWeeklyTowels =
    store.fixedMonthlyTowels != null
      ? String(Math.round(weeklyFromMonthly(store.fixedMonthlyTowels) * 100) / 100)
      : ""

  const form = useForm<UpdateStoreFormValues>({
    resolver: zodResolver(updateStoreSchema),
    defaultValues: {
      name: store.name,
      address: store.address || "",
      phone: store.phone || "",
      isActive: store.isActive,
      fixedMonthlyLabor: store.fixedMonthlyLabor != null ? String(store.fixedMonthlyLabor) : "",
      fixedMonthlyRent: store.fixedMonthlyRent != null ? String(store.fixedMonthlyRent) : "",
      weeklyTowels: initialWeeklyTowels,
      fixedMonthlyCleaning:
        store.fixedMonthlyCleaning != null ? String(store.fixedMonthlyCleaning) : "",
      uberCommissionPct: String(Math.round(store.uberCommissionRate * 1000) / 10),
      doordashCommissionPct: String(Math.round(store.doordashCommissionRate * 1000) / 10),
    },
  })

  const weeklyTowelsRaw = form.watch("weeklyTowels") ?? ""
  const weeklyTowelsNum = Number(weeklyTowelsRaw)
  const towelsMonthlyHint =
    weeklyTowelsRaw.trim() !== "" && Number.isFinite(weeklyTowelsNum) && weeklyTowelsNum >= 0
      ? `≈ $${formatMoney(monthlyFromWeekly(weeklyTowelsNum))}/month`
      : null

  const onSubmit = async (values: UpdateStoreFormValues) => {
    setIsLoading(true)

    try {
      const formData = new FormData()
      formData.append("name", values.name)
      if (values.address) formData.append("address", values.address)
      if (values.phone) formData.append("phone", values.phone)
      formData.append("isActive", values.isActive.toString())
      formData.append("fixedMonthlyLabor", values.fixedMonthlyLabor ?? "")
      formData.append("fixedMonthlyRent", values.fixedMonthlyRent ?? "")

      // Convert weekly towels → monthly before sending.
      const weeklyStr = (values.weeklyTowels ?? "").trim()
      if (weeklyStr === "") {
        formData.append("fixedMonthlyTowels", "")
      } else {
        const weekly = Number(weeklyStr)
        if (!Number.isFinite(weekly) || weekly < 0) {
          formData.append("fixedMonthlyTowels", "")
        } else {
          formData.append("fixedMonthlyTowels", String(monthlyFromWeekly(weekly)))
        }
      }

      formData.append("fixedMonthlyCleaning", values.fixedMonthlyCleaning ?? "")
      formData.append("uberCommissionRate", values.uberCommissionPct ?? "")
      formData.append("doordashCommissionRate", values.doordashCommissionPct ?? "")

      const result = await updateStore(store.id, formData)

      if (result.error) {
        throw new Error(result.error)
      }

      toast.success("Store updated successfully!", {
        description: `${result.store?.name} has been updated.`,
      })

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
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {/* Store Info */}
          <Card>
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <StoreIcon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Store Info</CardTitle>
                <CardDescription className="text-xs">Basic details</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <StoreIcon className="h-4 w-4" />
                      Store Name *
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Downtown Location"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
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
                      Phone
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="(555) 123-4567"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="flex items-center gap-2 text-sm">
                        {field.value ? (
                          <ToggleRight className="h-4 w-4 text-green-600" />
                        ) : (
                          <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                        )}
                        Store Status
                      </FormLabel>
                      <FormDescription className="text-xs">
                        {field.value ? "Active & accepting operations" : "Inactive"}
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
            </CardContent>
          </Card>

          {/* Fixed Monthly Costs */}
          <Card>
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Fixed Costs</CardTitle>
                <CardDescription className="text-xs">
                  Converted per-period on P&amp;L. Blank shows &ldquo;—&rdquo;.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="fixedMonthlyLabor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4" />
                      Labor — monthly
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="29600"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fixedMonthlyRent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Home className="h-4 w-4" />
                      Rent — monthly
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="8500"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="weeklyTowels"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Shirt className="h-4 w-4" />
                      Towels (cleaning) — weekly
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="48"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    {towelsMonthlyHint && (
                      <FormDescription className="text-xs">
                        {towelsMonthlyHint}
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fixedMonthlyCleaning"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      Store cleaning — monthly
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="3400"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Platform Commissions */}
          <Card>
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Commissions</CardTitle>
                <CardDescription className="text-xs">
                  % of platform gross sales deducted on P&amp;L
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="uberCommissionPct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Uber %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        max="100"
                        placeholder="21"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="doordashCommissionPct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>DoorDash %</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        max="100"
                        placeholder="25"
                        {...field}
                        disabled={isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-3 pt-2">
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
