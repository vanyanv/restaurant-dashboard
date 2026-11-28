import {
  CONNECTIONS,
  CONNECTION_GROUPS,
  KEY_NAME_PATTERN,
  allKeys,
  githubOnlyKeyNames,
  isNeverShownKey,
  isPlatformKey,
  type Connection,
  type ConnectionGroupId,
  type ConnectionIcon,
  type KeyDef,
} from "@/lib/counter/connections"
import { STACK, type StackGroup } from "@/lib/counter/stack"
import { classify, guardSection, type StreamedSections } from "@/lib/counter/adapters/types"
import type { SectionData } from "@/lib/counter/section-data"
import { keysAccessFor, type KeysAccess, type KeysOffReason } from "@/lib/developer/platform-access"
import {
  listVercelEnv,
  type VercelEnvResult,
  type VercelEnvTarget,
  type VercelEnvType,
} from "@/lib/developer/vercel-env"

/**
 * Developer portal: the map of connections, the stack, the keys and the steps
 * for a new computer.
 *
 * Developer-global, not tenant data, and it runs no database query at all:
 * everything here comes from the list in `connections.ts`, from
 * `package.json`, from which names are set on the running server, and from
 * one call to Vercel for the names it holds.
 *
 * It takes the caller's `accountId` for one purpose, which is not filtering:
 * the keys are the whole platform's, so only the one account named by
 * `DEVELOPER_PORTAL_ACCOUNT_ID` may be shown values
 * (`src/lib/developer/platform-access.ts`), and the keys section says whether
 * that is this caller. The page reads the id from the session and passes it
 * in, like every adapter. The id and the setting never appear in a section.
 *
 * ## No value ever leaves this module
 *
 * A section says whether a name is set, never what it is set to: no value, no
 * first characters, no length, no hash. The one place a value is read is
 * `src/lib/counter/actions/developer.ts`, behind a password.
 * `tests/lib/counter/adapters/developer.test.ts` sets a recognisable value on
 * every name and fails if any section's JSON contains it.
 */

type Env = Record<string, string | undefined>

/**
 * The name a failed section here carries as its `retryAction`. A name, not a
 * function, so the section can cross to the browser; the page's client gets
 * it back through `onRetry` and answers it by asking the server for the page
 * again (`router.refresh()`), since every section is rebuilt on each request.
 */
export const DEVELOPER_RETRY = "retryDeveloper"

/** Set, and not just to spaces. */
function isSet(env: Env, name: string): boolean {
  const v = env[name]
  return typeof v === "string" && v.trim() !== ""
}

/** Set under its own name or under another name that does the same job. */
function isCovered(env: Env, key: KeyDef): boolean {
  return isSet(env, key.name) || (key.alt ?? []).some((a) => isSet(env, a))
}

/* ── Map ──────────────────────────────────────────────────────────────── */

/**
 * - `ready`: every key the running server needs for this connection is set.
 * - `missing`: at least one is not. `missingKeys` names them.
 * - `elsewhere`: the server needs no key for it (only the timed jobs on
 *   GitHub hold its key, or it has none).
 */
export type ConnectionStatus = "ready" | "missing" | "elsewhere"

export interface DeveloperMapConnection {
  id: string
  name: string
  /** Two or three words, e.g. "orders in". */
  does: string
  flow: "in" | "out" | "both"
  icon: ConnectionIcon
  status: ConnectionStatus
  /** Key names the server needs and does not have. Empty unless `status` is `missing`. */
  missingKeys: string[]
}

export interface DeveloperMapGroup {
  id: ConnectionGroupId
  label: string
  connections: DeveloperMapConnection[]
}

export interface DeveloperMap {
  /** Groups in display order. Only groups with something on the map. */
  groups: DeveloperMapGroup[]
}

function connectionOf(c: Connection, env: Env): DeveloperMapConnection {
  const needed = c.keys.filter((k) => (k.where ?? "server") === "server")
  const missingKeys = needed.filter((k) => !isCovered(env, k)).map((k) => k.name)
  const status: ConnectionStatus =
    needed.length === 0 ? "elsewhere" : missingKeys.length > 0 ? "missing" : "ready"
  return { id: c.id, name: c.name, does: c.does, flow: c.flow, icon: c.icon, status, missingKeys }
}

