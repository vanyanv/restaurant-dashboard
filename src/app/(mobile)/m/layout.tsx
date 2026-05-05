import type { Metadata, Viewport } from "next"
import { Fraunces } from "next/font/google"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { MobileTabBar } from "@/components/mobile/mobile-tab-bar"
import { getTabsForRole } from "@/lib/mobile/tabs"
import { WelcomeMarquee } from "@/components/dashboard/welcome-marquee"
import { consumePendingWelcome } from "@/lib/welcome"
import "@/styles/editorial-tokens.css"
import "@/styles/editorial-mobile.css"
import "@/styles/welcome-marquee.css"

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
})

export const metadata: Metadata = {
  title: "Chris Neddy's",
  applicationName: "Chris Neddy's",
  appleWebApp: {
    capable: true,
    title: "Chris Neddy's",
    statusBarStyle: "default",
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/apple-touch-icon-180.png",
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbf6ee",
}

export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  const tabs = getTabsForRole(session?.user?.role)
  const firstName = session?.user?.firstName ?? null
  const showWelcome =
    session?.user?.id != null &&
    firstName != null &&
    (await consumePendingWelcome(session.user.id))

  return (
    <div
      className={`${fraunces.variable} editorial-surface editorial-surface--mobile`}
    >
      <div className="m-shell">
        <main className="m-shell__main">
          {showWelcome && firstName ? (
            <WelcomeMarquee firstName={firstName} />
          ) : null}
          {children}
        </main>
        <MobileTabBar tabs={tabs} />
      </div>
    </div>
  )
}
