"use client"

import { useTransition, useState, useCallback, useEffect, useMemo } from "react"
import dynamic from "next/dynamic"
import { PackageSearch, ChefHat } from "lucide-react"
import { getProductUsageData, getRecipes } from "@/app/actions/product-usage-actions"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { OtterSyncButton } from "@/components/otter-sync-button"
import { DashboardSection } from "@/components/analytics/dashboard-section"
import { CollapsibleSection } from "@/components/analytics/collapsible-section"
import {
  KpiCardsSkeleton,
  ChartSkeleton,
  DataTableSkeleton,
} from "@/components/skeletons"
import { formatDateRange, localDateStr } from "@/lib/dashboard-utils"
import { ProductUsageKpiCards } from "./product-usage-kpi-cards"
import { AlertsBanner } from "./alerts-banner"
import { IngredientVarianceTable } from "./ingredient-variance-table"
import { RecipeManagerSheet } from "./recipe-manager-sheet"
import { MenuItemCostTable } from "./menu-item-cost-table"
import { PriceChangesTable } from "./price-changes-table"
import { AiInsightsPanel } from "./ai-insights-panel"
import { DemandForecastPanel } from "./demand-forecast-panel"
import type { ProductUsageData, RecipeWithIngredients } from "@/types/product-usage"