function mapOf(env: Env): DeveloperMap {
  return {
    groups: CONNECTION_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      connections: CONNECTIONS.filter((c) => c.onMap && c.group === g.id).map((c) =>
        connectionOf(c, env),
      ),
    })).filter((g) => g.connections.length > 0),
  }
}

/* ── Summary ──────────────────────────────────────────────────────────── */

export interface DeveloperSummary {
  /** Connections drawn on the map. */
  onMap: number
  /** Of those, how many have every key the server needs. */
  ready: number
  /** Of those, how many the server holds no key for (their key lives on GitHub). */
  elsewhere: number
  /** Names of the connections missing a key, in map order. */
  missing: string[]
}

function summaryOf(env: Env): DeveloperSummary {
  const all = mapOf(env).groups.flatMap((g) => g.connections)
  return {
    onMap: all.length,
    ready: all.filter((c) => c.status === "ready").length,
    elsewhere: all.filter((c) => c.status === "elsewhere").length,
    missing: all.filter((c) => c.status === "missing").map((c) => c.name),
  }
}

/* ── Stack ────────────────────────────────────────────────────────────── */

export interface DeveloperStack {
  groups: StackGroup[]
}

/* ── Keys ─────────────────────────────────────────────────────────────── */

/**
 * - `ok`: set on this running server.
 * - `missing`: the server needs it and it is not set.
 * - `unused`: Vercel holds it and nothing in the code reads it.
 * - `githubOnly`: only the timed jobs on GitHub read it; not expected here.
 * - `notNeededHere`: not set, and that is fine (a switch left off, a setting
 *   with a default, a second name for a key that is set, a developer tool).
 */
export type KeyState = "ok" | "missing" | "unused" | "githubOnly" | "notNeededHere"

export interface DeveloperKeyRow {
  name: string
  /** The connection it belongs to. Null when the list does not know the name (`unused`). */
  connectionName: string | null
  icon: ConnectionIcon
  /** False only for values that are plainly not secret. Unknown names are treated as secret. */
  secret: boolean
  /** Set in the environment of this running server. */
  setHere: boolean
  /** What Vercel holds under this name. Null when it holds nothing, or could not be asked. */
  vercel: null | { type: VercelEnvType; targets: VercelEnvTarget[] }
  /** A GitHub workflow reads it as a secret. */
  github: boolean
  state: KeyState
  /**
   * The value can be shown after unlocking: it is set here, it is ours, it is
   * not one of the never-shown keys, and values are available to this caller
   * at all (`DeveloperKeys.valuesAvailable`).
   */
  canReveal: boolean
  /**
   * Present, and true, only on the keys that sign sessions and passes
   * (`NEVER_SHOWN_KEY_NAMES`). Their value is never shown or copied to
   * anyone; someone setting up their own computer makes their own.
   */
  neverShown?: true
  /** A plain sentence for someone setting this on their own computer. */
  localNote?: string
}

/** Whether Vercel answered. When it did not, every row's `vercel` is null and that means "unknown". */
export type DeveloperVercelStatus =
  | { ok: true }
  | { ok: false; reason: "not set up" | "couldn't reach Vercel" }

export interface DeveloperKeys {
  /** One row per name: the list's keys in list order, then names only Vercel knows, A to Z. */
  rows: DeveloperKeyRow[]
  counts: Record<KeyState, number>
  vercelStatus: DeveloperVercelStatus
  /**
   * Whether this caller can be shown values at all. False means unlocking,
   * showing and downloading are all refused whatever the password, and every
   * row's `canReveal` is false.
   */
  valuesAvailable: boolean
  /**
   * Present only when `valuesAvailable` is false.
   *
   * - `notSetUp`: `DEVELOPER_PORTAL_ACCOUNT_ID` is not set on this server, so
   *   showing values is switched off for everyone until it is.
   * - `otherAccount`: it names a different account from the caller's.
   */
  valuesOffReason?: KeysOffReason
}

