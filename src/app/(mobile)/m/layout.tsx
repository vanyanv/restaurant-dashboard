import type { Metadata, Viewport } from "next"
import { Fraunces } from "next/font/google"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { MobileTabBar } from "@/components/mobile/mobile-tab-bar"
import { getTabs } from "@/lib/mobile/tabs"
import { WelcomeMarquee } from "@/components/dashboard/welcome-marquee"
import { consumePendingWelcome } from "@/lib/welcome"
import { PageViewTracker } from "@/components/telemetry/page-view-tracker"
import "@/styles/editorial-tokens.css"
import "@/styles/editorial-mobile.css"
import "@/styles/welcome-marquee.css"
import { BROWSER_CHROME_DARK, BROWSER_CHROME_LIGHT } from "@/lib/browser-chrome-colour"

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
  // See `@/lib/browser-chrome-colour` — a literal by necessity, named there.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: BROWSER_CHROME_DARK },
    { media: "(prefers-color-scheme: light)", color: BROWSER_CHROME_LIGHT },
  ],
}

export default async function MobileLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  const trackViews =
    session?.user?.id != null &&
    (session.user.role !== "DEVELOPER" ||
      // Local-only escape hatch; never honoured in production.
      (process.env.TRACK_DEVELOPER_PAGE_VIEWS === "1" &&
        process.env.NODE_ENV !== "production"))
  const tabs = getTabs()
  const firstName = session?.user?.firstName ?? null
  const showWelcome =
    session?.user?.id != null &&
    firstName != null &&
    (await consumePendingWelcome(session.user.id))

  return (
    <div
      className={`${fraunces.variable} editorial-surface editorial-surface--mobile`}
    >
      <PageViewTracker enabled={trackViews} />
      <div className="m-shell">
        <main className="m-shell__main">
          {showWelcome && firstName ? (
            <WelcomeMarquee firstName={firstName} />
          ) : null}
          {children}
        </main>
        {/* No tab bar without a session. Every tab it draws goes somewhere
            that requires one, and `/m/login` now lives under this layout — a
            sign-in screen offering five links to pages you cannot open is a
            row of dead ends. The layout already reads the session for the
            welcome marquee, so this costs no query. */}
        {session ? <MobileTabBar tabs={tabs} /> : null}
      </div>
    </div>
  )
}
