"use client"

import { useMemo } from "react"
import { motion } from "framer-motion"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { formatCurrency, formatNumber, formatPct } from "@/lib/format"
import { useIsPhone } from "@/hooks/use-is-phone"
import type { IngredientUsageRow, RecipeWithIngredients } from "@/types/product-usage"

interface IngredientDrilldownSheetProps {
  ingredient: IngredientUsageRow | null
  recipes: RecipeWithIngredients[]
  onClose: () => void
}

type StatusKey = "over_ordered" | "under_ordered" | "balanced" | "no_recipe"

const STATUS_CONFIG: Record<StatusKey, { label: string; tone: "alert" | "watch" | "ok" | "muted" }> = {
  over_ordered: { label: "Over ordered", tone: "alert" },
  under_ordered: { label: "Under ordered", tone: "watch" },
  balanced: { label: "Balanced", tone: "ok" },
  no_recipe: { label: "No recipe", tone: "muted" },
}

const NUM_CLASS =
  "[font-variant-numeric:tabular-nums_lining-nums] [font-feature-settings:'tnum','lnum']"

export function IngredientDrilldownSheet({
  ingredient,
  recipes,
  onClose,
}: IngredientDrilldownSheetProps) {
  const isOpen = !!ingredient
  const isPhone = useIsPhone()

  const linkedRecipes = useMemo(() => {
    if (!ingredient) return []
    return recipes.filter((r) =>
      r.ingredients.some(
        (ing) => (ing.ingredientName ?? "").toLowerCase() === ingredient.ingredientName.toLowerCase()
      )
    )
  }, [ingredient, recipes])

  const usageByRecipe = useMemo(() => {
    if (!ingredient) return []
    return linkedRecipes.map((recipe) => {
      const ing = recipe.ingredients.find(
        (i) => (i.ingredientName ?? "").toLowerCase() === ingredient.ingredientName.toLowerCase()
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
      <SheetContent
        side={isPhone ? "bottom" : "right"}
        data-mobile-bottom={isPhone ? "true" : undefined}
        className="overflow-y-auto"
        style={{ background: "var(--paper)", borderColor: "var(--hairline-bold)" }}
      >
        <SheetHeader>
          <SheetTitle
            className="font-display italic"
            style={{ fontSize: 22, color: "var(--ink)" }}
          >
            {ingredient.ingredientName}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Detailed metrics for {ingredient.ingredientName}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2 flex-wrap"
          >
            <span className="inv-stamp" data-tone={statusConfig.tone}>
              {statusConfig.label}
            </span>
            {ingredient.category && (
              <span
                className="text-[11px]"
                style={{
                  color: "var(--ink-muted)",
                  fontFamily: "var(--font-jetbrains-mono), monospace",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                {ingredient.category}
              </span>
            )}
          </motion.div>

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
                  : "·"
              }
              muted={ingredient.theoreticalUsage === 0}
            />
            <StatCard
              label="Purchased cost"
              value={formatCurrency(ingredient.purchasedCost)}
            />
            <StatCard
              label="Avg unit cost"
              value={formatCurrency(ingredient.avgUnitCost)}
            />
            <StatCard
              label="Variance"
              value={
                ingredient.status !== "no_recipe"
                  ? `${ingredient.variancePct > 0 ? "+" : ""}${formatPct(ingredient.variancePct)}`
                  : "·"
              }
              tone={
                ingredient.status === "over_ordered"
                  ? "alert"
                  : ingredient.status === "under_ordered"
                    ? "watch"
                    : undefined
              }
              muted={ingredient.status === "no_recipe"}
            />
            <StatCard
              label="Est. waste cost"
              value={formatCurrency(ingredient.wasteEstimatedCost)}
              tone={ingredient.wasteEstimatedCost > 0 ? "alert" : undefined}
            />
          </motion.div>

          {ingredient.status !== "no_recipe" && ingredient.varianceQuantity !== 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.1 }}
              className="editorial-subpanel space-y-2"
            >
              <span
                className="text-[10px] uppercase tracking-[0.2em]"
                style={{
                  color: "var(--ink-faint)",
                  fontFamily: "var(--font-jetbrains-mono), monospace",
                }}
              >
                Variance breakdown
              </span>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[12px]">
                  <span style={{ color: "var(--ink-muted)" }}>Purchased</span>
                  <span className={`font-medium ${NUM_CLASS}`} style={{ color: "var(--ink)" }}>
                    {formatNumber(ingredient.purchasedQuantity)} {ingredient.purchasedUnit}
                  </span>
                </div>
                <div className="flex justify-between text-[12px]">
                  <span style={{ color: "var(--ink-muted)" }}>Theoretical usage</span>
                  <span className={`font-medium ${NUM_CLASS}`} style={{ color: "var(--ink)" }}>
                    {formatNumber(ingredient.theoreticalUsage)} {ingredient.purchasedUnit}
                  </span>
                </div>
                <div
                  className="flex justify-between text-[12px] pt-1.5 font-medium"
                  style={{ borderTop: "1px solid var(--hairline)" }}
                >
                  <span style={{ color: "var(--ink-muted)" }}>
                    {ingredient.varianceQuantity > 0 ? "Excess" : "Shortfall"}
                  </span>
                  <span
                    className={NUM_CLASS}
                    style={{
                      color:
                        ingredient.varianceQuantity > 0
                          ? "var(--accent)"
                          : "var(--subtract)",
                    }}
                  >
                    {ingredient.varianceQuantity > 0 ? "+" : ""}
                    {formatNumber(ingredient.varianceQuantity)} {ingredient.purchasedUnit}
                  </span>
                </div>
              </div>
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.15 }}
            className="editorial-subpanel"
          >
            <span
              className="text-[10px] uppercase tracking-[0.2em] block mb-2"
              style={{
                color: "var(--ink-faint)",
                fontFamily: "var(--font-jetbrains-mono), monospace",
              }}
            >
              Invoice activity
            </span>
            <p className="text-[13px]" style={{ color: "var(--ink)" }}>
              Appeared on{" "}
              <span className={`font-semibold ${NUM_CLASS}`}>
                {ingredient.invoiceCount}
              </span>{" "}
              invoice{ingredient.invoiceCount !== 1 ? "s" : ""} in this period.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: 0.2 }}
            className="editorial-subpanel space-y-2"
          >
            <span
              className="text-[10px] uppercase tracking-[0.2em]"
              style={{
                color: "var(--ink-faint)",
                fontFamily: "var(--font-jetbrains-mono), monospace",
              }}
            >
              Used in recipes ({linkedRecipes.length})
            </span>
            {usageByRecipe.length > 0 ? (
              <div className="space-y-1.5">
                {usageByRecipe.map((usage) => (
                  <div
                    key={`${usage.recipeName}:::${usage.category}`}
                    className="flex items-center justify-between text-[12px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: "var(--ink)" }}>
                        {usage.recipeName}
                      </span>
                      <span
                        className="text-[10px]"
                        style={{
                          color: "var(--ink-faint)",
                          fontFamily: "var(--font-jetbrains-mono), monospace",
                          letterSpacing: "0.16em",
                          textTransform: "uppercase",
                        }}
                      >
                        {usage.category}
                      </span>
                    </div>
                    <span
                      className={NUM_CLASS}
                      style={{ color: "var(--ink-muted)" }}
                    >
                      {usage.qtyPerServing} {usage.unit}/serving
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
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
  tone,
  muted,
}: {
  label: string
  value: string
  tone?: "alert" | "watch"
  muted?: boolean
}) {
  const color =
    tone === "alert"
      ? "var(--accent)"
      : tone === "watch"
        ? "var(--subtract)"
        : muted
          ? "var(--ink-faint)"
          : "var(--ink)"
  return (
    <div className="editorial-subpanel">
      <span
        className="text-[10px] uppercase tracking-[0.2em] block"
        style={{
          color: "var(--ink-faint)",
          fontFamily: "var(--font-jetbrains-mono), monospace",
        }}
      >
        {label}
      </span>
      <span
        className={`text-[14px] font-semibold mt-1 block ${NUM_CLASS}`}
        style={{ color }}
      >
        {value}
      </span>
    </div>
  )
}
