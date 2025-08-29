# Production Setup Guide

This guide covers how to fix the authentication 401 error in production and properly deploy your restaurant dashboard.

## 🚨 Common 401 Authentication Issues

The `api/auth/callback/credentials` 401 error is typically caused by:

1. **Missing NEXTAUTH_URL** - Required in production
2. **Missing NEXTAUTH_SECRET** - Required for JWT signing
3. **Database connection issues** - Cannot authenticate users
4. **Incorrect environment configuration**

## 🔧 Required Environment Variables

### Development (.env.local)
```bash
# NextAuth Configuration
NEXTAUTH_SECRET="okBXCWTgY6ZbMul4+F4mLEFD0dbDsgPwAyrjUj+zhBs="
NEXTAUTH_URL="http://localhost:3000"

# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/restaurant_db"

# Debug mode for troubleshooting
NEXTAUTH_DEBUG=true
```

### Production Environment Variables
```bash
# NextAuth Configuration - CRITICAL FOR PRODUCTION
NEXTAUTH_SECRET="your-super-secret-jwt-key-here"
NEXTAUTH_URL="https://yourdomain.com"

# Database Configuration
DATABASE_URL="postgresql://username:password@host:5432/database"

# Production settings
NODE_ENV=production
NEXTAUTH_DEBUG=false
```

## 🔍 Debugging Steps

### 1. Check Health Status
Visit `/api/health` to see system status:

```bash
curl https://yourdomain.com/api/health
```

Expected response:
```json
{
  "status": "ok",
  "checks": {
    "environment": { "status": "healthy" },
    "database": { "status": "healthy" },
    "authentication": { "status": "healthy" }
  }
}
```

### 2. Debug Authentication (Development Only)
Visit `/api/debug/auth` to see detailed auth configuration:

```bash
curl http://localhost:3000/api/debug/auth
```

### 3. Check Server Logs
Look for these log messages during authentication:

**Successful Authentication:**
```
🔐 Starting authentication for: user@example.com
✅ Database connected successfully
✅ User found: user@example.com Role: OWNER
✅ Authentication successful for: user@example.com
```

**Failed Authentication:**
```
❌ Missing credentials
❌ Database connection failed
❌ User not found: user@example.com
❌ Invalid password for user: user@example.com
```

## 🛠 Fixing Common Issues

### Issue 1: "NEXTAUTH_URL is not configured"
**Solution:** Add NEXTAUTH_URL to your production environment
```bash
NEXTAUTH_URL="https://yourdomain.com"
```

### Issue 2: "Database connection failed"
**Solution:** Check your DATABASE_URL and database accessibility
```bash
# Test database connection
npx prisma db pull
```

### Issue 3: "Invalid password" but password is correct
**Solution:** Check if user exists and password is properly hashed
```bash
# Check users in database
npx prisma studio
```

### Issue 4: JWT/Session issues
**Solution:** Regenerate NEXTAUTH_SECRET
```bash
# Generate new secret
openssl rand -base64 32
```

## 📋 Pre-Deployment Checklist

- [ ] NEXTAUTH_SECRET is set and secure (32+ characters)
- [ ] NEXTAUTH_URL matches your production domain
- [ ] DATABASE_URL points to production database
- [ ] Database is accessible from production environment
- [ ] All required tables exist (run `npx prisma db push`)
- [ ] At least one user account exists for testing
- [ ] Health check endpoint returns healthy status
- [ ] Authentication flow works in production

## 🚀 Deployment Steps

### 1. Environment Setup
```bash
# Set production environment variables
export NEXTAUTH_SECRET="your-production-secret"
export NEXTAUTH_URL="https://yourdomain.com" 
export DATABASE_URL="your-production-db-url"
export NODE_ENV="production"
```

### 2. Database Setup
```bash
# Push schema to production database
npx prisma db push

# Seed database with initial data (optional)
npm run db:seed
```

### 3. Build and Deploy
```bash
# Build production bundle
npm run build

# Start production server
npm run start
```

### 4. Verification
1. Visit `/api/health` - should return healthy status
2. Try logging in with test credentials
3. Check server logs for any authentication errors

## 🐛 Troubleshooting Commands

```bash
# Check environment variables are loaded
node -e "console.log({
  NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  DATABASE_URL: !!process.env.DATABASE_URL
})"

# Test database connection
npx prisma db pull

# Generate new authentication secret
openssl rand -base64 32

# Check NextAuth configuration
curl -X GET https://yourdomain.com/api/auth/providers
```

## 📞 Getting Help

If you're still experiencing issues:

1. Check the server logs during login attempts
2. Verify all environment variables are set correctly
3. Test database connectivity independently
4. Try creating a new user account to rule out password issues
5. Use the debug endpoints during development to identify the issue

## 🔒 Security Notes

- Never commit `.env.local` to version control
- Use strong, unique secrets in production
- Regularly rotate your NEXTAUTH_SECRET
- Ensure database credentials are secure
- Enable HTTPS in production
- Consider using environment variable management services