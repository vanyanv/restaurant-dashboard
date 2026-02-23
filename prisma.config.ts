import dotenv from "dotenv"
import { defineConfig } from "prisma/config"

dotenv.config({ path: ".env.local" })

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
})
