import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    // Test database connection
    await prisma.$connect()
    await prisma.user.count()
    
    // Check NextAuth configuration
    const authConfigured = !!(
      process.env.NEXTAUTH_SECRET && 
      process.env.DATABASE_URL
    )
    
    const status = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      checks: {
        database: {
          status: 'healthy'
        },
        authentication: {
          status: authConfigured ? 'healthy' : 'unhealthy'
        }
      }
    }
    
    return NextResponse.json(status, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: 'Service unavailable'
      },
      { status: 503 }
    )
  } finally {
    await prisma.$disconnect()
  }
}