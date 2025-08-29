# Restaurant Dashboard

A comprehensive restaurant management dashboard built with Next.js 15, featuring role-based authentication, analytics, store management, and daily reporting.

## Features

- **Role-Based Authentication**: Owner and Manager access levels
- **Multi-Store Management**: Handle multiple restaurant locations
- **Daily Reporting System**: Track sales, prep tasks, and operations  
- **Analytics Dashboard**: Revenue trends, performance metrics
- **Yelp Integration**: Sync reviews and ratings
- **Responsive Design**: Works on desktop, tablet, and mobile

## Tech Stack

- **Framework**: Next.js 15.5.2 with App Router
- **Authentication**: NextAuth.js v4 with JWT sessions
- **Database**: PostgreSQL with Prisma ORM
- **Styling**: Tailwind CSS v4 with shadcn/ui components
- **Charts**: Recharts for analytics visualization
- **Deployment**: Optimized for Vercel

## Getting Started

### Prerequisites

- Node.js 18+ 
- PostgreSQL database (we recommend [Neon](https://neon.tech))
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd restaurant-dashboard
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Update `.env.local` with your values:
   ```bash
   DATABASE_URL="your-postgresql-connection-string"
   NEXTAUTH_SECRET="your-nextauth-secret"
   # NEXTAUTH_URL is not needed for Vercel deployment
   ```

4. **Set up the database**
   ```bash
   npm run db:reset
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

Visit [http://localhost:3000](http://localhost:3000) to see the application.

### Demo Accounts

After seeding, you can use these accounts:

- **Owner**: `demo@restaurantos.com` / `demo123`
- **Manager**: `manager@restaurantos.com` / `manager123`

## Production Deployment

### Deploy to Vercel

1. **Connect your repository to Vercel**
   - Visit [vercel.com](https://vercel.com)
   - Import your GitHub repository
   - Vercel will auto-detect Next.js configuration

2. **Configure Environment Variables**
   
   In your Vercel dashboard, add these environment variables:
   
   ```bash
   DATABASE_URL=your-production-database-url
   NEXTAUTH_SECRET=your-production-secret
   YELP_API_KEY=your-yelp-api-key (optional)
   ```
   
   **Important**: Do NOT set `NEXTAUTH_URL` on Vercel - it's configured automatically.

3. **Generate a secure NextAuth secret**
   ```bash
   openssl rand -base64 32
   ```

4. **Deploy**
   - Push to your main branch
   - Vercel will automatically build and deploy

### Database Setup for Production

1. **Create a production database** (recommend [Neon](https://neon.tech))
2. **Run database migration**
   ```bash
   npx prisma db push
   ```
3. **Seed production data**
   ```bash
   npm run db:seed
   ```

### Health Check

Your deployment includes a health check endpoint at `/api/health` that monitors:
- Database connectivity
- Authentication configuration
- System status

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production  
- `npm run start` - Start production server
- `npm run db:seed` - Seed database with demo data
- `npm run db:reset` - Reset and reseed database

## Project Structure

```
src/
├── app/                    # Next.js 15 app directory
│   ├── api/               # API routes
│   ├── dashboard/         # Owner dashboard pages
│   ├── manager/           # Manager dashboard pages  
│   └── login/             # Authentication
├── components/            # Reusable UI components
├── lib/                   # Utilities and configurations
└── middleware.ts          # Authentication middleware

prisma/
├── schema.prisma          # Database schema
└── seed.ts               # Database seeding
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Security

- JWT-based authentication with secure session management
- Environment variable validation
- CORS protection and security headers
- Input validation with Zod schemas
- SQL injection protection via Prisma

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
