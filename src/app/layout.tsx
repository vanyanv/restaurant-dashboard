import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { NextAuthSessionProvider } from "@/lib/session-provider"
import { QueryProvider } from "@/lib/query-client"
import { Toaster } from "sonner"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

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
      <body className={inter.className}>
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