/**
 * Composer logic — slash shortcuts and the scope a question carries.
 *
 * Both are pure so `<ChatInput>` stays a thin shell: the textarea holds the
 * text, everything that decides what gets sent lives here and is tested.
 */

export interface SlashCommand {
  key: string
  description: string
  /** What the composer is filled with when the shortcut is taken. */
  template: string
}

/** The shortcuts the composer offers. Each one names a question the tool
 * layer answers well, so the menu doubles as a discovery surface for what
 * the analyst can actually reach. */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    key: "/sales",
    description: "daily or weekly net sales",
    template: "How were sales last week?",
  },
  {
    key: "/spend",
    description: "invoice spend by vendor or item",
    template: "What did we spend with each vendor last month?",
  },
  {
    key: "/margin",
    description: "recipe cost and menu margin",
    template: "Which menu items have the lowest margin?",
  },
  {
    key: "/price",
    description: "ingredient prices and vendor comparison",
    template: "Has any ingredient price moved in the last month?",
  },
  {
    key: "/forecast",
    description: "nightly ML forecast with its interval",
    template: "What does next week forecast at?",
  },
]

/**
 * The commands to offer for the current composer text. Only an unfinished
 * shortcut opens the menu: once there is a space, the owner has moved on to
 * writing the question and the menu must get out of the way.
 */
export function matchSlashCommands(input: string): SlashCommand[] {
  if (!input.startsWith("/")) return []
  if (/\s/.test(input)) return []
  const q = input.slice(1).toLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    (c) => c.key.slice(1).toLowerCase().startsWith(q) || c.description.toLowerCase().includes(q),
  )
}

/** Taking a shortcut replaces the whole composer with its template — the
 * typed "/sp" was navigation, not content. */
export function applySlashCommand(_input: string, command: SlashCommand): string {
  return command.template
}

export interface ComposerScope {
  storeName: string | null
  from: string | null
  to: string | null
}

/** The scope as it reads on the composer's chips and in the sent prefix. */
export function formatScopeLabel(scope: ComposerScope): string {
  const parts: string[] = []
  if (scope.storeName) parts.push(scope.storeName)
  if (scope.from && scope.to) parts.push(`${scope.from} to ${scope.to}`)
  return parts.join(" · ")
}

/**
 * Attaches the composer's scope to the outgoing question so the model does
 * not spend a round trip resolving "which store" and "which dates". The
 * prefix is plain text rather than a structured field because every tool
 * already takes storeIds and a date range from the model's reading of the
 * prompt — this just makes the reading unambiguous.
 */
export function buildScopedMessage(text: string, scope: ComposerScope): string {
  const trimmed = text.trim()
  if (!trimmed) return ""
  const label = formatScopeLabel(scope)
  if (!label) return trimmed
  return `(Scope: ${label}) ${trimmed}`
}