function keysOf(env: Env, vercel: VercelEnvResult, access: KeysAccess): DeveloperKeys {
  const held = new Map((vercel.ok ? vercel.rows : []).map((r) => [r.name, r]))
  const vercelOf = (name: string): DeveloperKeyRow["vercel"] => {
    const r = held.get(name)
    return r ? { type: r.type, targets: r.targets } : null
  }

  const rows: DeveloperKeyRow[] = allKeys().map((k) => {
    const setHere = isSet(env, k.name)
    const state: KeyState = setHere
      ? "ok"
      : k.where === "github"
        ? "githubOnly"
        : k.where === "server" && !isCovered(env, k)
          ? "missing"
          : "notNeededHere"
    return {
      name: k.name,
      connectionName: k.connection.name,
      icon: k.connection.icon,
      secret: k.secret,
      setHere,
      vercel: vercelOf(k.name),
      github: k.github === true,
      state,
      canReveal: setHere && access.available && !isNeverShownKey(k.name),
      ...(isNeverShownKey(k.name) ? { neverShown: true as const } : {}),
      ...(k.localNote ? { localNote: k.localNote } : {}),
    }
  })

  const known = new Set(rows.map((r) => r.name))
  for (const r of held.values()) {
    // Names the platform sets are not ours to manage, and a name of any other
    // shape is never looked up, so neither is listed.
    if (known.has(r.name) || isPlatformKey(r.name) || !KEY_NAME_PATTERN.test(r.name)) continue
    const setHere = isSet(env, r.name)
    rows.push({
      name: r.name,
      connectionName: null,
      icon: "key",
      secret: true,
      setHere,
      vercel: { type: r.type, targets: r.targets },
      github: false,
      state: "unused",
      canReveal: setHere && access.available,
    })
  }

  const counts: Record<KeyState, number> = {
    ok: 0,
    missing: 0,
    unused: 0,
    githubOnly: 0,
    notNeededHere: 0,
  }
  for (const r of rows) counts[r.state]++

  return {
    rows,
    counts,
    vercelStatus: vercel.ok ? { ok: true } : { ok: false, reason: vercel.reason },
    valuesAvailable: access.available,
    ...(access.available ? {} : { valuesOffReason: access.reason }),
  }
}

/* ── New computer ─────────────────────────────────────────────────────── */

export interface DeveloperSetupStep {
  /** The command to type, exactly. */
  command: string
  /** One plain line on what it does. */
  explain: string
}

export interface DeveloperSetup {
  /** In the order to run them. */
  steps: DeveloperSetupStep[]
  /** Key names Vercel cannot hand over: only the timed jobs on GitHub hold them. */
  byHand: string[]
  /** The one command that must never be run, and why. */
  warning: string
}

function setupOf(): DeveloperSetup {
  return {
    steps: [
      { command: "npm ci", explain: "Installs the exact packages the live site runs on." },
      {
        command: "vercel link",
        explain: "Ties this folder to the project on Vercel. Asks you to sign in the first time.",
      },
      {
        command: "vercel env pull .env.local",
        explain:
          "Downloads the keys into .env.local. Vercel leaves out the ones marked Sensitive; copy those from the Keys tab.",
      },
      {
        command: "npx prisma generate",
        explain: "Builds the database client from the schema. Changes nothing in the database.",
      },
      { command: "npm run dev", explain: "Starts the site at http://localhost:3000." },
    ],
    byHand: githubOnlyKeyNames(),
    warning:
      "Never run prisma migrate dev. It would reset the live database: .env.local points at the real one.",
  }
}

/* ── Sections ─────────────────────────────────────────────────────────── */

export interface DeveloperSections {
  summary: SectionData<DeveloperSummary>
  map: SectionData<DeveloperMap>
  stack: SectionData<DeveloperStack>
  keys: SectionData<DeveloperKeys>
  setup: SectionData<DeveloperSetup>
}

/**
 * Each section is its own promise, so the map, the stack and the steps paint
 * at once and only the keys wait for Vercel (three seconds at most).
 *
 * `accountId` is the signed-in developer's account, read from the session by
 * the page. It decides one thing: whether values can be shown to them.
 */
export function getDeveloperSectionPromises(who: {
  accountId: string
}): StreamedSections<DeveloperSections> {
  const env: Env = process.env
  const access = keysAccessFor(who.accountId, env)
  const s = <T,>(load: () => T | Promise<T>) =>
    guardSection(classify(load, { retryAction: DEVELOPER_RETRY }), DEVELOPER_RETRY)
  return {
    summary: s(() => summaryOf(env)),
    map: s(() => mapOf(env)),
    stack: s((): DeveloperStack => ({ groups: [...STACK] })),
    keys: s(async () => keysOf(env, await listVercelEnv(env), access)),
    setup: s(setupOf),
  }
}