const IngredientEfficiencyChart = dynamic(
  () => import("./ingredient-efficiency-chart").then(m => ({ default: m.IngredientEfficiencyChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const CategorySpendChart = dynamic(
  () => import("./category-spend-chart").then(m => ({ default: m.CategorySpendChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
const VendorPriceChart = dynamic(
  () => import("./vendor-price-chart").then(m => ({ default: m.VendorPriceChart })),
  { loading: () => <ChartSkeleton />, ssr: false }
)

interface ProductUsageContentProps {
  initialData: ProductUsageData | null
  initialRecipes: RecipeWithIngredients[]
  stores: { id: string; name: string }[]
  userRole: string
}

export function ProductUsageContent({
  initialData,
  initialRecipes,
  stores,
  userRole,
}: ProductUsageContentProps) {
  const [data, setData] = useState(initialData)
  const [recipes, setRecipes] = useState(initialRecipes)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setData(initialData)
  }, [initialData])

  useEffect(() => {
    setRecipes(initialRecipes)
  }, [initialRecipes])

  const [days, setDays] = useState(30)
  const [customRange, setCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)
  const [selectedStore, setSelectedStore] = useState("all")
  const [recipeSheetOpen, setRecipeSheetOpen] = useState(false)

  const fetchData = useCallback(
    (storeId: string, options: { startDate: string; endDate: string } | { days: number }) => {
      startTransition(async () => {
        const sid = storeId === "all" ? undefined : storeId
        const opts: Record<string, unknown> = { ...options }
        if (sid) opts.storeId = sid
        const [fresh, freshRecipes] = await Promise.all([
          getProductUsageData(opts as any),
          getRecipes(sid),
        ])
        setData(fresh)
        setRecipes(freshRecipes)
      })
    },
    []
  )

  const getDateOptions = useCallback((): { startDate: string; endDate: string } | { days: number } => {
    if (customRange) return customRange
    return { days }
  }, [customRange, days])

  const handleRangeChange = useCallback(
    (startDate: string, endDate: string) => {
      const diffDays = Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      let presetDays: number
      if (diffDays === 0) {
        const today = localDateStr(new Date())
        if (startDate === today) {
          presetDays = 1
        } else {
          const yday = new Date()
          yday.setDate(yday.getDate() - 1)
          presetDays = startDate === localDateStr(yday) ? -1 : diffDays
        }
      } else {
        presetDays = diffDays
      }

      const presets = [1, -1, 3, 7, 14, 30, 90]
      const matchedPreset = presets.find((p) => p === presetDays)

      if (matchedPreset) {
        setDays(matchedPreset)
        setCustomRange(null)
      } else {
        setCustomRange({ startDate, endDate })
      }

      fetchData(selectedStore, { startDate, endDate })
    },
    [selectedStore, fetchData]
  )

  const handleStoreChange = useCallback(
    (storeId: string) => {
      setSelectedStore(storeId)
      fetchData(storeId, getDateOptions())
    },
    [fetchData, getDateOptions]
  )

  const hasData = !isPending && data

  return (
    <div className="flex flex-col h-full">
      {/* Navigation Header */}
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Product Usage</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <PackageSearch className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">
                Product Usage
              </h1>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block w-1 h-1 rounded-full bg-muted-foreground/50" />
              {data?.dateRange && (
                <span>
                  {formatDateRange(
                    data.dateRange.startDate,
                    data.dateRange.endDate
                  )}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DateRangePicker
              days={days}
              customRange={customRange}
              onRangeChange={handleRangeChange}
              isPending={isPending}
            />
            {stores.length > 1 && (
              <Select value={selectedStore} onValueChange={handleStoreChange}>
                <SelectTrigger className="h-8 w-[140px] text-sm">
                  <SelectValue placeholder="All Stores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stores</SelectItem>
                  {stores.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {userRole === "OWNER" && (
              <OtterSyncButton
                lastSyncAt={null}
                variant="outline"
                size="sm"
              />
            )}
          </div>
        </div>

        {/* Mobile date info */}
        <div className="sm:hidden px-4 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
          {data?.dateRange && (
            <span>
              {formatDateRange(
                data.dateRange.startDate,
                data.dateRange.endDate
              )}
            </span>
          )}
        </div>
      </div>

      {/* Content with Tabs */}
      <div className="flex-1 p-4 sm:p-6">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="costs">Costs</TabsTrigger>
            <TabsTrigger value="vendors">Vendors</TabsTrigger>
            <TabsTrigger value="recipes">Recipes</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-8">
            {hasData && (data.priceAlerts.length > 0 || data.orderAnomalies.length > 0) && (
              <AlertsBanner priceAlerts={data.priceAlerts} orderAnomalies={data.orderAnomalies} />
            )}

            <DashboardSection title="Key Metrics">
              {hasData ? <ProductUsageKpiCards kpis={data.kpis} /> : <KpiCardsSkeleton />}
            </DashboardSection>

            <CollapsibleSection title="Ingredient Efficiency" defaultOpen>
              {hasData ? <IngredientEfficiencyChart data={data.ingredientUsage} /> : <ChartSkeleton />}
            </CollapsibleSection>

            <CollapsibleSection title="Category Breakdown" defaultOpen>
              <div className="grid gap-4 md:gap-6 lg:grid-cols-5">
                <div className="lg:col-span-3">
                  {hasData ? <CategorySpendChart data={data.categoryBreakdown} /> : <ChartSkeleton />}
                </div>
                <div className="lg:col-span-2">
                  {hasData ? (
                    <div className="rounded-lg border bg-card p-4 h-full">
                      <AiInsightsPanel data={data} />
                    </div>
                  ) : (
                    <ChartSkeleton />
                  )}
                </div>
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Demand Forecast" defaultOpen={false}>
              <DemandForecastPanel storeId={selectedStore !== "all" ? selectedStore : undefined} />
            </CollapsibleSection>

            <CollapsibleSection title="Ingredient Variance" defaultOpen>
              {hasData ? <IngredientVarianceTable data={data.ingredientUsage} /> : <DataTableSkeleton columns={7} rows={8} />}
            </CollapsibleSection>
          </TabsContent>

          {/* Costs Tab */}
          <TabsContent value="costs" className="space-y-8">
            <DashboardSection title="Menu Item Costs">
              {hasData ? (
                <MenuItemCostTable data={data.menuItemCosts} />
              ) : (
                <DataTableSkeleton columns={8} rows={10} />
              )}
            </DashboardSection>
          </TabsContent>

          {/* Vendors Tab */}
          <TabsContent value="vendors" className="space-y-8">
            <CollapsibleSection title="Price Changes" defaultOpen>
              {hasData ? (
                <PriceChangesTable data={data.priceAlerts} />
              ) : (
                <DataTableSkeleton columns={6} rows={8} />
              )}
            </CollapsibleSection>

            <CollapsibleSection title="Vendor Price Trends" defaultOpen>
              {hasData ? (
                <VendorPriceChart data={data.vendorPriceTrends} />
              ) : (
                <ChartSkeleton />
              )}
            </CollapsibleSection>
          </TabsContent>

          {/* Recipes Tab */}
          <TabsContent value="recipes" className="space-y-8">
            <DashboardSection title="Recipe Coverage">
              <div className="space-y-4">
                {/* Coverage stats */}
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {recipes.length} recipes configured
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Configure recipes to track ingredient usage vs purchases
                    </p>
                  </div>
                  <Button onClick={() => setRecipeSheetOpen(true)} size="sm">
                    <ChefHat className="h-4 w-4 mr-2" />
                    Manage Recipes
                  </Button>
                </div>

                {/* Recipe list */}
                {recipes.length > 0 ? (
                  <div className="space-y-2">
                    {recipes.map((recipe) => (
                      <div key={recipe.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                          <div>
                            <p className="text-sm font-medium">{recipe.itemName}</p>
                            <p className="text-xs text-muted-foreground">
                              {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{recipe.category}</Badge>
                          {recipe.isConfirmed && <Badge variant="outline" className="text-emerald-600">Confirmed</Badge>}
                          {recipe.isAiGenerated && !recipe.isConfirmed && <Badge variant="outline" className="text-amber-600">AI Generated</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No recipes configured yet. Click &quot;Manage Recipes&quot; to get started.
                  </div>
                )}
              </div>
            </DashboardSection>
          </TabsContent>
        </Tabs>
      </div>

      <RecipeManagerSheet
        open={recipeSheetOpen}
        onOpenChange={setRecipeSheetOpen}
        recipes={recipes}
        storeId={selectedStore !== "all" ? selectedStore : undefined}
        onRecipeChange={() => {
          fetchData(selectedStore, getDateOptions())
        }}
      />
    </div>
  )
}
