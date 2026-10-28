import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { getShopSettingsSectionPromises } from "@/lib/counter/adapters/shop"
import { ShopSettingsClient } from "@/app/dashboard/(counter)/shop/settings/shop-settings-client"

export const dynamic = "force-dynamic"

/** Shop — Settings, on a phone (the desk client in the phone shell): pause the shop, pickup, shipping. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/m/forbidden")

  const sections = getShopSettingsSectionPromises({ accountId: session.user.accountId })

  return (
    <>
      <ShopSettingsClient sections={sections} />
      <span hidden data-perf-ready="/m/shop/settings" />
    </>
  )
}
