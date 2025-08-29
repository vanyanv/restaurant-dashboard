# Vercel Deployment Guide

This guide covers deploying your restaurant dashboard to Vercel and fixing the "provider type credentials not supported" error.

## 🚀 Quick Vercel Setup

### 1. **Environment Variables in Vercel Dashboard**

Go to your Vercel project settings → Environment Variables and add:

#### **Production Variables:**
```bash
# Required for NextAuth.js
NEXTAUTH_SECRET="your-generated-secret-here"

# Database connection
DATABASE_URL="your-production-database-url"

# Optional: Enable debugging for troubleshooting
NEXTAUTH_DEBUG="false"  # Set to "true" only during troubleshooting

# Trust host (important for Vercel)
AUTH_TRUST_HOST="true"
```

#### **Preview/Development Variables:**
```bash
# Same as production, but you might want debug enabled
NEXTAUTH_DEBUG="true"
DATABASE_URL="your-staging-database-url"
```

### 2. **Generate NEXTAUTH_SECRET**

Use one of these methods:
```bash
# Option 1: Using OpenSSL
openssl rand -base64 32

# Option 2: Using Vercel's generator
# Visit: https://generate-secret.vercel.app/32

# Option 3: Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. **Important Notes for Vercel**

- ✅ **No need to set NEXTAUTH_URL** - Vercel handles this automatically
- ✅ **System Environment Variables** are automatically available
- ✅ **Credentials Provider** works well for preview deployments
- ✅ **Edge Runtime** is avoided by using `export const runtime = 'nodejs'`

## 🔧 Vercel-Specific Configuration

### Environment Detection
Your app automatically detects Vercel environment:

```javascript
// Vercel provides these automatically:
// VERCEL=true
// VERCEL_ENV="production" | "preview" | "development"  
// VERCEL_URL="your-deployment-url.vercel.app"
```

### Preview Deployment Security
For preview deployments, the credentials provider is perfect:

```typescript
// This configuration works great on Vercel preview deployments
providers: [
  CredentialsProvider({
    id: "credentials",
    name: "credentials", 
    type: "credentials",
    // ... rest of configuration
  })
]
```

## 🛠 Troubleshooting Vercel Deployment

### Issue 1: "Provider type credentials not supported"
**Solution:** Ensure these Vercel environment variables are set:
- ✅ `NEXTAUTH_SECRET` (required)
- ✅ `AUTH_TRUST_HOST=true` (important for Vercel)
- ✅ `DATABASE_URL` (must be accessible from Vercel)

### Issue 2: Database connection failed
**Solution:** Make sure your database allows connections from Vercel's IP ranges:
- Use connection pooling (recommended: PlanetScale, Supabase, or Neon)
- Whitelist Vercel's IPs if using restrictive database hosting

### Issue 3: Environment variables not loading
**Solution:** 
- Check variable names match exactly (case-sensitive)
- Ensure variables are set for the correct environment (Production/Preview/Development)
- Redeploy after adding environment variables

### Issue 4: Edge Runtime errors
**Solution:** Our configuration already includes:
```typescript
// In src/app/api/auth/[...nextauth]/route.ts
export const runtime = 'nodejs'  // This prevents Edge Runtime issues
```

## 📋 Vercel Deployment Checklist

### Before Deploying:
- [ ] Generate secure `NEXTAUTH_SECRET` (32+ characters)
- [ ] Set up production database with connection pooling
- [ ] Test locally with production-like environment
- [ ] Run `npm run diagnose:auth` to check configuration

### In Vercel Dashboard:
- [ ] Add `NEXTAUTH_SECRET` environment variable
- [ ] Add `DATABASE_URL` environment variable  
- [ ] Add `AUTH_TRUST_HOST=true` environment variable
- [ ] Set environment variables for all environments (Production, Preview, Development)
- [ ] Enable Vercel System Environment Variables

### After Deploying:
- [ ] Test authentication flow on deployed URL
- [ ] Check `/api/health` endpoint returns healthy status
- [ ] Verify database connectivity from Vercel
- [ ] Test with both production and preview deployments

## 🔍 Vercel-Specific Debugging

### Check Vercel Logs
```bash
# Install Vercel CLI
npm i -g vercel

# View function logs
vercel logs your-project-name

# View real-time logs
vercel logs your-project-name --follow
```

### Debug Endpoints on Vercel
```bash
# Check health status
curl https://your-app.vercel.app/api/health

# Check auth debug (only works if NEXTAUTH_DEBUG=true)
curl https://your-app.vercel.app/api/debug/auth
```

### Environment Variable Check
```bash
# In a Vercel function, log environment
console.log({
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
  NEXTAUTH_SECRET: !!process.env.NEXTAUTH_SECRET,
  DATABASE_URL: !!process.env.DATABASE_URL
})
```

## 🗄️ Database Recommendations for Vercel

### Best Options:
1. **Vercel Postgres** - Native integration, automatic connection pooling
2. **PlanetScale** - Serverless MySQL with excellent Vercel integration
3. **Supabase** - PostgreSQL with built-in connection pooling
4. **Neon** - Serverless PostgreSQL designed for Vercel

### Connection Pooling:
```bash
# Example with connection pooling
DATABASE_URL="postgresql://user:pass@host:5432/db?pgbouncer=true&connection_limit=1"
```

## 🚨 Common Vercel Errors & Solutions

| Error | Solution |
|-------|----------|
| "Provider type credentials not supported" | Add `AUTH_TRUST_HOST=true` and `NEXTAUTH_SECRET` |
| "Database connection timeout" | Use connection pooling or serverless database |
| "NEXTAUTH_URL not defined" | Don't set it - Vercel handles this automatically |
| "Edge Runtime not supported" | Already fixed with `runtime = 'nodejs'` |
| "Environment variables not found" | Check they're set in Vercel dashboard for correct environment |

## 📞 Getting Help

If you're still having issues:

1. **Check Vercel Function Logs** - Most authentication errors appear here
2. **Verify Environment Variables** - Use Vercel CLI or dashboard to confirm
3. **Test Database Connection** - Use Vercel's Edge Functions to test connectivity
4. **Enable Debug Mode** - Temporarily set `NEXTAUTH_DEBUG=true`
5. **Check Vercel Status** - Ensure no ongoing Vercel platform issues

## 🎯 Success Indicators

Your deployment is working when:
- ✅ Login page loads without errors
- ✅ `/api/health` returns status 200
- ✅ Authentication redirects work properly
- ✅ Dashboard loads after successful login
- ✅ No authentication errors in Vercel function logs

Happy deploying! 🚀