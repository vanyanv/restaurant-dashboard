# Security Guidelines

## Production Security Checklist

### Environment Variables
- [x] NEXTAUTH_SECRET is generated with strong entropy (32+ characters)
- [x] DATABASE_URL uses SSL connection with sslmode=require
- [x] No hardcoded secrets in codebase
- [x] Development debug flags removed (NEXTAUTH_DEBUG)

### Authentication & Authorization
- [x] JWT sessions with secure secret
- [x] Role-based access control (Owner/Manager)
- [x] Protected routes with middleware
- [x] Password hashing with bcrypt
- [x] Session expiration (24 hours)

### Network Security
- [x] HTTPS enforced in production (Vercel default)
- [x] Security headers configured
- [x] CORS properly configured
- [x] No debug endpoints in production

### Database Security
- [x] Parameterized queries via Prisma (SQL injection protection)
- [x] Connection pooling for performance
- [x] Proper error handling without data exposure

### Code Security
- [x] Input validation with Zod schemas
- [x] No console.log statements with sensitive data
- [x] Error messages don't expose system internals
- [x] Dependencies regularly updated

## Recommended Production Practices

1. **Monitor your application**: Set up logging and monitoring
2. **Regular security updates**: Keep dependencies updated
3. **Database backups**: Implement regular backup strategy
4. **Rate limiting**: Consider implementing API rate limiting
5. **SSL certificates**: Ensure proper HTTPS configuration

## Environment Variable Security

Never commit these to version control:
- `NEXTAUTH_SECRET`
- `DATABASE_URL`
- `YELP_API_KEY`

Always use Vercel's environment variable dashboard for production secrets.