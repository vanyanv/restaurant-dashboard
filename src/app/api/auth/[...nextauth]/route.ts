import NextAuth from "next-auth"
import { authOptions } from "@/lib/auth"

// Force Node.js runtime to prevent Edge runtime issues with credentials provider
export const runtime = 'nodejs'

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }