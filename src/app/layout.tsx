import type { Metadata } from "next"
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google"
import { NextAuthSessionProvider } from "@/lib/session-provider"
import { QueryProvider } from "@/lib/query-client"
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
        <CounterThemeProvider>
          <NextAuthSessionProvider>
            <QueryProvider>
              {children}
              <Toaster richColors position="top-right" />
            </QueryProvider>
          </NextAuthSessionProvider>
        </CounterThemeProvider>
      </body>
    </html>
  )
}
