import type { Metadata, Viewport } from "next"
import { Fraunces } from "next/font/google"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { MobileTabBar } from "@/components/mobile/mobile-tab-bar"
import { getTabsForRole } from "@/lib/mobile/tabs"
import "@/styles/editorial.css"

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
  maximumScale: 1,
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

  return (
    <div
      className={`${fraunces.variable} editorial-surface editorial-surface--mobile`}
    >
      <div className="m-shell">
        <main className="m-shell__main">{children}</main>
        <MobileTabBar tabs={tabs} />
      </div>
    </div>
  )
}
