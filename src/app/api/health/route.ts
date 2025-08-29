import { NextResponse } from "next/server"
import { testDatabaseConnection } from "@/lib/prisma"
import { validateEnvironment } from "@/lib/env-check"

export async function GET() {
  try {
    console.log('🏥 Health check starting...')
    
    // Check environment variables
    const envCheck = validateEnvironment()
    
    // Check database connection
    const dbHealthy = await testDatabaseConnection()
    
    // Check NextAuth configuration
    const authConfigured = !!(
      process.env.NEXTAUTH_SECRET && 
      (process.env.NODE_ENV !== 'production' || process.env.NEXTAUTH_URL)
    )
    
    const status = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      checks: {
        environment: {
          status: envCheck.valid ? 'healthy' : 'unhealthy',
          errors: envCheck.errors
        },
        database: {
          status: dbHealthy ? 'healthy' : 'unhealthy'
        },
        authentication: {
          status: authConfigured ? 'healthy' : 'unhealthy',
          nextauth_secret: !!process.env.NEXTAUTH_SECRET,
          nextauth_url: !!process.env.NEXTAUTH_URL
        }
      }
    }
    
    const isHealthy = envCheck.valid && dbHealthy && authConfigured
    
    console.log(`🏥 Health check ${isHealthy ? 'passed' : 'failed'}`)
    
    return NextResponse.json(
      status,
      { status: isHealthy ? 200 : 503 }
    )
  } catch (error) {
    console.error('🏥 Health check error:', error)
    
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 503 }
    )
  }
}