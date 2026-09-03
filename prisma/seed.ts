import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

// SSL for a real host, never for localhost — a local Postgres does not speak
// TLS. Same rule `src/lib/prisma.ts` states in full; kept in step by hand
// because a seed script must not import the app's singleton client.
const localHost = (raw: string): boolean => {
  try {
    const h = new URL(raw).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]'
  } catch {
    return false
  }
}
const adapter = new PrismaPg({ connectionString: databaseUrl, ssl: !localHost(databaseUrl) })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Starting database seed...')

  // Default Account — every seeded user/store/etc. lives under this single
  // tenant. Matches the id used by the manual migration backfill so the
  // local dev DB and any production-restored DB end up with the same row.
  const defaultAccount = await prisma.account.upsert({
    where: { id: 'acc_default_chrisneddys' },
    update: {},
    create: {
      id: 'acc_default_chrisneddys',
      name: "Chris Neddy's"
    }
  })

  // Create demo owner user
  const hashedPassword = await bcrypt.hash('demo123', 10)

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@restaurantos.com' },
    update: {},
    create: {
      email: 'demo@restaurantos.com',
      password: hashedPassword,
      name: 'Mario Rossi',
      role: 'OWNER',
      accountId: defaultAccount.id
    }
  })

  console.log('✅ Created demo user:', demoUser.email)

  // Get all existing owner accounts to create demo data for them
  const allOwners = await prisma.user.findMany({
    where: { role: 'OWNER' }
  })

  console.log(`📋 Found ${allOwners.length} owner accounts to seed data for`)

  let totalStoresCreated = 0

  for (let ownerIndex = 0; ownerIndex < allOwners.length; ownerIndex++) {
    const owner = allOwners[ownerIndex]
    const ownerNumber = ownerIndex + 1

    console.log(`\n🏪 Creating demo data for ${owner.name} (${owner.email})...`)

    const storeNames = [
      { name: `${owner.name.split(' ')[0]}'s Downtown Location`, address: `${100 + ownerNumber * 100} Main Street, Downtown, CA 9021${ownerNumber}`, phone: `(555) ${ownerNumber}23-4567` },
      { name: `${owner.name.split(' ')[0]}'s Beach Location`, address: `${400 + ownerNumber * 100} Ocean Drive, Santa Monica, CA 9040${ownerNumber}`, phone: `(555) ${ownerNumber}87-6543` }
    ]

    const ownerStores = []

    for (let storeIndex = 0; storeIndex < storeNames.length; storeIndex++) {
      const storeData = storeNames[storeIndex]
      const storeId = `store-${owner.id}-${storeIndex + 1}`

      const store = await prisma.store.upsert({
        where: { id: storeId },
        update: {},
        create: {
          id: storeId,
          name: storeData.name,
          address: storeData.address,
          phone: storeData.phone,
          ownerId: owner.id,
          accountId: owner.accountId
        }
      })

      ownerStores.push(store)
      totalStoresCreated++
    }

    console.log(`  ✅ Created ${ownerStores.length} stores for ${owner.name}`)
  }

  console.log('\n🎉 Database seeding completed!')
  console.log('\n📊 Summary:')
  console.log(`👥 Seeded data for ${allOwners.length} owner accounts`)
  console.log(`🏪 Created ${totalStoresCreated} total stores`)
  console.log('\n📋 Demo Accounts:')
  console.log('👑 Owner: demo@restaurantos.com / demo123')

  console.log('\n🏪 All Owner Stores:')
  for (const owner of allOwners) {
    const ownerStores = await prisma.store.findMany({
      where: { ownerId: owner.id }
    })
    console.log(`\n👑 ${owner.name} (${owner.email}):`)
    for (const store of ownerStores) {
      console.log(`  📍 ${store.name} - ${store.address}`)
    }
  }
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
