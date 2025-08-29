/**
 * Environment validation and production readiness checker
 */

import { testDatabaseConnection } from './prisma'

interface EnvCheck {
  name: string
  value: string | undefined
  required: boolean
  description: string
}

const requiredEnvVars: EnvCheck[] = [
  {
    name: 'NEXTAUTH_SECRET',
    value: process.env.NEXTAUTH_SECRET,
    required: true,
    description: 'Secret for NextAuth JWT signing'
  },
  {
    name: 'NEXTAUTH_URL',
    value: process.env.NEXTAUTH_URL,
    required: process.env.NODE_ENV === 'production',
    description: 'Base URL for NextAuth callbacks'
  },
  {
    name: 'DATABASE_URL',
    value: process.env.DATABASE_URL,
    required: true,
    description: 'Database connection string'
  },
  {
    name: 'NODE_ENV',
    value: process.env.NODE_ENV,
    required: true,
    description: 'Runtime environment'
  }
]

export function validateEnvironment(): { valid: boolean; errors: string[] } {
  console.log('🔍 Validating environment configuration...')
  
  const errors: string[] = []
  
  for (const envVar of requiredEnvVars) {
    if (envVar.required && !envVar.value) {
      errors.push(`❌ Missing required environment variable: ${envVar.name} - ${envVar.description}`)
    } else if (envVar.value) {
      console.log(`✅ ${envVar.name}: ${envVar.name === 'DATABASE_URL' || envVar.name.includes('SECRET') ? '[HIDDEN]' : envVar.value}`)
    } else {
      console.log(`⚠️  Optional ${envVar.name}: Not set - ${envVar.description}`)
    }
  }

  // Validate NEXTAUTH_URL format if provided
  if (process.env.NEXTAUTH_URL) {
    try {
      new URL(process.env.NEXTAUTH_URL)
    } catch {
      errors.push('❌ NEXTAUTH_URL is not a valid URL')
    }
  }

  // Check for development vs production settings
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.NEXTAUTH_URL) {
      errors.push('❌ NEXTAUTH_URL is required in production')
    }
    if (process.env.NEXTAUTH_DEBUG === 'true') {
      console.log('⚠️  NEXTAUTH_DEBUG is enabled in production - consider disabling for better performance')
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

export async function runStartupChecks(): Promise<boolean> {
  console.log('🚀 Running startup checks...')
  
  // 1. Validate environment variables
  const envCheck = validateEnvironment()
  if (!envCheck.valid) {
    console.error('❌ Environment validation failed:')
    envCheck.errors.forEach(error => console.error(error))
    return false
  }
  
  // 2. Test database connection
  console.log('🔌 Testing database connection...')
  const dbConnected = await testDatabaseConnection()
  if (!dbConnected) {
    console.error('❌ Database connection test failed')
    return false
  }
  
  // 3. Check NextAuth configuration
  console.log('🔐 Checking NextAuth configuration...')
  if (!process.env.NEXTAUTH_SECRET) {
    console.error('❌ NEXTAUTH_SECRET is not configured')
    return false
  }
  
  console.log('✅ All startup checks passed!')
  return true
}

// Auto-run checks in development
if (process.env.NODE_ENV === 'development' && typeof window === 'undefined') {
  runStartupChecks().catch(error => {
    console.error('❌ Startup checks failed:', error)
  })
}