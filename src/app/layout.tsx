import type { Metadata } from "next"
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google"
import { CounterThemeProvider, themeNoFlashScript } from "@/components/counter/theme-provider"
import { Toaster } from "sonner"
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
          * Neither is used outside the editorial tree: `useQuery` appears only
          * in `components/analytics` and `components/monitoring`, `useSession`
          * only in `app-sidebar.tsx`, and no Counter component imports
          * framer-motion at all (`components/counter/motion/` is hand-rolled).
          * Both now live in `(editorial)/layout.tsx`.
          *
          * `CounterThemeProvider` stays: its no-flash script has to run before
          * first paint, which is the whole reason it is inline in <head>.
          * `Toaster` stays because `toast()` is called from both trees.
          */}
        <CounterThemeProvider>
          {children}
          <Toaster richColors position="top-right" />
        </CounterThemeProvider>
      </body>
    </html>
  )
}
