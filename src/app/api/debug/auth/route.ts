import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  // Only enable in development or when NEXTAUTH_DEBUG is true
  if (process.env.NODE_ENV === 'production' && process.env.NEXTAUTH_DEBUG !== 'true') {
    return NextResponse.json(
      { error: "Debug endpoint not available in production" },
      { status: 404 }
    )
  }

  try {
    console.log('🐛 Auth debug endpoint called')
    
    // Test session
    const session = await getServerSession(authOptions)
    
    // Test database connection and user count
    let dbInfo = null
    try {
      await prisma.$connect()
      const userCount = await prisma.user.count()
      const sampleUsers = await prisma.user.findMany({
        take: 3,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true
        }
      })
      
      dbInfo = {
        connected: true,
        userCount,
        sampleUsers: sampleUsers.map(u => ({
          ...u,
          id: u.id.substring(0, 8) + '...' // Partial ID for security
        }))
      }
    } catch (dbError) {
      dbInfo = {
        connected: false,
        error: dbError instanceof Error ? dbError.message : 'Unknown database error'
      }
    } finally {
      await prisma.$disconnect()
    }

    const debugInfo = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      session: session ? {
        hasUser: !!session.user,
        userEmail: session.user?.email,
        userRole: session.user?.role,
        userId: session.user?.id ? session.user.id.substring(0, 8) + '...' : null
      } : null,
      configuration: {
        nextauth_secret_configured: !!process.env.NEXTAUTH_SECRET,
        nextauth_url: process.env.NEXTAUTH_URL,
        database_url_configured: !!process.env.DATABASE_URL,
        debug_enabled: process.env.NEXTAUTH_DEBUG === 'true',
      },
      database: dbInfo
    }

    console.log('🐛 Debug info compiled successfully')
    
    return NextResponse.json(debugInfo)
  } catch (error) {
    console.error('🐛 Debug endpoint error:', error)
    
    return NextResponse.json({
      error: 'Debug endpoint failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}