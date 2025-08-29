# Fix: "Provider Type Credentials Not Supported" Error

This document explains how to fix the "provider type credentials not supported" error in NextAuth.js v4 with Next.js 15.

## 🚨 Error Description

**Error Message:**
```
provider type credentials not supported
```

**Common Causes:**
1. Missing environment variables for production
2. Edge Runtime compatibility issues
3. NextAuth.js v4 configuration problems
4. Missing trust host configuration

## ✅ Solution Implemented

### 1. **Added Required Environment Variables**

**In `.env.local` (and production):**
```bash
# Core NextAuth Configuration
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"  # or https://yourdomain.com in production
NEXTAUTH_URL_INTERNAL="http://localhost:3000"

# Production Trust Settings
AUTH_TRUST_HOST="true"

# Runtime Configuration
NEXTAUTH_RUNTIME="nodejs"

# Debug Mode
NEXTAUTH_DEBUG=true
```

### 2. **Fixed Credentials Provider Configuration**

**In `src/lib/auth.ts`:**
```typescript
providers: [
  CredentialsProvider({
    id: "credentials",           // ✅ Added explicit ID
    name: "credentials",         // ✅ Kept name
    type: "credentials",         // ✅ Added explicit type
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" }
    },
    async authorize(credentials) {
      // ... authentication logic
    }
  })
]
```

### 3. **Force Node.js Runtime**

**In `src/app/api/auth/[...nextauth]/route.ts`:**
```typescript
// Force Node.js runtime to prevent Edge runtime issues
export const runtime = 'nodejs'
```

## 🔍 Debugging Steps

### 1. Check Environment Variables
```bash
node -e "console.log({
  NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST
})"
```

### 2. Test Health Endpoint
```bash
curl http://localhost:3000/api/health
```

### 3. Check Debug Endpoint (Development Only)
```bash
curl http://localhost:3000/api/debug/auth
```

### 4. Check Server Logs
Look for these messages during startup:
```
✅ Database connected successfully
🔐 Starting authentication for: user@example.com
```

## 🛠 Common Issues & Solutions

### Issue 1: "Credentials provider not found"
**Solution:** Ensure provider has explicit `id`, `name`, and `type` fields

### Issue 2: "Trust host error"
**Solution:** Set `AUTH_TRUST_HOST=true` in production environment

### Issue 3: "Edge Runtime compatibility"
**Solution:** Add `export const runtime = 'nodejs'` to auth route

### Issue 4: "Callback URL mismatch"
**Solution:** Ensure `NEXTAUTH_URL` matches your actual domain

## 📋 Production Deployment Checklist

- [ ] `NEXTAUTH_SECRET` is set to a secure 32+ character string
- [ ] `NEXTAUTH_URL` matches your production domain (https://yourdomain.com)
- [ ] `AUTH_TRUST_HOST=true` is set
- [ ] `DATABASE_URL` points to your production database
- [ ] Node.js runtime is specified in auth route
- [ ] Credentials provider has explicit configuration
- [ ] Health check returns healthy status

## 🔄 Alternative Solutions

If the credentials provider still doesn't work:

### Option 1: Update to Auth.js v5
```bash
npm uninstall next-auth
npm install @auth/nextjs-adapter @auth/prisma-adapter
```

### Option 2: Use Different Provider
Consider using OAuth providers instead of credentials:
```typescript
providers: [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  })
]
```

### Option 3: Custom Authentication
Implement custom JWT-based authentication without NextAuth.js

## 🧪 Testing Authentication

### Development Testing
```bash
# Start development server
npm run dev

# Visit login page
open http://localhost:3000/login

# Try logging in with test credentials
```

### Production Testing
```bash
# Build for production
npm run build

# Start production server
npm start

# Test authentication flow
```

## 📞 Getting Help

If you're still experiencing issues:

1. **Check the Browser Console** for client-side errors
2. **Check Server Logs** for authentication errors  
3. **Test Environment Variables** are properly loaded
4. **Verify Database Connection** is working
5. **Try Different Browsers** to rule out client issues

## 🔒 Security Notes

- Always use HTTPS in production
- Use strong, unique secrets for `NEXTAUTH_SECRET`
- Never commit `.env` files to version control
- Regularly rotate authentication secrets
- Enable proper CORS settings for production