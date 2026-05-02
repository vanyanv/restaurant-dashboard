"use client"

import { SessionProvider } from "next-auth/react"
import type { Session } from "next-auth"
import { type ReactNode } from "react"

export function NextAuthSessionProvider({
  children,
  session,
}: {
  children: ReactNode
  session?: Session | null
}) {
  if (session === undefined) {
    // Omit the prop entirely so NextAuth performs its initial client session fetch.
    return <SessionProvider>{children}</SessionProvider>
  }

  return (
    <SessionProvider session={session}>
      {children}
    </SessionProvider>
  )
}
