import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { Role } from "@/generated/prisma/client"
import { recordLoginEvent } from "@/lib/monitoring/login-audit"
import { extractFirstName, markSignIn, markSignOut } from "@/lib/welcome"
import { logger } from "@/lib/logger"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      firstName: string | null
      role: Role
      accountId: string
    }
  }

  interface User {
    id: string
    email: string
    name: string
    role: Role
    accountId: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    role: Role
    accountId: string
  }
}

export const authOptions: NextAuthOptions = {
  // Explicitly set the secret for production
  secret: process.env.NEXTAUTH_SECRET,
  
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "credentials", 
      type: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, req) {
        const email = credentials?.email ?? ""
        const headers = req?.headers
        try {
          if (!credentials?.email || !credentials?.password) {
            return null
          }

          const user = await prisma.user.findUnique({
            where: {
              email: credentials.email
            }
          })

          if (!user) {
            await recordLoginEvent({ emailTried: email, kind: "SIGN_IN_FAILED", headers })
            return null
          }

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          )

          if (!isPasswordValid) {
            await recordLoginEvent({
              userId: user.id,
              emailTried: email,
              kind: "SIGN_IN_FAILED",
              headers,
            })
            return null
          }

          await recordLoginEvent({
            userId: user.id,
            emailTried: email,
            kind: "SIGN_IN",
            headers,
          })

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            accountId: user.accountId
          }
        } catch (error) {
          /*
           * A thrown error here is NOT a wrong password — `authorize` already
           * returned null for that above. This is the database being
           * unreachable, or bcrypt failing. Returning null still refuses the
           * sign-in (correct), but swallowing it silently made an outage
           * indistinguishable from a typo for whoever was reading the logs.
           */
          logger.error("[auth] credentials authorize failed", {
            emailTried: email,
            message: error instanceof Error ? error.message : String(error),
          })
          return null
        }
        /*
         * NO `$disconnect()` HERE, and no `$connect()` above.
         *
         * `prisma` is the process-wide singleton backed by a pg Pool. Vercel
         * Fluid Compute reuses one instance across concurrent requests, so
         * disconnecting at the end of a sign-in ended the pool for every OTHER
         * request that instance was serving — a connection teardown and a cold
         * reconnect on every login, successful or not, charged to unrelated
         * work. Prisma connects lazily on first query and is meant to stay
         * connected for the life of the instance.
         */
      }
    })
  ],
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.accountId = user.accountId
      } else if (token.id && (!token.accountId || !token.role)) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, accountId: true },
        })
        if (dbUser) {
          token.role = dbUser.role
          token.accountId = dbUser.accountId
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as Role
        session.user.accountId = token.accountId as string
        session.user.firstName = extractFirstName(session.user.name)
      }
      return session
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
    signOut: "/login"
  },
  events: {
    async signIn({ user }) {
      if (!user?.id) return
      await markSignIn({ userId: user.id, name: user.name })
    },
    async signOut({ token }) {
      const userId = (token?.id as string | undefined) ?? null
      const email = (token?.email as string | undefined) ?? ""
      if (!userId) return
      await Promise.all([
        recordLoginEvent({ userId, emailTried: email, kind: "SIGN_OUT" }),
        markSignOut(userId),
      ])
    },
  },
}

/**
 * Owner-level access. DEVELOPER is a superset of OWNER (full owner access
 * plus the monitoring page), so any gate that previously read `role === "OWNER"`
 * should use this helper instead. The literal `role === "DEVELOPER"` checks
 * are reserved for monitoring-only routes.
 *
 * READ THIS BEFORE REASONING ABOUT WHO CAN SEE WHAT: `Role` currently has
 * exactly two members, OWNER and DEVELOPER, and this returns true for both.
 * So every `if (!hasOwnerAccess(...)) redirect(...)` in the app — including
 * the carefully argued ones on the Counter Overview and P&L — is a branch
 * that CANNOT be taken today, and has never executed. The gates are not
 * wrong and are deliberately left in place: they are correct the moment a
 * third role exists, and deleting them would mean rediscovering the argument
 * for each one later. But nothing here enforces a role distinction right now,
 * and a reader who assumes otherwise will draw the wrong conclusion about
 * what is protected.
 *
 * The MANAGER role that made this meaningful was removed by decision. If it
 * is never coming back, the honest follow-up is to delete the gates rather
 * than keep them — what should not persist is the current halfway state
 * where they look load-bearing.
 */
export function hasOwnerAccess(role: Role | null | undefined): boolean {
  return role === "OWNER" || role === "DEVELOPER"
}