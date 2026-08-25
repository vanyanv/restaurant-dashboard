import { cookies } from "next/headers"
import { getServerSession } from "next-auth"
import { Fraunces } from "next/font/google"
import { AppSidebarClient } from "@/components/app-sidebar-client"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { ChatDrawerProvider } from "@/components/chat/chat-drawer-context"
import { ChatDrawerClient } from "@/components/chat/chat-drawer-client"
import { listOwnerStores } from "@/lib/chat/owner-scope"
import { WelcomeMarquee } from "@/components/dashboard/welcome-marquee"
import { authOptions } from "@/lib/auth"
import { consumePendingWelcome } from "@/lib/welcome"
import "@/styles/editorial-tokens.css"
import "@/styles/editorial-dashboard.css"
// Despite the name, editorial-auth.css also carries the whole Settings
// ("The Masthead") block, the shared .editorial-field / .editorial-submit form
// primitives, and the .missing-dispatch 404 treatment. Without it every route
// under /dashboard/settings and the dashboard 404 render unstyled. All rules in
// it are class-scoped, so nothing leaks into the rest of the dashboard.
import "@/styles/editorial-auth.css"
import "@/styles/welcome-marquee.css"

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
  // The docket is built on Fraunces italic — the verdict, every section head,
  // the drawer dateline. Without the italic face the browser synthesises one by
  // slanting the roman, and Fraunces' true italic is a different design, not a
  // slant. Measured against the visual spec: it was faux on every italic.
  style: ["normal", "italic"],
})

/**
 * The editorial chrome — everything the ~19 pre-Counter pages still need:
 * the cream sidebar, the "Owner Analyst" chat drawer (and its ⌘K listener),
 * the welcome marquee, and the four editorial stylesheets + Fraunces.
 *
 * This is `src/app/dashboard/layout.tsx` almost unchanged, moved one level
 * down into the `(editorial)` route group. Route groups don't affect the
 * URL — `/dashboard/orders` still resolves from `(editorial)/orders/
 * page.tsx` — they only let this subtree carry its own layout instead of
 * the bare shared one at `src/app/dashboard/layout.tsx`, which Counter
 * pages (starting with `/dashboard` itself) get instead. See DESIGN.md.
 */
export default async function EditorialLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const defaultPinned = cookieStore.get("sidebar_state")?.value === "true"

  const session = await getServerSession(authOptions)
  const firstName = session?.user?.firstName ?? null
  const showWelcome =
    session?.user?.id != null &&
    firstName != null &&
    (await consumePendingWelcome(session.user.id))

  // The drawer's composer offers the same store scope the chat page does.
  // Owner-scoped, and empty for anyone without chat access.
  const chatStores = session?.user?.accountId
    ? (await listOwnerStores(session.user.accountId)).map((s) => ({
        id: s.id,
        name: s.name,
      }))
    : []

  return (
    <div className={`${fraunces.variable} editorial-surface`}>
      <ChatDrawerProvider>
        <SidebarProvider defaultOpen={defaultPinned}>
          <AppSidebarClient />
          {/* min-w-0 lets the inset shrink beside the fixed rail — without it the
              non-wrapping topbar sets min-content width and the whole page
              overflows the viewport by the rail's 48px */}
          <SidebarInset className="min-w-0">
            {showWelcome && firstName ? (
              <WelcomeMarquee firstName={firstName} />
            ) : null}
            {children}
          </SidebarInset>
        </SidebarProvider>
        <ChatDrawerClient stores={chatStores} />
      </ChatDrawerProvider>
    </div>
  )
}
