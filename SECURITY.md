# Security Guidelines

## Production Security Checklist

### Environment Variables
- [x] `NEXTAUTH_SECRET` is required for JWT session signing.
- [x] `DATABASE_URL` must use the production Postgres endpoint with SSL.
- [x] `CRON_SECRET` is required for cron-only endpoints.
- [x] `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` enable shared rate limiting and cache invalidation.
- [x] External service secrets are read from environment variables only.

### Authentication And Tenant Isolation
- [x] Dashboard pages are protected by NextAuth middleware.
- [x] API routes and server actions must derive `accountId` from the session or a validated cron path.
- [x] Tenant data access is scoped by `Account.id` / `session.user.accountId`.
- [x] Invoice mutations validate both invoice ownership and target store ownership.
- [x] Passwords are hashed with bcrypt.
- [x] JWT sessions expire after 8 hours.

### Cron And Monitoring
- [x] Cron endpoints require `Authorization: Bearer $CRON_SECRET`.
- [x] Monitoring summary requires the developer role and returns 404 for other users.
- [x] Operational error details are logged server-side; client responses should stay generic unless the route is developer-only.

### Network And Browser Security
- [x] HTTPS is enforced by Vercel.
- [x] Security headers include `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS, and a restrictive `Permissions-Policy`.
- [x] `next/image` remote optimization is disabled for arbitrary remote hosts.
- [x] User-supplied avatar URLs render through the browser, not through the Next image optimizer.
- [x] Private invoice PDF responses use `no-store` cache headers.

### Dependency Status
- [x] Direct vulnerable packages were upgraded: `next`, `prisma`, `@prisma/client`, `next-auth`, and `@google/genai`.
- [x] Vulnerable transitive packages are pinned with `overrides` where compatible.
- [ ] `npm audit --omit=dev` still reports the `next-auth` 4.x `uuid` advisory. No patched `next-auth` 4.x exists as of April 30, 2026; the audit fix suggests a breaking downgrade to v3. Track migration to Auth.js / next-auth v5 when feasible.

## Operational Practices

1. Run `npm audit --omit=dev` before production releases.
2. Keep `CRON_SECRET` rotated and shared only with the configured cron runner.
3. Use Vercel environment variables for all production secrets.
4. Keep database backups and restore procedures tested.
5. Treat every new Prisma query as tenant-scoped by default.
