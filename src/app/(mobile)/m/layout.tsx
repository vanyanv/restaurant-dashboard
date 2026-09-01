import type { Metadata, Viewport } from "next"
import { Suspense } from "react"
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
  // See `src/app/not-found.tsx` for why the editorial serif is not preloaded.
  preload: false,
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


/**
 * The post-sign-in marquee, moved OFF the shell's critical path.
 *
 * `consumePendingWelcome` is an Upstash round trip — a `getdel` over HTTPS —
 * and awaiting it in the layout body meant every `/m` page held its first byte
 * until a cache in another region answered. Measured against a production
 * build, phone routes answered at ~31ms while the root layout above them was
 * ready in ~3ms; almost all of the difference was this one call, made on every
 * page view to decide something that is true at most once per sign-in.
 *
 * Inside a `<Suspense fallback={null}>` the shell flushes first and this
 * resolves into it. Nothing is lost by arriving a beat later: the marquee
 * animates in and collapses itself after ~2.5s, so it was never part of the
 * page's settled layout, and the `getdel` still runs exactly once per render.
 */
async function WelcomeGate({ userId, firstName }: { userId: string; firstName: string }) {
  return (await consumePendingWelcome(userId)) ? <WelcomeMarquee firstName={firstName} /> : null
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

  return (
    <div
      className={`${fraunces.variable} editorial-surface editorial-surface--mobile`}
    >
      <PageViewTracker enabled={trackViews} />
      <div className="m-shell">
        <main className="m-shell__main">
          {session?.user?.id != null && firstName != null ? (
            <Suspense fallback={null}>
              <WelcomeGate userId={session.user.id} firstName={firstName} />
            </Suspense>
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
