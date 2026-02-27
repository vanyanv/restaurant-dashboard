"use client"

import { useEffect, useState, useTransition, useMemo } from "react"
import { motion } from "framer-motion"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatNumber, formatPct } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { IngredientUsageRow, RecipeWithIngredients } from "@/types/product-usage"

interface IngredientDrilldownSheetProps {
  ingredient: IngredientUsageRow | null
  recipes: RecipeWithIngredients[]
  onClose: () => void
}

const STATUS_CONFIG = {
  over_ordered: { label: "Over Ordered", color: "text-red-600 bg-red-50 dark:bg-red-950/30" },
  under_ordered: { label: "Under Ordered", color: "text-amber-600 bg-amber-50 dark:bg-amber-950/30" },
  balanced: { label: "Balanced", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30" },
  no_recipe: { label: "No Recipe", color: "text-muted-foreground bg-muted" },
} as const

export function IngredientDrilldownSheet({
  ingredient,
  recipes,
  onClose,
}: IngredientDrilldownSheetProps) {
  const isOpen = !!ingredient

  // Find recipes that use this ingredient
  const linkedRecipes = useMemo(() => {
    if (!ingredient) return []
    return recipes.filter((r) =>
      r.ingredients.some(
        (ing) => ing.ingredientName.toLowerCase() === ingredient.ingredientName.toLowerCase()
      )
    )
  }, [ingredient, recipes])

  // Usage breakdown by recipe
  const usageByRecipe = useMemo(() => {
    if (!ingredient) return []
    return linkedRecipes.map((recipe) => {
      const ing = recipe.ingredients.find(
        (i) => i.ingredientName.toLowerCase() === ingredient.ingredientName.toLowerCase()
      )
      return {
        recipeName: recipe.itemName,
        category: recipe.category,
        qtyPerServing: ing?.quantity ?? 0,
        unit: ing?.unit ?? ingredient.purchasedUnit,
      }
    })
  }, [ingredient, linkedRecipes])

  if (!ingredient) return null

  const statusConfig = STATUS_CONFIG[ingredient.status]

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-lg">{ingredient.ingredientName}</SheetTitle>
          <SheetDescription className="sr-only">
            Detailed metrics for {ingredient.ingredientName}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {/* Status + Category */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2 flex-wrap"
          >
            <Badge
              variant="outline"
              className={cn("text-xs", statusConfig.color)}
            >
              {statusConfig.label}
            </Badge>
            {ingredient.category && (
              <Badge variant="secondary" className="text-xs">
                {ingredient.category}
              </Badge>
            )}
          </motion.div>

          {/* Key Stats Grid */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.05 }}
            className="grid grid-cols-2 gap-3"
          >
            <StatCard
              label="Purchased"
              value={`${formatNumber(ingredient.purchasedQuantity)} ${ingredient.purchasedUnit}`}
            />
            <StatCard
              label="Theoretical"
              value={
                ingredient.theoreticalUsage > 0
                  ? `${formatNumber(ingredient.theoreticalUsage)} ${ingredient.purchasedUnit}`
                  : "N/A"
              }
            />
            <StatCard
              label="Purchased Cost"
              value={formatCurrency(ingredient.purchasedCost)}
            />
            <StatCard
              label="Avg Unit Cost"
              value={formatCurrency(ingredient.avgUnitCost)}
            />
            <StatCard
              label="Variance"
              value={
                ingredient.status !== "no_recipe"
                  ? `${ingredient.variancePct > 0 ? "+" : ""}${formatPct(ingredient.variancePct)}`
                  : "N/A"
              }
              highlight={
                ingredient.status === "over_ordered"
                  ? "red"
                  : ingredient.status === "under_ordered"
                    ? "amber"
                    : ingredient.status === "balanced"
                      ? "green"
                      : undefined
              }
            />
            <StatCard
              label="Est. Waste Cost"
              value={formatCurrency(ingredient.wasteEstimatedCost)}
              highlight={ingredient.wasteEstimatedCost > 0 ? "red" : undefined}
            />
          </motion.div>

          {/* Waste Detail */}
          {ingredient.status !== "no_recipe" && ingredient.varianceQuantity !== 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
              className="rounded-lg border bg-card p-3 space-y-2"
            >
              <p className="text-xs font-medium text-muted-foreground">Variance Breakdown</p>
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Purchased</span>
                  <span className="font-medium">
                    {formatNumber(ingredient.purchasedQuantity)} {ingredient.purchasedUnit}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Theoretical Usage</span>
                  <span className="font-medium">
                    {formatNumber(ingredient.theoreticalUsage)} {ingredient.purchasedUnit}
                  </span>
                </div>
                <div className="border-t pt-1 flex justify-between font-medium">
                  <span className="text-muted-foreground">
                    {ingredient.varianceQuantity > 0 ? "Excess" : "Shortfall"}
                  </span>
                  <span
                    className={cn(
                      ingredient.varianceQuantity > 0
                        ? "text-red-600"
                        : "text-amber-600"
                    )}
                  >
                    {ingredient.varianceQuantity > 0 ? "+" : ""}
                    {formatNumber(ingredient.varianceQuantity)} {ingredient.purchasedUnit}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Invoice Summary */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.15 }}
            className="rounded-lg border bg-card p-3"
          >
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Invoice Activity
            </p>
            <p className="text-sm">
              Appeared on <span className="font-semibold">{ingredient.invoiceCount}</span>{" "}
              invoice{ingredient.invoiceCount !== 1 ? "s" : ""} in this period
            </p>
          </motion.div>

          {/* Recipe Usage */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.2 }}
            className="rounded-lg border bg-card p-3 space-y-2"
          >
            <p className="text-xs font-medium text-muted-foreground">
              Used in Recipes ({linkedRecipes.length})
            </p>
            {usageByRecipe.length > 0 ? (
              <div className="space-y-1.5">
                {usageByRecipe.map((usage) => (
                  <div
                    key={`${usage.recipeName}:::${usage.category}`}
                    className="flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{usage.recipeName}</span>
                      <Badge variant="secondary" className="text-[10px] h-4">
                        {usage.category}
                      </Badge>
                    </div>
                    <span className="text-muted-foreground">
                      {usage.qtyPerServing} {usage.unit}/serving
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Not linked to any recipes. Configure a recipe to enable variance tracking.
              </p>
            )}
          </motion.div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: "red" | "amber" | "green"
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <span
        className={cn(
          "text-sm font-semibold",
          highlight === "red" && "text-red-600",
          highlight === "amber" && "text-amber-600",
          highlight === "green" && "text-emerald-600"
        )}
      >
        {value}
      </span>
    </div>
  )
}
