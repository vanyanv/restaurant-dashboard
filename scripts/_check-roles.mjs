import { PrismaClient } from "../src/generated/prisma/client/index.js"
const prisma = new PrismaClient()
const users = await prisma.user.findMany({
  where: { email: { in: ["chris@chrisneddys.com", "vardan@chrisneddys.com", "demo@restaurantos.com"] } },
  select: { id: true, email: true, role: true, name: true },
  orderBy: { email: "asc" },
})
console.log("MATCHED:", JSON.stringify(users, null, 2))
const allDev = await prisma.user.findMany({ where: { role: "DEVELOPER" }, select: { email: true, name: true } })
console.log("ALL DEVELOPERs:", JSON.stringify(allDev))
await prisma.$disconnect()
