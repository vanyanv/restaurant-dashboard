import pkg from "../../../package.json"

/**
 * What the app is built with, grouped for the developer page.
 *
 * Versions are read from `package.json` when the app is built, so the list
 * cannot go stale: bump a package and this follows. A few rows have no
 * package (the database, the design system, the Python models) and carry a
 * hand-written name with no version.
 */

export type StackGroupId = "framework" | "data" | "interface" | "signin" | "ai" | "testing"

/** Every icon id the stack uses, for the interface to map exhaustively. */
export const STACK_ICONS = [
  "next",
  "react",
  "typescript",
  "postgres",
  "prisma",
  "redis",
  "bucket",
  "counter",
  "tailwind",
  "icons",
  "signin",
  "lock",
  "openai",
  "gemini",
  "python",
  "vitest",
  "playwright",
  "testing",
] as const

export type StackIcon = (typeof STACK_ICONS)[number]

export interface StackRow {
  name: string
  /** `major.minor` (or just the major when that is all `package.json` pins). Null when there is no package. */
  version: string | null
  icon: StackIcon
}

export interface StackGroup {
  id: StackGroupId
  label: string
  rows: StackRow[]
}

const VERSIONS: Record<string, string | undefined> = {
  ...(pkg.devDependencies as Record<string, string>),
  ...(pkg.dependencies as Record<string, string>),
}

/**
 * `^16.4.6` → `16.4`, `~4.1.11` → `4.1`, `^4` → `4`, `0.1.0-beta.17` → `0.1`.
 * Null for anything that is not a version number (a tag, a URL, a missing package).
 */
export function shortVersion(range: string | undefined): string | null {
  if (!range) return null
  const m = /^[\^~>=<v\s]*(\d+)(?:\.(\d+))?/.exec(range)
  if (!m) return null
  return m[2] === undefined ? m[1] : `${m[1]}.${m[2]}`
}

/** A row whose version comes from `package.json`. */
const dep = (name: string, packageName: string, icon: StackIcon): StackRow => ({
  name,
  version: shortVersion(VERSIONS[packageName]),
  icon,
})

/** A row with no package behind it. */
const own = (name: string, icon: StackIcon): StackRow => ({ name, version: null, icon })

/** The packages behind the versioned rows, exported so a test can check each one resolves. */
export const STACK_PACKAGES = [
  "next",
  "react",
  "typescript",
  "prisma",
  "@upstash/redis",
  "@aws-sdk/client-s3",
  "tailwindcss",
  "lucide-react",
  "next-auth",
  "bcryptjs",
  "openai",
  "ai",
  "@google/genai",
  "vitest",
  "@playwright/test",
  "@testing-library/react",
] as const

export const STACK: readonly StackGroup[] = [
  {
    id: "framework",
    label: "Framework",
    rows: [
      dep("Next.js", "next", "next"),
      dep("React", "react", "react"),
      dep("TypeScript", "typescript", "typescript"),
    ],
  },
  {
    id: "data",
    label: "Data",
    rows: [
      own("Postgres on Neon", "postgres"),
      dep("Prisma", "prisma", "prisma"),
      dep("Upstash Redis", "@upstash/redis", "redis"),
      dep("Cloudflare R2 (S3 client)", "@aws-sdk/client-s3", "bucket"),
    ],
  },
  {
    id: "interface",
    label: "Interface",
    rows: [
      own("Counter design system", "counter"),
      dep("Tailwind CSS", "tailwindcss", "tailwind"),
      dep("Lucide icons", "lucide-react", "icons"),
    ],
  },
  {
    id: "signin",
    label: "Sign-in",
    rows: [
      dep("NextAuth", "next-auth", "signin"),
      dep("bcryptjs", "bcryptjs", "lock"),
    ],
  },
  {
    id: "ai",
    label: "AI",
    rows: [
      dep("OpenAI SDK", "openai", "openai"),
      dep("Vercel AI SDK", "ai", "openai"),
      dep("Google Gemini SDK", "@google/genai", "gemini"),
      own("Python forecast models in ml/", "python"),
    ],
  },
  {
    id: "testing",
    label: "Testing",
    rows: [
      dep("Vitest", "vitest", "vitest"),
      dep("Playwright", "@playwright/test", "playwright"),
      dep("Testing Library", "@testing-library/react", "testing"),
    ],
  },
]
