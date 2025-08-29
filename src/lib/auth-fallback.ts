/**
 * Fallback authentication configuration for when NextAuth.js has issues
 */

import { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { Role } from "@prisma/client"

// Enhanced credentials provider with better error handling
const createCredentialsProvider = () => {
  return CredentialsProvider({
    id: "credentials-fallback",
    name: "Email and Password",
    type: "credentials",
    credentials: {
      email: { 
        label: "Email Address", 
        type: "email",
        placeholder: "user@example.com"
      },
      password: { 
        label: "Password", 
        type: "password",
        placeholder: "Enter your password"
      }
    },
    async authorize(credentials, req) {
      console.log('🔄 Fallback credentials provider triggered')
      
      try {
        if (!credentials?.email || !credentials?.password) {
          console.error('❌ Fallback: Missing email or password')
          throw new Error('Email and password are required')
        }

        console.log('🔍 Fallback: Looking up user:', credentials.email)

        // Test database connection first
        try {
          await prisma.$connect()
          console.log('✅ Fallback: Database connected')
        } catch (dbError) {
          console.error('❌ Fallback: Database connection failed:', dbError)
          throw new Error('Database connection failed')
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() }
        })

        if (!user) {
          console.error('❌ Fallback: User not found:', credentials.email)
          throw new Error('Invalid credentials')
        }

        const isValidPassword = await bcrypt.compare(credentials.password, user.password)

        if (!isValidPassword) {
          console.error('❌ Fallback: Invalid password for:', credentials.email)
          throw new Error('Invalid credentials')
        }

        console.log('✅ Fallback: Authentication successful for:', user.email)

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      } catch (error) {
        console.error('❌ Fallback authorize error:', error)
        // Return null to indicate authentication failure
        return null
      } finally {
        await prisma.$disconnect()
      }
    }
  })
}

// Fallback configuration with minimal dependencies
export const fallbackAuthOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
  
  providers: [
    createCredentialsProvider()
  ],

  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },

  callbacks: {
    async jwt({ token, user, trigger }) {
      console.log('🔑 Fallback JWT callback:', { 
        hasUser: !!user, 
        trigger, 
        tokenId: token.id ? 'exists' : 'missing' 
      })
      
      if (user) {
        token.id = user.id
        token.role = user.role
        token.email = user.email
        token.name = user.name
      }
      
      return token
    },

    async session({ session, token }) {
      console.log('🔐 Fallback session callback:', {
        tokenId: token.id ? 'exists' : 'missing',
        sessionUserId: session.user?.id ? 'exists' : 'missing'
      })
      
      if (session.user && token) {
        session.user.id = token.id as string
        session.user.role = token.role as Role
        session.user.email = token.email as string
        session.user.name = token.name as string
      }
      
      return session
    },

    async signIn({ user, account, profile }) {
      console.log('🚪 Fallback signIn callback:', {
        userId: user?.id ? 'exists' : 'missing',
        provider: account?.provider
      })
      return true
    }
  },

  pages: {
    signIn: "/login",
    error: "/login",
    signOut: "/login"
  },

  events: {
    async signIn({ user }) {
      console.log(`✅ Fallback: User signed in: ${user.email}`)
    },
    async signOut({ token }) {
      console.log(`👋 Fallback: User signed out: ${token?.id || 'unknown'}`)
    },
    async createUser({ user }) {
      console.log(`🆕 Fallback: User created: ${user.email}`)
    }
  },

  debug: process.env.NEXTAUTH_DEBUG === 'true',

  logger: {
    error(code, metadata) {
      console.error('❌ Fallback NextAuth Error:', code, metadata)
    },
    warn(code) {
      console.warn('⚠️ Fallback NextAuth Warning:', code)
    },
    debug(code, metadata) {
      if (process.env.NEXTAUTH_DEBUG === 'true') {
        console.log('🐛 Fallback NextAuth Debug:', code, metadata)
      }
    }
  }
}

// Function to test which auth configuration works
export async function testAuthConfiguration(): Promise<'main' | 'fallback' | 'error'> {
  try {
    // Test database connection first
    await prisma.$connect()
    await prisma.user.count()
    await prisma.$disconnect()
    
    console.log('✅ Auth test: Database connection successful')
    
    // Test environment variables
    if (!process.env.NEXTAUTH_SECRET && !process.env.AUTH_SECRET) {
      console.error('❌ Auth test: No secret configured')
      return 'error'
    }
    
    if (!process.env.NEXTAUTH_URL && process.env.NODE_ENV === 'production') {
      console.error('❌ Auth test: NEXTAUTH_URL not set in production')
      return 'error'
    }
    
    console.log('✅ Auth test: Environment variables OK')
    
    // For now, always try main config first
    return 'main'
    
  } catch (error) {
    console.error('❌ Auth test failed:', error)
    return 'fallback'
  }
}