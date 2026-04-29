/** Plain-English verb phrases for each tool. Used by the thinking
 * indicator so the owner sees "Searching invoices…" instead of the raw
 * tool name. Keep these short, lowercase, ledger-voice.
 *
 * Three forms:
 * - `running`: shown live with an ellipsis ("Reading invoices…")
 * - `done`: shown when listing the single tool used ("Read invoices")
 * - `short`: noun-only fragment used when joining multiple tools into
 *   a "Read · invoices · sales" line — keeps the prefix from repeating. */
export const TOOL_LABELS: Record<
  string,
  { running: string; done: string; short: string }
> = {
  listStores: {
    running: "Reading store list",
    done: "Resolved stores",
    short: "stores",
  },
  getDailySales: {
    running: "Pulling sales totals",
    done: "Read sales totals",
    short: "sales",
  },
  getHourlyTrend: {
    running: "Reading the hourly trend",
    done: "Read hourly trend",
    short: "hourly trend",
  },
  getPlatformBreakdown: {
    running: "Splitting sales by platform",
    done: "Read platform breakdown",
    short: "platform split",
  },
  getCogsByItem: {
    running: "Reading item-level COGS",
    done: "Read item COGS",
    short: "item COGS",
  },
  getMenuPrices: {
    running: "Looking up menu prices",
    done: "Read menu prices",
    short: "menu prices",
  },
  searchMenuItems: {
    running: "Searching the menu",
    done: "Searched the menu",
    short: "menu",
  },
  getIngredientPrices: {
    running: "Looking up ingredient cost",
    done: "Read ingredient cost",
    short: "ingredient cost",
  },
  searchInvoices: {
    running: "Searching invoices",
    done: "Searched invoices",
    short: "invoices",
  },
  sumInvoiceLines: {
    running: "Totalling invoice lines",
    done: "Totalled invoice lines",
    short: "invoice lines",
  },
  getTopInvoices: {
    running: "Ranking invoices by amount",
    done: "Read top invoices",
    short: "top invoices",
  },
  getInvoiceSpend: {
    running: "Reading total invoice spend",
    done: "Read invoice spend",
    short: "invoice spend",
  },
  getInvoiceById: {
    running: "Pulling the invoice",
    done: "Read invoice",
    short: "invoice",
  },
  searchRecipes: {
    running: "Searching recipes",
    done: "Searched recipes",
    short: "recipes",
  },
  getRecipeByName: {
    running: "Pulling the recipe",
    done: "Read recipe",
    short: "recipe",
  },
  getRecipeById: {
    running: "Pulling the recipe",
    done: "Read recipe",
    short: "recipe",
  },
  getMenuItemDetails: {
    running: "Reading the menu item",
    done: "Read menu item",
    short: "menu item",
  },
  getTopMenuItems: {
    running: "Ranking menu items",
    done: "Read top menu items",
    short: "top menu items",
  },
  getStoreBreakdown: {
    running: "Splitting sales by store",
    done: "Read per-store summary",
    short: "per-store",
  },
  getOperationalCosts: {
    running: "Reading fixed costs",
    done: "Read fixed costs",
    short: "fixed costs",
  },
  getRefunds: {
    running: "Reading refunds",
    done: "Read refunds",
    short: "refunds",
  },
  compareSales: {
    running: "Comparing periods",
    done: "Compared periods",
    short: "period comparison",
  },
}

export function labelFor(
  toolName: string,
): { running: string; done: string; short: string } {
  return (
    TOOL_LABELS[toolName] ?? {
      running: `Running ${toolName}`,
      done: `Used ${toolName}`,
      short: toolName,
    }
  )
}
