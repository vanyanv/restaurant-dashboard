#!/usr/bin/env node

/**
 * Authentication Diagnostic Script
 * Run this script to diagnose NextAuth.js issues
 */

console.log('🔍 NextAuth.js Diagnostic Tool\n')

// Check Node.js version
console.log('📋 System Information:')
console.log(`Node.js version: ${process.version}`)
console.log(`Platform: ${process.platform}`)
console.log(`Architecture: ${process.arch}\n`)

// Check environment variables
console.log('🔐 Environment Variables:')
const envVars = [
  'NEXTAUTH_SECRET',
  'AUTH_SECRET', 
  'NEXTAUTH_URL',
  'NEXTAUTH_URL_INTERNAL',
  'AUTH_TRUST_HOST',
  'DATABASE_URL',
  'NEXTAUTH_DEBUG',
  'NODE_ENV'
]

let missingVars = []
envVars.forEach(varName => {
  const value = process.env[varName]
  if (value) {
    // Hide sensitive values
    const display = ['SECRET', 'DATABASE_URL'].some(sensitive => varName.includes(sensitive))
      ? '[HIDDEN]'
      : value
    console.log(`✅ ${varName}: ${display}`)
  } else {
    console.log(`❌ ${varName}: Not set`)
    if (['NEXTAUTH_SECRET', 'DATABASE_URL'].includes(varName)) {
      missingVars.push(varName)
    }
  }
})

// Check for critical missing variables
if (missingVars.length > 0) {
  console.log(`\n🚨 Critical missing variables: ${missingVars.join(', ')}`)
} else {
  console.log('\n✅ All critical environment variables are set')
}

// Validate URLs
console.log('\n🌐 URL Validation:')
if (process.env.NEXTAUTH_URL) {
  try {
    new URL(process.env.NEXTAUTH_URL)
    console.log('✅ NEXTAUTH_URL is valid')
  } catch (e) {
    console.log('❌ NEXTAUTH_URL is not a valid URL')
  }
} else {
  console.log('⚠️  NEXTAUTH_URL not set')
}

// Check package.json dependencies
console.log('\n📦 Dependencies:')
try {
  const pkg = require('../package.json')
  const deps = pkg.dependencies || {}
  
  const authDeps = {
    'next-auth': deps['next-auth'],
    'next': deps['next'],
    'bcryptjs': deps['bcryptjs'],
    '@prisma/client': deps['@prisma/client']
  }
  
  Object.entries(authDeps).forEach(([name, version]) => {
    if (version) {
      console.log(`✅ ${name}: ${version}`)
    } else {
      console.log(`❌ ${name}: Not installed`)
    }
  })
} catch (e) {
  console.log('❌ Could not read package.json')
}

// Test database connection (basic check)
console.log('\n🗄️  Database Connection:')
if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL)
    console.log(`✅ Database protocol: ${url.protocol}`)
    console.log(`✅ Database host: ${url.hostname}`)
    console.log(`✅ Database name: ${url.pathname.slice(1)}`)
    
    if (url.protocol === 'postgresql:' || url.protocol === 'postgres:') {
      console.log('✅ Using PostgreSQL database')
    } else {
      console.log(`⚠️  Unusual database protocol: ${url.protocol}`)
    }
  } catch (e) {
    console.log('❌ DATABASE_URL is not a valid URL format')
  }
} else {
  console.log('❌ DATABASE_URL not set')
}

// Configuration recommendations
console.log('\n💡 Recommendations:')

const recommendations = []

if (!process.env.NEXTAUTH_SECRET) {
  recommendations.push('Generate NEXTAUTH_SECRET: openssl rand -base64 32')
}

if (!process.env.NEXTAUTH_URL && process.env.NODE_ENV === 'production') {
  recommendations.push('Set NEXTAUTH_URL to your production domain in production')
}

if (process.env.AUTH_TRUST_HOST !== 'true' && process.env.NODE_ENV === 'production') {
  recommendations.push('Set AUTH_TRUST_HOST=true for production deployment')
}

if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('username:password')) {
  recommendations.push('Update DATABASE_URL with real database credentials')
}

if (recommendations.length === 0) {
  console.log('✅ Configuration looks good!')
} else {
  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec}`)
  })
}

// Next steps
console.log('\n🚀 Next Steps:')
console.log('1. Fix any missing environment variables')
console.log('2. Test locally: npm run dev')
console.log('3. Check health endpoint: curl http://localhost:3000/api/health')
console.log('4. Check debug endpoint: curl http://localhost:3000/api/debug/auth')
console.log('5. Try logging in through the UI')

console.log('\n📚 Documentation:')
console.log('- Production Setup Guide: ./PRODUCTION_SETUP.md')
console.log('- Credentials Provider Fix: ./CREDENTIALS_PROVIDER_FIX.md')
console.log('- NextAuth.js Docs: https://next-auth.js.org/configuration')

console.log('\n✨ Diagnostic complete!')