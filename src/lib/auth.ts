import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { Role } from "@prisma/client"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: Role
    }
  }
  
  interface User {
    id: string
    email: string
    name: string
    role: Role
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    role: Role
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
          console.log('🔐 Starting authentication for:', credentials?.email)
          
          if (!credentials?.email || !credentials?.password) {
            console.error('❌ Missing credentials')
            return null
          }

          // Add database connection check
          try {
            await prisma.$connect()
            console.log('✅ Database connected successfully')
          } catch (dbError) {
            console.error('❌ Database connection failed:', dbError)
            throw new Error('Database connection failed')
          }

          const user = await prisma.user.findUnique({
            where: {
              email: credentials.email
            }
          })

          if (!user) {
            console.error('❌ User not found:', credentials.email)
            return null
          }

          console.log('✅ User found:', user.email, 'Role:', user.role)

          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          )

          if (!isPasswordValid) {
            console.error('❌ Invalid password for user:', credentials.email)
            return null
          }

          console.log('✅ Authentication successful for:', user.email)

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
          }
        } catch (error) {
          console.error('❌ Authentication error:', error)
          return null
        } finally {
          await prisma.$disconnect()
        }
      }
    })
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (process.env.NEXTAUTH_DEBUG === 'true') {
        console.log('🔑 JWT Callback - User:', user ? 'Present' : 'Not present', 'Trigger:', trigger)
      }
      
      if (user) {
        token.id = user.id
        token.role = user.role
      }
      return token
    },
    async session({ session, token }) {
      if (process.env.NEXTAUTH_DEBUG === 'true') {
        console.log('🔐 Session Callback - Token ID:', token.id, 'Role:', token.role)
      }
      
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as Role
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
    async signOut(message) {
      // Log logout events for security monitoring
      console.log(`👋 User signed out: ${message.token?.id || 'unknown'}`)
    },
    async signIn(message) {
      console.log(`✅ User signed in: ${message.user.email} (${message.user.id})`)
    }
  },
  // Enable debug mode in development
  debug: process.env.NEXTAUTH_DEBUG === 'true',
  
  // Add logger for production debugging
  logger: {
    error(code, metadata) {
      console.error('NextAuth Error:', code, metadata)
    },
    warn(code) {
      console.warn('NextAuth Warning:', code)
    },
    debug(code, metadata) {
      if (process.env.NEXTAUTH_DEBUG === 'true') {
        console.log('NextAuth Debug:', code, metadata)
      }
    }
  }
}