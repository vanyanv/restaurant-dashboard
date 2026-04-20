import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Strip sslmode from the connection string. SSL is configured explicitly via
// `ssl: true` below, and leaving `sslmode=` in the URL makes pg-connection-string
// emit a deprecation warning on every boot.
const stripSslMode = (raw: string): string => {
  try {
    const url = new URL(raw)
    url.searchParams.delete('sslmode')
    return url.toString()
  } catch {
    return raw
  }
}

const createPrismaClient = () => {
  const adapter = new PrismaPg({
    connectionString: stripSslMode(process.env.DATABASE_URL!),
    ssl: true,
  })

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
