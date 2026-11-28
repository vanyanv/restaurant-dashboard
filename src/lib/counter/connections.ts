import "server-only"

/**
 * The one list of connections: every outside service this app talks to and
 * every environment variable the code reads.
 *
 * Pure data and pure helpers. It holds NAMES only and never a value. It is
 * still server-only: the list of every secret's name, and the rules for which
 * may be shown, have no business in a browser bundle. Client code may import
 * its TYPES (`import type { ... }`, erased at build) and nothing else; what a
 * page needs to draw arrives as plain data from `adapters/developer.ts`.
 *
 * `tests/lib/counter/connections.test.ts` keeps it honest: it scans the source
 * for every `process.env` read and the workflows for every `secrets` read and
 * fails, naming the key, when a name is missing here. The check is one way on purpose: the list may
 * hold a name the code does not read yet.
 */

export type ConnectionGroupId =
  | "data"
  | "outside"
  | "mail"
  | "ai"
  | "hosting"
  | "apps"
  | "settings"
  | "tools"

/**
 * Who needs a key to be set.
 *
 * - `server`: the running site cannot use the connection without it. Unset
 *   means the connection is not set up.
 * - `optional`: the running site reads it, and works without it (a default, a
 *   switch, a second name for the same thing).
 * - `github`: only the timed jobs on GitHub read it. Vercel does not hold it.
 * - `tools`: only scripts and tests on a developer's computer read it.
 */
export type KeyWhere = "server" | "optional" | "github" | "tools"

export interface KeyDef {
  /** The environment variable's name, e.g. `DATABASE_URL`. */
  name: string
  /** False only for values that are plainly not secret (URLs, regions, switches). */
  secret: boolean
  /** True when a GitHub workflow reads it as `secrets.NAME`. */
  github?: boolean
  /** Who needs it. Left out means `server`. */
  where?: KeyWhere
  /**
   * Other names that do the same job. When this key is unset and one of
   * these is set, the connection still counts as set up.
   */
  alt?: string[]
  /** A plain sentence written beside the key in an exported `.env.local`. */
  localNote?: string
}

export interface Connection {
  /** Stable id, safe as a React key or an anchor. */
  id: string
  /** The name people know it by. */
  name: string
  group: ConnectionGroupId
  /** Two or three words on what it is for, e.g. "orders in". */
  does: string
  /** Which way data moves between this app and the service. */
  flow: "in" | "out" | "both"
  /** An icon id the interface maps to a drawing. See `CONNECTION_ICONS`. */
  icon: ConnectionIcon
  /** Drawn on the map. False for sign-in, switches and developer tools. */
  onMap: boolean
  keys: KeyDef[]
}

/** Every icon id this list uses, for the interface to map exhaustively. */
export const CONNECTION_ICONS = [
  "database",
  "redis",
  "bucket",
  "orders",
  "labor",
  "events",
  "mailbox",
  "send",
  "openai",
  "gemini",
  "vercel",
  "github",
  "shop",
  "tv",
  "signin",
  "settings",
  "tools",
  "key",
] as const

export type ConnectionIcon = (typeof CONNECTION_ICONS)[number]

export interface ConnectionGroup {
  id: ConnectionGroupId
  label: string
}

/** Groups in the order the page shows them. */
export const CONNECTION_GROUPS: readonly ConnectionGroup[] = [
  { id: "data", label: "Data" },
  { id: "outside", label: "Outside data" },
  { id: "mail", label: "Mail" },
  { id: "ai", label: "AI" },
  { id: "hosting", label: "Hosting and jobs" },
  { id: "apps", label: "Our other apps" },
  { id: "settings", label: "Sign-in and settings" },
  { id: "tools", label: "Dev and test tools" },
]

const opt = (name: string, secret = false): KeyDef => ({ name, secret, where: "optional" })
const tool = (name: string, secret = false): KeyDef => ({ name, secret, where: "tools" })

