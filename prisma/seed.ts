import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting database seed...')

  // Create demo owner user
  const hashedPassword = await bcrypt.hash('demo123', 10)
  
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@restaurantos.com' },
    update: {},
    create: {
      email: 'demo@restaurantos.com',
      password: hashedPassword,
      name: 'Mario Rossi',
      role: 'OWNER'
    }
  })

  console.log('✅ Created demo user:', demoUser.email)

  // Get all existing owner accounts to create demo data for them
  const allOwners = await prisma.user.findMany({
    where: { role: 'OWNER' }
  })

  console.log(`📋 Found ${allOwners.length} owner accounts to seed data for`)

  // Create demo manager user
  const managerPassword = await bcrypt.hash('manager123', 10)
  
  const demoManager = await prisma.user.upsert({
    where: { email: 'manager@restaurantos.com' },
    update: {},
    create: {
      email: 'manager@restaurantos.com',
      password: managerPassword,
      name: 'Sofia Martinez',
      role: 'MANAGER'
    }
  })

  console.log('✅ Created demo manager:', demoManager.email)

  // Create stores and data for each owner
  let totalStoresCreated = 0
  let totalReportsCreated = 0

  for (let ownerIndex = 0; ownerIndex < allOwners.length; ownerIndex++) {
    const owner = allOwners[ownerIndex]
    const ownerNumber = ownerIndex + 1
    
    console.log(`\n🏪 Creating demo data for ${owner.name} (${owner.email})...`)

    // Create demo stores for this owner
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
          ownerId: owner.id
        }
      })
      
      ownerStores.push(store)
      totalStoresCreated++
    }

    console.log(`  ✅ Created ${ownerStores.length} stores for ${owner.name}`)

    // Assign manager to stores for this owner
    for (const store of ownerStores) {
      await prisma.storeManager.upsert({
        where: {
          storeId_managerId: {
            storeId: store.id,
            managerId: demoManager.id
          }
        },
        update: {},
        create: {
          storeId: store.id,
          managerId: demoManager.id
        }
      })
    }

    console.log(`  ✅ Assigned manager to all stores for ${owner.name}`)

    // Create prep tasks for this owner's stores
    const prepTasks = [
      { taskName: 'Prep pizza dough', description: 'Prepare fresh dough for the day', shift: 'MORNING' },
      { taskName: 'Slice vegetables', description: 'Cut tomatoes, onions, peppers', shift: 'MORNING' },
      { taskName: 'Prepare sauce', description: 'Make fresh marinara and alfredo sauce', shift: 'MORNING' },
      { taskName: 'Stock beverages', description: 'Restock all drink coolers', shift: 'MORNING' },
      { taskName: 'Clean ovens', description: 'Deep clean pizza ovens', shift: 'EVENING' },
      { taskName: 'Inventory check', description: 'Count remaining ingredients', shift: 'EVENING' },
      { taskName: 'Prep for tomorrow', description: 'Setup for next day service', shift: 'EVENING' }
    ]

    for (const store of ownerStores) {
      for (let i = 0; i < prepTasks.length; i++) {
        const task = prepTasks[i]
        await prisma.prepTask.upsert({
          where: { id: `${store.id}-task-${i}` },
          update: {},
          create: {
            id: `${store.id}-task-${i}`,
            storeId: store.id,
            taskName: task.taskName,
            description: task.description,
            shift: task.shift as 'MORNING' | 'EVENING',
            orderIndex: i
          }
        })
      }
    }

    console.log(`  ✅ Created prep tasks for ${owner.name}'s stores`)

    // Generate realistic daily reports for the past 30 days for this owner's stores
    const today = new Date()
    let ownerReportsCreated = 0

      for (let i = 0; i < 30; i++) {
        const reportDate = new Date(today)
        reportDate.setDate(today.getDate() - i)
        
        // Skip some random days to make it realistic
        if (Math.random() < 0.1) continue

        const dayOfWeek = reportDate.getDay()
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
        const isMonday = dayOfWeek === 1
        
        // Weekend and Monday are typically busier for restaurants
        const businessFactor = isWeekend ? 1.4 : isMonday ? 1.2 : 1.0
        
        // Base amounts with realistic variation (slightly different for each owner)
        const baseRevenue = (700 + ownerNumber * 100) + Math.random() * 400
        const revenue = Math.round(baseRevenue * businessFactor)
        
        const startingAmount = 200 + Math.random() * 100
        const endingAmount = startingAmount + revenue - (Math.random() * 50)
        const tips = Math.round(revenue * (0.12 + Math.random() * 0.08)) // 12-20% tips
        
        const cashRatio = 0.2 + Math.random() * 0.3 // 20-50% cash
        const cashSales = Math.round(revenue * cashRatio)
        const cardSales = revenue - cashSales
        
        const customerCount = Math.round((revenue / 22) + Math.random() * 10) // ~$22 per customer
        
        // Prep completion - generally high but with some variation
        const morningPrep = 85 + Math.round(Math.random() * 15)
        const eveningPrep = 80 + Math.round(Math.random() * 20)

        // Create reports for both shifts sometimes
        const shifts = Math.random() < 0.3 ? ['MORNING', 'EVENING'] : ['BOTH']
        
        for (const store of ownerStores) {
          for (const shift of shifts) {
            const adjustedRevenue = shift === 'MORNING' ? Math.round(revenue * 0.4) : 
                                   shift === 'EVENING' ? Math.round(revenue * 0.6) : revenue
            const adjustedTips = shift === 'MORNING' ? Math.round(tips * 0.4) : 
                                shift === 'EVENING' ? Math.round(tips * 0.6) : tips
            const adjustedCustomers = shift === 'MORNING' ? Math.round(customerCount * 0.4) : 
                                     shift === 'EVENING' ? Math.round(customerCount * 0.6) : customerCount

            const reportData = {
              storeId: store.id,
              date: reportDate,
              shift: shift as 'MORNING' | 'EVENING' | 'BOTH',
              startingAmount: Math.round(startingAmount),
              endingAmount: Math.round(endingAmount),
              totalSales: adjustedRevenue,
              cashSales: Math.round(adjustedRevenue * cashRatio),
              cardSales: Math.round(adjustedRevenue * (1 - cashRatio)),
              tipCount: adjustedTips,
              morningPrepCompleted: morningPrep,
              eveningPrepCompleted: eveningPrep,
              customerCount: adjustedCustomers,
              managerId: demoManager.id,
              notes: getRandomNote(dayOfWeek, isWeekend, owner.name)
            }

            try {
              await prisma.dailyReport.create({
                data: reportData
              })
              ownerReportsCreated++
            } catch (error) {
              // Skip if duplicate (same store, date, shift combination)
              continue
            }
          }
        }
      }

      console.log(`  ✅ Created ${ownerReportsCreated} reports for ${owner.name}`)
      totalReportsCreated += ownerReportsCreated
    }

  console.log('\n🎉 Database seeding completed!')
  console.log('\n📊 Summary:')
  console.log(`👥 Seeded data for ${allOwners.length} owner accounts`)
  console.log(`🏪 Created ${totalStoresCreated} total stores`)
  console.log(`📋 Generated ${totalReportsCreated} total reports over 30 days`)
  console.log('\n📋 Demo Accounts:')
  console.log('👑 Owner: demo@restaurantos.com / demo123')
  console.log('👤 Manager: manager@restaurantos.com / manager123')
  
  // List all owners and their stores
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

function getRandomNote(dayOfWeek: number, isWeekend: boolean, ownerName: string): string | null {
  const firstName = ownerName.split(' ')[0]
  const notes = [
    null, // No note sometimes
    "Busy evening rush, great tips!",
    "Delivery orders were high today",
    "Had some equipment issues with oven #2",
    `Customer complimented ${firstName}'s signature dish`,
    "Rainy day, fewer walk-ins",
    "Local event brought extra customers",
    "Staff worked efficiently today",
    "Ran low on key ingredients, need to reorder",
    "Perfect weather, busy outdoor seating"
  ]

  if (isWeekend) {
    const weekendNotes = [
      "Weekend rush was intense!",
      "Great family dining crowd",
      "Lots of takeout orders",
      "Had to call in extra help",
      `${firstName}'s weekend special was popular`
    ]
    notes.push(...weekendNotes)
  }

  if (dayOfWeek === 1) { // Monday
    notes.push("Slow Monday as expected")
    notes.push("Good prep day for the week")
    notes.push(`${firstName} reviewed weekly inventory`)
  }

  return notes[Math.floor(Math.random() * notes.length)]
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })