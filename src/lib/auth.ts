import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { Role } from "@/generated/prisma/client"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      email: string
      name: string
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
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) {
            return null
          }

          await prisma.$connect()

          const user = await prisma.user.findUnique({
            where: {
              email: credentials.email
            }
          })

          if (!user) {
            return null
          }

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          )

          if (!isPasswordValid) {
            return null
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            accountId: user.accountId
          }
        } catch (error) {
          return null
        } finally {
          await prisma.$disconnect()
        }
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
      }
      return session
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
    signOut: "/login"
  }
}