export const CONNECTIONS: readonly Connection[] = [
  /* ── Data ─────────────────────────────────────────────────────────────── */
  {
    id: "neon",
    name: "Neon Postgres",
    group: "data",
    does: "every figure",
    flow: "both",
    icon: "database",
    onMap: true,
    keys: [
      { name: "DATABASE_URL", secret: true, github: true },
      opt("DATABASE_POOL_MAX"),
      opt("DATABASE_POOL_IDLE_MS"),
      opt("NEON_STORAGE_CAP_BYTES"),
    ],
  },
  {
    id: "upstash",
    name: "Upstash Redis",
    group: "data",
    does: "cache, limits",
    flow: "both",
    icon: "redis",
    onMap: true,
    keys: [
      { name: "UPSTASH_REDIS_REST_URL", secret: false, github: true },
      { name: "UPSTASH_REDIS_REST_TOKEN", secret: true, github: true },
      opt("UPSTASH_DAILY_COMMAND_LIMIT"),
    ],
  },
  {
    id: "r2",
    name: "Cloudflare R2",
    group: "data",
    does: "photos, backups",
    flow: "both",
    icon: "bucket",
    onMap: true,
    keys: [
      { name: "R2_ACCOUNT_ID", secret: true, github: true, alt: ["R2_ENDPOINT"] },
      { name: "R2_ACCESS_KEY_ID", secret: true, github: true },
      { name: "R2_SECRET_ACCESS_KEY", secret: true, github: true },
      { name: "R2_BUCKET_NAME", secret: false, github: true },
      { name: "R2_ENDPOINT", secret: false, github: true, where: "optional" },
      opt("R2_REGION"),
    ],
  },

  /* ── Outside data ─────────────────────────────────────────────────────── */
  {
    id: "otter",
    name: "Otter",
    group: "outside",
    does: "orders in",
    flow: "in",
    icon: "orders",
    onMap: true,
    keys: [
      { name: "OTTER_EMAIL", secret: true, github: true },
      { name: "OTTER_PASSWORD", secret: true, github: true },
      { name: "OTTER_JWT", secret: true, github: true, where: "optional" },
    ],
  },
  {
    id: "harri",
    name: "Harri",
    group: "outside",
    does: "labor in",
    flow: "in",
    icon: "labor",
    onMap: true,
    keys: [
      { name: "HARRI_EMAIL", secret: true, github: true },
      { name: "HARRI_PASSWORD", secret: true, github: true },
      { name: "HARRI_REFRESH_TOKEN", secret: true, github: true },
      { name: "HARRI_COGNITO_CLIENT_ID", secret: true, github: true, where: "optional" },
      { name: "HARRI_COGNITO_USER_POOL_REGION", secret: false, github: true, where: "optional" },
      opt("HARRI_JWT", true),
      opt("HARRI_GH_REPO"),
      tool("HARRI_PROFILE_DIR"),
    ],
  },
  {
    id: "predicthq",
    name: "PredictHQ",
    group: "outside",
    does: "local events",
    flow: "in",
    icon: "events",
    onMap: true,
    keys: [
      { name: "PREDICTHQ_API_TOKEN", secret: true, github: true, where: "github" },
      // A second name the Python job accepts for the same token.
      { name: "PREDICTHQ_TOKEN", secret: true, where: "github" },
      opt("EVENTS_PROVIDER_ENABLED"),
    ],
  },

  /* ── Mail ─────────────────────────────────────────────────────────────── */
  {
    id: "microsoft",
    name: "Microsoft 365 mailbox",
    group: "mail",
    does: "reads bills",
    flow: "in",
    icon: "mailbox",
    onMap: true,
    keys: [
      { name: "MICROSOFT_TENANT_ID", secret: true },
      { name: "MICROSOFT_CLIENT_ID", secret: true },
      { name: "MICROSOFT_CLIENT_SECRET", secret: true },
      { name: "MICROSOFT_MAIL_USER_ID", secret: true },
      opt("INVOICE_ACCOUNT_ID", true),
    ],
  },
  {
    id: "resend",
    name: "Resend",
    group: "mail",
    does: "sends PINs",
    flow: "out",
    icon: "send",
    onMap: true,
    keys: [
      { name: "RESEND_API_KEY", secret: true },
      { name: "CHECKS_EMAIL_FROM", secret: false, alt: ["EMAIL_FROM"] },
      opt("EMAIL_FROM"),
      opt("PRICE_ALERT_EMAIL"),
    ],
  },

  /* ── AI ───────────────────────────────────────────────────────────────── */
  {
    id: "openai",
    name: "OpenAI",
    group: "ai",
    does: "Ask, matching",
    flow: "both",
    icon: "openai",
    onMap: true,
    keys: [
      { name: "OPENAI_API_KEY", secret: true, github: true },
      opt("CHAT_ROUTING_MODEL"),
      opt("CHAT_CLASSIFIER_MODEL"),
      opt("CHAT_TITLE_MODEL"),
      opt("CHAT_REASONING_EFFORT"),
      opt("CHAT_DAILY_BUDGET_USD"),
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    group: "ai",
    does: "reads invoices",
    flow: "both",
    icon: "gemini",
    onMap: true,
    keys: [{ name: "GEMINI_API_KEY", secret: true }],
  },

  /* ── Hosting and jobs ─────────────────────────────────────────────────── */
  {
    id: "vercel",
    name: "Vercel",
    group: "hosting",
    does: "hosting, deploys",
    flow: "both",
    icon: "vercel",
    onMap: true,
    keys: [
      { name: "VERCEL_TOKEN", secret: true, github: true },
      { name: "VERCEL_PROJECT_ID", secret: true, github: true },
      opt("VERCEL_TEAM_ID", true),
    ],
  },
  {
    id: "github",
    name: "GitHub Actions",
    group: "hosting",
    does: "timed jobs",
    flow: "both",
    icon: "github",
    onMap: true,
    keys: [
      { name: "CRON_SECRET", secret: true, github: true },
      { name: "GH_PAT", secret: true, github: true, where: "optional", alt: ["GH_TOKEN"] },
      opt("GH_TOKEN", true),
      { name: "APP_URL", secret: false, github: true, where: "github" },
      { name: "ALERTS_INGEST_URL", secret: true, github: true, where: "github" },
    ],
  },

  /* ── Our other apps ───────────────────────────────────────────────────── */
  {
    id: "shop",
    name: "Shop site",
    group: "apps",
    does: "signed API",
    flow: "both",
    icon: "shop",
    onMap: true,
    keys: [
      { name: "SHOP_API_URL", secret: false },
      { name: "SHOP_INTERNAL_API_SECRET", secret: true },
      { name: "SHOP_ACCOUNT_ID", secret: true },
    ],
  },
  {
    // Tells the TVs the moment a picture changes.
    id: "pusher",
    name: "Pusher",
    group: "apps",
    does: "TV live push",
    flow: "out",
    icon: "tv",
    onMap: true,
    keys: [
      { name: "PUSHER_APP_ID", secret: true },
      { name: "PUSHER_KEY", secret: true },
      { name: "PUSHER_SECRET", secret: true },
      { name: "PUSHER_CLUSTER", secret: false },
    ],
  },

  /* ── Not on the map ───────────────────────────────────────────────────── */
  {
    id: "signin",
    name: "Sign-in",
    group: "settings",
    does: "signs sessions",
    flow: "both",
    icon: "signin",
    onMap: false,
    keys: [
      { name: "NEXTAUTH_SECRET", secret: true },
      {
        name: "NEXTAUTH_URL",
        secret: false,
        localNote: "Use http://localhost:3000 on your own computer",
      },
      opt("CHECKS_SECRET", true),
      // Names the one account whose developers may read key values. Unset
      // means nobody may. See `src/lib/developer/platform-access.ts`.
      opt("DEVELOPER_PORTAL_ACCOUNT_ID"),
    ],
  },
  {
    id: "settings",
    name: "App settings",
    group: "settings",
    does: "feature switches",
    flow: "both",
    icon: "settings",
    onMap: false,
    keys: [
      {
        name: "SERVICE_SHUTDOWN_AT",
        secret: false,
        where: "optional",
        localNote: "Leave this out on your own computer, or every page shows the shutdown notice",
      },
      opt("INGREDIENT_AUTO_MATCH"),
      opt("TRACK_DEVELOPER_PAGE_VIEWS"),
      opt("ML_USE_RECONCILED"),
      opt("CHECKS_BASE_URL"),
      tool("COGS_BACKFILL_STORE_CONCURRENCY"),
      tool("COGS_BACKFILL_DAY_CONCURRENCY"),
    ],
  },
  {
    id: "tools",
    name: "Dev and test tools",
    group: "tools",
    does: "scripts, tests",
    flow: "both",
    icon: "tools",
    onMap: false,
    keys: [
      tool("E2E_BASE_URL"),
      tool("E2E_PORT"),
      tool("E2E_PROD"),
      tool("E2E_USER_EMAIL", true),
      tool("E2E_USER_PASSWORD", true),
      tool("EVAL_BASE_URL"),
      tool("EVAL_COOKIE_NAME"),
      tool("EVAL_SESSION_COOKIE", true),
      tool("PERF_BASE_URL"),
      tool("PERF_CPU"),
      tool("PERF_LOG"),
      tool("PERF_OUT"),
      tool("SHOTS_BASE_URL"),
      tool("SHOTS_EMAIL", true),
      tool("SHOTS_PASSWORD", true),
      tool("ANALYZE"),
      tool("LOG_FILE"),
      tool("PRISMA_TRACE"),
      tool("COUNTER_TODAY"),
      tool("ALLOW_DEMO_SEED"),
      tool("ALLOW_DB_RESET"),
      tool("CHECK_PHOTOS_LOCAL_DIR"),
    ],
  },
]

/**
 * Names the platform sets for us (Node, Next, Vercel, GitHub Actions, the
 * shell). They are not ours to manage and are never offered for copy.
 */
export const PLATFORM_KEY_NAMES: readonly string[] = [
  "NODE_ENV",
  "NODE_OPTIONS",
  "CI",
  "PATH",
  "HOME",
  "TZ",
  "PORT",
  "NEXT_RUNTIME",
  "NEXT_PHASE",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_REGION",
  "VERCEL_DEPLOYMENT_ID",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
  "GITHUB_ACTIONS",
  "GITHUB_RUN_ID",
  "GITHUB_TOKEN",
  "GITHUB_SHA",
  "GITHUB_REPOSITORY",
  "GITHUB_SERVER_URL",
]

/**
 * Whole families the platform owns, matched by how the name starts.
 *
 * `VERCEL_` and `AWS_` are whole families on purpose. Vercel runs the site on
 * AWS and puts its own short-lived cloud credentials in `AWS_*`; it adds new
 * `VERCEL_*` names without notice. The only names of either family that are
 * ours are the ones the list above holds (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`,
 * `VERCEL_TEAM_ID`), and `isPlatformKey` lets the list win.
 */
const PLATFORM_PREFIXES = ["GITHUB_", "RUNNER_", "VERCEL_", "NEXT_PRIVATE_", "TURBO_", "AWS_", "npm_"]

/**
 * Keys whose value is never shown and never written to an exported file, to
 * anyone, unlocked or not.
 *
 * `NEXTAUTH_SECRET` signs every session and the unlock pass itself; whoever
 * holds it can make a session for any user of any account and a pass to go
 * with it, so the gate cannot hand out the key it is locked with.
 * `CHECKS_SECRET` signs the crew pass and falls back to `NEXTAUTH_SECRET`.
 * Someone setting up their own computer makes their own:
 * `openssl rand -base64 32`.
 */
export const NEVER_SHOWN_KEY_NAMES: readonly string[] = ["NEXTAUTH_SECRET", "CHECKS_SECRET"]

/** The only shape of name that is ever looked up or shown. */
export const KEY_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/

/** A key together with the connection it belongs to. */
export interface KnownKey extends KeyDef {
  where: KeyWhere
  connection: Connection
}

const BY_NAME: ReadonlyMap<string, KnownKey> = new Map(
  CONNECTIONS.flatMap((connection) =>
    connection.keys.map(
      (key) => [key.name, { ...key, where: key.where ?? "server", connection }] as const,
    ),
  ),
)

const PLATFORM = new Set(PLATFORM_KEY_NAMES)
const NEVER_SHOWN = new Set(NEVER_SHOWN_KEY_NAMES)

/** True for a key whose value is never shown or exported. See `NEVER_SHOWN_KEY_NAMES`. */
export function isNeverShownKey(name: string): boolean {
  return typeof name === "string" && NEVER_SHOWN.has(name)
}

/** The key and its connection, or null when the list does not know the name. */
export function findKey(name: string): KnownKey | null {
  return BY_NAME.get(name) ?? null
}

/** Every key name in the list, in list order. */
export function allKeyNames(): string[] {
  return [...BY_NAME.keys()]
}

/** Every key with its connection, in list order. */
export function allKeys(): KnownKey[] {
  return [...BY_NAME.values()]
}

/** True when the platform sets this name and it is not ours to manage. */
export function isPlatformKey(name: string): boolean {
  if (BY_NAME.has(name)) return false
  return PLATFORM.has(name) || PLATFORM_PREFIXES.some((p) => name.startsWith(p))
}

/** Connections of one group, in list order. */
export function connectionsIn(group: ConnectionGroupId): Connection[] {
  return CONNECTIONS.filter((c) => c.group === group)
}

/** Names only the timed jobs on GitHub read. Vercel cannot hand these over. */
export function githubOnlyKeyNames(): string[] {
  return allKeys()
    .filter((k) => k.where === "github")
    .map((k) => k.name)
}
