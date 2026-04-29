import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getMenuItemsForCatalog } from "@/app/actions/menu-item-actions"
import { PageHead } from "@/components/mobile/page-head"
import { Panel } from "@/components/mobile/panel"
import { MenuSearch } from "./menu-search"

export const dynamic = "force-dynamic"

export default async function MobileMenuPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const items = await getMenuItemsForCatalog({ sinceDays: 90 })

  const mapped = items.filter((i) => i.mappedRecipeId).length

  return (
    <>
      <PageHead
        dept="CATALOG"
        title="Menu"
        sub={`${items.length} items · ${mapped} mapped to recipes`}
      />

      <div className="dock-in dock-in-2" style={{ marginBottom: 14 }}>
        <div className="m-readonly-note">
          Read-only on mobile · map menu items to recipes on desktop
        </div>
      </div>

      <div className="dock-in dock-in-3">
        <Panel flush>
          <MenuSearch
            rows={items.map((i) => ({
              name: i.otterItemName,
              category: i.category,
              totalQty: i.totalQtySoldAllTime,
              mappedRecipeName: i.mappedRecipeName,
              storeCount: i.storeIds.length,
            }))}
          />
        </Panel>
      </div>
    </>
  )
}
