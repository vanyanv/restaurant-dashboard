import type { Metadata } from "next"
import { DM_Sans, JetBrains_Mono } from "next/font/google"
import { NextAuthSessionProvider } from "@/lib/session-provider"
import { QueryProvider } from "@/lib/query-client"
import { Toaster } from "sonner"
import "./globals.css"

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" })
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
})

export const metadata: Metadata = {
  title: "ChrisnEddys Dashboard",
  description: "Restaurant management dashboard for store owners",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${jetbrainsMono.variable} ${dmSans.className}`}>
        <NextAuthSessionProvider session={null}>
          <QueryProvider>
            {children}
            <Toaster richColors position="top-right" />
          </QueryProvider>
        </NextAuthSessionProvider>
      </body>
    </html>
  )
}