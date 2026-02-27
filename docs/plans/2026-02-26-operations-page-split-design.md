# Operations Page Split — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the 4-tab Product Usage page into 4 separate pages under the Operations sidebar section.

**Architecture:** Each tab (Overview/Costs/Vendors/Recipes) becomes its own route under `/dashboard/operations/`. Each page has a server component (`page.tsx`) for auth+data fetching and a client content component. Components are moved from `product-usage/components/` to their respective page directories.

**Tech Stack:** Next.js 15 App Router, React 19, shadcn/ui, TanStack Table, Recharts, server actions

---

### Task 1: Update Sidebar Navigation

**Files:**
- Modify: `src/components/app-sidebar.tsx:86-99`

**Step 1: Add new nav items to the Operations section**

Replace the Operations items array (lines 89-98) with:

```tsx
items: [
  {
    title: "Overview",
    url: "/dashboard/operations",
  },
  {
    title: "Product Usage",
    url: "/dashboard/operations/product-usage",
  },
  {
    title: "Costs",
    url: "/dashboard/operations/costs",
  },
  {
    title: "Vendors",
    url: "/dashboard/operations/vendors",
  },
  {
    title: "Recipes",
    url: "/dashboard/operations/recipes",
  },
],
```

**Step 2: Verify dev server loads without errors**

Run: `npm run dev` and navigate to any page — sidebar should show all 5 items under Operations.

**Step 3: Commit**

```bash
git add src/components/app-sidebar.tsx
git commit -m "feat: add costs, vendors, recipes nav items to operations sidebar"
```

---

### Task 2: Create Costs Page

**Files:**
- Move: `src/app/dashboard/operations/product-usage/components/menu-item-cost-table.tsx` → `src/app/dashboard/operations/costs/components/menu-item-cost-table.tsx`
- Create: `src/app/dashboard/operations/costs/page.tsx`
- Create: `src/app/dashboard/operations/costs/components/costs-content.tsx`

**Step 1: Move the component**

```bash
mkdir -p src/app/dashboard/operations/costs/components
mv src/app/dashboard/operations/product-usage/components/menu-item-cost-table.tsx src/app/dashboard/operations/costs/components/
```

**Step 2: Create `src/app/dashboard/operations/costs/page.tsx`**

Follow the same pattern as `operations/page.tsx` — authenticate, fetch stores, call `getProductUsageData`, pass to client component. Only need `menuItemCosts` from the data.

```tsx
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getProductUsageData } from "@/app/actions/product-usage-actions"
import { getStores } from "@/app/actions/store-actions"
import { CostsContent } from "./components/costs-content"

export default async function CostsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const [data, stores] = await Promise.all([
    getProductUsageData({ days: 30 }),
    getStores(),
  ])

  return (
    <CostsContent
      initialData={data}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
    />
  )
}
```

**Step 3: Create `src/app/dashboard/operations/costs/components/costs-content.tsx`**

Client component with sticky header (title "Menu Item Costs", date picker, store selector), renders `MenuItemCostTable`. Follow the same header pattern as `product-usage-content.tsx` but without tabs — just the table content directly.

Use the same state management pattern: `useState` for days/customRange/selectedStore, `useTransition` for fetching, `useCallback` for handlers. Copy the date range handling logic from `product-usage-content.tsx`.

The content area should render:
```tsx
<DashboardSection title="Menu Item Costs">
  {hasData ? (
    <MenuItemCostTable data={data.menuItemCosts} />
  ) : (
    <DataTableSkeleton columns={8} rows={10} />
  )}
</DashboardSection>
```

Use icon `DollarSign` from lucide-react for the header.

**Step 4: Verify**

Navigate to `/dashboard/operations/costs` — should show the menu item costs table with date picker and store selector.

**Step 5: Commit**

```bash
git add src/app/dashboard/operations/costs/
git commit -m "feat: create standalone costs page under operations"
```

---

### Task 3: Create Vendors Page

**Files:**
- Move: `src/app/dashboard/operations/product-usage/components/price-changes-table.tsx` → `src/app/dashboard/operations/vendors/components/`
- Move: `src/app/dashboard/operations/product-usage/components/vendor-price-chart.tsx` → `src/app/dashboard/operations/vendors/components/`
- Create: `src/app/dashboard/operations/vendors/page.tsx`
- Create: `src/app/dashboard/operations/vendors/components/vendors-content.tsx`

**Step 1: Move components**

```bash
mkdir -p src/app/dashboard/operations/vendors/components
mv src/app/dashboard/operations/product-usage/components/price-changes-table.tsx src/app/dashboard/operations/vendors/components/
mv src/app/dashboard/operations/product-usage/components/vendor-price-chart.tsx src/app/dashboard/operations/vendors/components/
```

**Step 2: Create `src/app/dashboard/operations/vendors/page.tsx`**

Same auth pattern. Fetch `getProductUsageData({ days: 30 })` and stores. Pass to `VendorsContent`.

```tsx
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getProductUsageData } from "@/app/actions/product-usage-actions"
import { getStores } from "@/app/actions/store-actions"
import { VendorsContent } from "./components/vendors-content"

export default async function VendorsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const [data, stores] = await Promise.all([
    getProductUsageData({ days: 30 }),
    getStores(),
  ])

  return (
    <VendorsContent
      initialData={data}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
    />
  )
}
```

**Step 3: Create `src/app/dashboard/operations/vendors/components/vendors-content.tsx`**

