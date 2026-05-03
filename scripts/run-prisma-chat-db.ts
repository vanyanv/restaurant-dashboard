// Run a Prisma CLI command against DATABASE_URL2 (the chat / vector branch)
// without exporting DATABASE_URL2 into the parent shell.
//
// Usage:
//   npx tsx scripts/run-prisma-chat-db.ts db execute --file path/to.sql
//   npx tsx scripts/run-prisma-chat-db.ts migrate diff --from-config-datasource --to-schema prisma/schema.prisma
//
// Reads .env.local for DATABASE_URL2, then spawns `npx prisma <args>` with
// DATABASE_URL set to that value in the child process's env only.

import fs from "fs"
import path from "path"
import { spawn } from "child_process"

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {}
  const envPath = path.resolve(process.cwd(), ".env.local")
  if (!fs.existsSync(envPath)) return out
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "")
    out[k] = v
  }
  return out
}

const envFromFile = loadEnvLocal()
const url2 = envFromFile.DATABASE_URL2
if (!url2) {
  console.error("DATABASE_URL2 not found in .env.local")
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error("usage: run-prisma-chat-db <prisma cli args>")
  process.exit(1)
}

const child = spawn("npx", ["prisma", ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...envFromFile,
    DATABASE_URL: url2,
  },
})

child.on("exit", (code) => process.exit(code ?? 0))
