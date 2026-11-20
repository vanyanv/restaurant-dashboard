import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { Role } from "@/generated/prisma/client"
import { extractIp, recordLoginEvent } from "@/lib/monitoring/login-audit"
import { extractFirstName, markSignIn, markSignOut } from "@/lib/welcome"
import { logger } from "@/lib/logger"
import { cache } from "react"
import { createHash } from "node:crypto"
import { issuedBeforePasswordChange } from "@/lib/password-change"
import { isOverLimitKey, rateLimitKey, RATE_LIMIT_TIERS } from "@/lib/rate-limit"

/**
 * The jwt callback's "who is this still" read, once per request.
 *
 * Every `getServerSession` runs the jwt callback, and a phone page calls it from
 * its layouts, its page and its loaders: measured on `/m`, ten identical
 * primary-key reads of the same user for one page view. `cache()` memoizes for
 * the length of one server render, so a removal or role change still applies
 * on the very next page load. Outside a render (route handlers, actions) React
 * does not memoize and this is a plain call, as before.
 */
const readSessionUser = cache((id: string) =>
  prisma.user.findUnique({
    where: { id },
    select: { role: true, accountId: true, removedAt: true, passwordChangedAt: true },
  }),
)

/**
 * The thrown message `authorize` uses when one email has had too many wrong
 * passwords. A protocol token the login pages read, like `auth_unavailable`.
 */
export const AUTH_THROTTLED = "auth_throttled"

/** Longest email worth keying or storing (RFC 5321's 254-character path limit). */
const MAX_EMAIL = 254

/**
 * The failure counter's key: one email from one address. Hashed so keys stay
 * short whatever is typed.
 *
 * Per (email, address), not per email alone: a per-email budget lets anyone
 * who knows the owner's email keep the owner locked out by sending wrong
 * passwords from rotating addresses. Keyed with the address, a stranger only
 * ever spends their own budget; the owner signing in from the store or home
 * is untouched. The route's per-IP tier still caps each address overall.
 */
export function signInEmailKey(email: string, ip: string | null = null): string {
  const normalized = email.trim().toLowerCase().slice(0, MAX_EMAIL)
  return `auth-email:${createHash("sha256").update(`${normalized}|${ip ?? "unknown"}`).digest("hex")}`
}


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

          // Per-(email, address) failure budget, on top of the route's per-IP
          // one. Checked before the user lookup and charged for unknown emails
          // too, so the refusal never tells a stranger whether an address has
          // an account. Past the budget even the right password waits from
          // that address: otherwise guessing would simply continue until it hit.
          const emailKey = signInEmailKey(credentials.email, headers ? extractIp(headers) : null)
          if (await isOverLimitKey(emailKey, RATE_LIMIT_TIERS.authEmail)) {
            await recordLoginEvent({ emailTried: email, kind: "SIGN_IN_FAILED", headers })
            throw new Error(AUTH_THROTTLED)
          }

          // Emails are stored lowercased; people type them however they like.
          const user = await prisma.user.findFirst({
            where: { email: { equals: credentials.email.trim(), mode: "insensitive" } },
          })

          // A removed person (Admin > People) fails exactly like a wrong
          // password: the form does not say which half was wrong.
          if (!user || user.removedAt) {
            await rateLimitKey(emailKey, RATE_LIMIT_TIERS.authEmail)
            await recordLoginEvent({ userId: user?.id, emailTried: email, kind: "SIGN_IN_FAILED", headers })
            return null
          }

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          )

          if (!isPasswordValid) {
            await rateLimitKey(emailKey, RATE_LIMIT_TIERS.authEmail)
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
          if (error instanceof Error && error.message === AUTH_THROTTLED) throw error
          /*
           * A thrown error here is NOT a wrong password — `authorize` already
           * returned null for that above. This is the database being
           * unreachable, or bcrypt failing.
           *
           * ## Why this throws instead of returning null
           *
           * Returning null refused the sign-in, which is correct, but it
           * refused it through the SAME channel a wrong password uses, so the
           * login page could only offer one sentence for both and chose
           * "Email or password is wrong". Measured against a real outage on
           * 2026-09-02, when Neon suspended this project for exceeding its
           * data-transfer quota: every query failed, and an owner typing the
           * right password was told it was wrong. They would retype it, then
           * conclude they had been locked out — the one reading of the screen
           * that leads nowhere useful.
           *
           * The note above already said this fault out loud and fixed only
           * half of it: "swallowing it silently made an outage
           * indistinguishable from a typo for whoever was reading the LOGS."
           * It stayed indistinguishable for the person signing in, which is
           * the half that matters.
           *
           * next-auth v4 routes the two apart, verified in its own source
           * (`core/routes/callback.js`): a null authorize redirects with
           * `error=CredentialsSignin`, a THROWN one with
           * `error=<message>`, and `react/index.js` hands that param back as
           * `result.error` under `redirect: false`. So the message below is a
           * protocol token the login page reads — not prose, and deliberately
           * not the caught error, which would put the database host and the
           * quota text in a URL.
           */
          logger.error("[auth] credentials authorize failed", {
            emailTried: email,
            message: error instanceof Error ? error.message : String(error),
          })
          throw new Error("auth_unavailable")
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
  // next-auth logs the session check ending a removed person's session as
  // JWT_SESSION_ERROR. That is the feature working, not a fault, so it is
  // left out of the error log; every other next-auth error is kept.
  logger: {
    error(code, metadata) {
      const message = metadata instanceof Error ? metadata.message : (metadata as { message?: string } | undefined)?.message
      if (code === "JWT_SESSION_ERROR" && message === "access_removed") return
      logger.error(`[next-auth][error][${code}]`, metadata)
    },
    warn(code) {
      logger.warn(`[next-auth][warn][${code}]`)
    },
    debug() {},
  },
  session: {
    strategy: "jwt",
    // 30 days, renewed while in use (`useKeepPlace` touches the session once
    // a day). It was 8 hours, which signed the owner out between visits and
    // dropped them on Overview. Removing someone on Admin > People still ends
    // their session on the next page load: the jwt callback below checks.
    maxAge: 30 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.accountId = user.accountId
      } else if (token.id) {
        // Every session read asks the database who this still is, so removing
        // someone on Admin > People signs them out on their next page load and
        // a role change applies at once. One primary-key read. Throwing here
        // is how next-auth ends a session: getServerSession returns null and
        // /api/auth/session clears the cookie.
        //
        // A database that does not answer keeps the session as it was: a
        // blip must not sign everyone out. Only a definite "removed" or "gone"
        // ends it.
        let dbUser:
          | { role: Role; accountId: string; removedAt: Date | null; passwordChangedAt: Date | null }
          | null
          | undefined
        try {
          dbUser = await readSessionUser(token.id as string)
        } catch (error) {
          logger.warn("[auth] session check skipped, database did not answer", {
            message: error instanceof Error ? error.message : String(error),
          })
          dbUser = undefined
        }
        if (dbUser === null || dbUser?.removedAt) throw new Error("access_removed")
        // A password change ends every session signed in before it. The
        // person who changed it got a fresh cookie at that moment
        // (`reissueSessionCookie`), so only the others end here.
        if (dbUser && issuedBeforePasswordChange(token.iat, dbUser.passwordChangedAt)) {
          throw new Error("access_removed")
        }
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