Client component with sticky header (title "Vendors", icon `Truck`, date picker, store selector). Content renders two `CollapsibleSection`s:

```tsx
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
```

Dynamic-import `VendorPriceChart` with `{ ssr: false }` and `ChartSkeleton` loading fallback (same pattern as product-usage-content.tsx).

**Step 4: Verify**

Navigate to `/dashboard/operations/vendors` — should show price changes table and vendor price trends chart.

**Step 5: Commit**

```bash
git add src/app/dashboard/operations/vendors/
git commit -m "feat: create standalone vendors page under operations"
```

---

### Task 4: Create Recipes Page

**Files:**
- Move: `src/app/dashboard/operations/product-usage/components/recipe-manager-sheet.tsx` → `src/app/dashboard/operations/recipes/components/`
- Create: `src/app/dashboard/operations/recipes/page.tsx`
- Create: `src/app/dashboard/operations/recipes/components/recipes-content.tsx`

**Step 1: Move component**

```bash
mkdir -p src/app/dashboard/operations/recipes/components
mv src/app/dashboard/operations/product-usage/components/recipe-manager-sheet.tsx src/app/dashboard/operations/recipes/components/
```

**Step 2: Create `src/app/dashboard/operations/recipes/page.tsx`**

Fetch recipes and stores only (no `getProductUsageData` needed).

```tsx
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getRecipes } from "@/app/actions/product-usage-actions"
import { getStores } from "@/app/actions/store-actions"
import { RecipesContent } from "./components/recipes-content"

export default async function RecipesPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const [recipes, stores] = await Promise.all([
    getRecipes(),
    getStores(),
  ])

  return (
    <RecipesContent
      initialRecipes={recipes}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
    />
  )
}
```

**Step 3: Create `src/app/dashboard/operations/recipes/components/recipes-content.tsx`**

Client component with sticky header (title "Recipes", icon `ChefHat`, store selector only — NO date picker). Content renders the recipe list and "Manage Recipes" button that opens `RecipeManagerSheet`.

Copy the recipes tab content from `product-usage-content.tsx` lines 322-368 directly. Include the `RecipeManagerSheet` at the bottom.

State: `selectedStore`, `recipeSheetOpen`, `recipes` (with a refetch callback).

The refetch on recipe change should call `getRecipes(storeId)` and update local state.

**Step 4: Verify**

Navigate to `/dashboard/operations/recipes` — should show recipe list with "Manage Recipes" button.

**Step 5: Commit**

```bash
git add src/app/dashboard/operations/recipes/
git commit -m "feat: create standalone recipes page under operations"
```

---

### Task 5: Simplify Product Usage Page (remove tabs)

**Files:**
- Modify: `src/app/dashboard/operations/product-usage/components/product-usage-content.tsx`
- Modify: `src/app/dashboard/operations/product-usage/page.tsx`

**Step 1: Update `page.tsx` — remove `getRecipes` call**

The page no longer needs recipes. Simplify to:

```tsx
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getProductUsageData } from "@/app/actions/product-usage-actions"
import { getStores } from "@/app/actions/store-actions"
import { ProductUsageContent } from "./components/product-usage-content"

export default async function ProductUsagePage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/dashboard")

  const [data, stores] = await Promise.all([
    getProductUsageData({ days: 30 }),
    getStores(),
  ])

  return (
    <ProductUsageContent
      initialData={data}
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      userRole={session.user.role}
    />
  )
}
```

**Step 2: Update `product-usage-content.tsx` — remove tabs, keep only overview content**

Remove:
- `Tabs`, `TabsContent`, `TabsList`, `TabsTrigger` imports
- `RecipeManagerSheet`, `MenuItemCostTable`, `PriceChangesTable`, `IngredientDrilldownSheet` imports (keep drilldown — it's used in overview)
- `VendorPriceChart` dynamic import
- `recipeSheetOpen` state, `recipes` state/prop
- All tab markup — replace with just the overview content directly

Keep:
- The sticky header with date picker, store selector, OtterSyncButton
- The overview content: AlertsBanner, ProductUsageKpiCards, IngredientEfficiencyChart, CategorySpendChart, IngredientVarianceTable, IngredientDrilldownSheet

Remove `initialRecipes` from props interface. The component no longer needs `recipes` at all. Remove `RecipeManagerSheet` and its state.

**Step 3: Verify**

Navigate to `/dashboard/operations/product-usage` — should show overview content without tabs.

**Step 4: Commit**

```bash
git add src/app/dashboard/operations/product-usage/
git commit -m "refactor: simplify product-usage page to overview-only (no tabs)"
```

---

### Task 6: Final Verification

**Step 1: Test all 5 pages load correctly**

- `/dashboard/operations` — Operations Overview with KPI cards and charts
- `/dashboard/operations/product-usage` — Product Usage overview (no tabs)
- `/dashboard/operations/costs` — Menu item costs table
- `/dashboard/operations/vendors` — Price changes + vendor price trends
- `/dashboard/operations/recipes` — Recipe list + manage recipes sheet

**Step 2: Test sidebar navigation**

All 5 items should appear under Operations. Clicking each should navigate correctly.

**Step 3: Test date picker and store selector**

On costs and vendors pages, changing date range or store should refetch data.

**Step 4: Clean up any deleted component imports**

Check that no file still imports from the old locations of moved components.

**Step 5: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: clean up imports after operations page split"
```
