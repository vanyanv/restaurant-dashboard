import type { Metadata } from "next"
import { APPLE_STARTUP_IMAGES } from "@/lib/apple-startup-images"
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google"
import { CounterThemeProvider, themeNoFlashScript } from "@/components/counter/theme-provider"
import { Toaster } from "sonner"
import { ClientErrorListener } from "@/components/telemetry/client-error-listener"
import "./globals.css"

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" })
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
})
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
})

export const metadata: Metadata = {
  title: "ChrisnEddys Dashboard",
  description: "Restaurant management dashboard for store owners",
  applicationName: "Chris Neddy's",
  appleWebApp: {
    capable: true,
    title: "Chris Neddy's",
    statusBarStyle: "default",
    startupImage: APPLE_STARTUP_IMAGES,
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
      </head>
      <body className={`${dmSans.variable} ${jetbrainsMono.variable} ${bricolage.variable} ${dmSans.className}`}>
        {/*
          * ONLY what every route needs. `NextAuthSessionProvider` and
          * `QueryProvider` used to wrap everything from here, which put a
          * TanStack query client, a next-auth client session fetch and —
          * through `QueryProvider`'s `MotionConfig` — the whole of
          * framer-motion on the critical path of every first paint, including
          * `/login` (218.9 KB gzipped) and `/shutdown` (164.5 KB), the two
          * routes a signed-out visitor sees.
          *
          * Neither is used any more: the editorial tree that needed them was
          * deleted, and no Counter component imports framer-motion
          * (`components/counter/motion/` is hand-rolled).
          *
          * `CounterThemeProvider` stays: its no-flash script has to run before
          * first paint, which is the whole reason it is inline in <head>.
          * `Toaster` stays because `toast()` is called across the app.
          * `ClientErrorListener` sends browser errors no boundary caught to
          * the error log on Monitoring (a few hundred bytes, no render).
          */}
        <CounterThemeProvider>
          {children}
          <Toaster richColors position="top-right" />
          <ClientErrorListener />
        </CounterThemeProvider>
        {/* Real load and tap timings from the owner's own phone (LCP, INP, TTFB
            per page), reported to Vercel Speed Insights once it is enabled on
            the Vercel project. Vercel's plain script tag rather than the
            `@vercel/speed-insights` React component: the component adds ~3 KB
            to every route's first-load JS (it pushed /m/recipes/[id]/edit over
            its bundle budget); plain tags in the server HTML cost no bundle bytes
            (`next/script` itself added ~2 KB), and `defer` keeps it off the
            critical path. The script path 404s harmlessly until enabled. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "window.si=window.si||function(){(window.siq=window.siq||[]).push(arguments)}",
          }}
        />
        <script defer src="/_vercel/speed-insights/script.js" />
      </body>
    </html>
  )
}
