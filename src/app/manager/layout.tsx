import type { Metadata } from "next"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"

export const metadata: Metadata = {
  title: "ChrisnEddys Manager",
  description: "Daily report form for restaurant managers",
}

export const generateViewport = () => ({
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
})

export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)
  
  if (!session) {
    redirect("/login")
  }
  
  if (session.user.role !== "MANAGER") {
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        {/* Sidebar will be added here if needed */}
        <main className="flex-1 w-full">
          {children}
        </main>
      </div>
    </div>
  )
}