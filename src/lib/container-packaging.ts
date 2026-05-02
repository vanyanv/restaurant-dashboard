export type FulfillmentBucket = "DELIVERY" | "PICKUP" | "DINE_IN" | "UNKNOWN" | "OTHER"

export type ContainerGroup = "medium_6x6" | "large_9x6" | "one_compartment"

export type PackingScenario = "smallest-fit" | "medium-preferred" | "large-conservative"

export type PackingUnits = {
  burgers: number
  fries: number
  loadedFries: number
  grilledCheese: number
}

export type ContainerCounts = Record<ContainerGroup, number>

export type OrderPackInput = {
  fulfillmentMode: string | null
  items: Array<{
    name: string
    quantity: number
    subItems: Array<{
      name: string
      quantity: number
      subHeader: string | null
    }>
  }>
}

export type BasketClassification = {
  units: PackingUnits
  rawSignature: string
  normalizedSignature: string
  unclassifiedItems: Array<{ name: string; quantity: number; reason: string }>
  ignoredItems: Array<{ name: string; quantity: number; reason: string }>
  ambiguousNotes: string[]
}

export const PACKAGING_SCENARIO: PackingScenario = "smallest-fit"

export const PACKING_SCENARIOS: PackingScenario[] = [
  "smallest-fit",
  "medium-preferred",
  "large-conservative",
]

export const CONTAINER_GROUP_LABELS: Record<ContainerGroup, string> = {
  medium_6x6: "medium 6x6",
  large_9x6: "9x6",
  one_compartment: "1-compartment",
}

export const CONTAINER_GROUP_CANONICALS: Record<ContainerGroup, string[]> = {
  medium_6x6: [
    "container foam 6x6x3 medium hinged square",
    "container foam 6x6x3 medium white bagged",
  ],
  large_9x6: ["container foam hinged white 9x6.5x2.5"],
  one_compartment: ["container foam 1-compartment bagged"],
}

export const CONTAINER_CANDIDATE_NAMES = [
  ...CONTAINER_GROUP_CANONICALS.medium_6x6,
  ...CONTAINER_GROUP_CANONICALS.large_9x6,
  ...CONTAINER_GROUP_CANONICALS.one_compartment,
]

const EMPTY_COUNTS: ContainerCounts = {
  medium_6x6: 0,
  large_9x6: 0,
  one_compartment: 0,
}

export function normalizeFulfillmentMode(raw: string | null | undefined): FulfillmentBucket {
  if (!raw) return "UNKNOWN"
  const s = raw.toUpperCase()
  if (s.includes("DINE_IN") || s.includes("DINE IN")) return "DINE_IN"
  if (s.includes("PICKUP") || s.includes("TAKEOUT") || s.includes("TAKE_OUT")) return "PICKUP"
  if (s.includes("DELIVERY")) return "DELIVERY"
  return "OTHER"
}

export function isTakeawayFulfillmentMode(raw: string | null | undefined): boolean {
  const bucket = normalizeFulfillmentMode(raw)
  return bucket === "DELIVERY" || bucket === "PICKUP"
}

export function emptyContainerCounts(): ContainerCounts {
  return { ...EMPTY_COUNTS }
}

export function addContainerCounts(target: ContainerCounts, source: ContainerCounts, multiplier = 1): void {
  for (const group of Object.keys(EMPTY_COUNTS) as ContainerGroup[]) {
    target[group] += source[group] * multiplier
  }
}

export function formatQty(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function formatContainerCounts(counts: ContainerCounts): string {
  return (Object.keys(CONTAINER_GROUP_LABELS) as ContainerGroup[])
    .map((group) => `${CONTAINER_GROUP_LABELS[group]} ${formatQty(counts[group])}`)
    .join(", ")
}

export function costForCounts(counts: ContainerCounts, groupCosts: Record<ContainerGroup, number | null>): number | null {
  let total = 0
  for (const group of Object.keys(counts) as ContainerGroup[]) {
    const unitCost = groupCosts[group]
    if (unitCost == null && counts[group] > 0) return null
    total += counts[group] * (unitCost ?? 0)
  }
  return total
}

export function containerGroupForCanonical(name: string): ContainerGroup | null {
  for (const [group, names] of Object.entries(CONTAINER_GROUP_CANONICALS) as Array<[ContainerGroup, string[]]>) {
    if (names.includes(name)) return group
  }
  return null
}

export function invoiceEachUnits(line: {
  quantity: number
  unit: string | null
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
}): number {
  const unit = (line.unit ?? "").toUpperCase()
  const unitSizeUom = (line.unitSizeUom ?? "").toUpperCase()
  if (unit === "CS" && unitSizeUom === "CT" && line.unitSize != null) {
    return line.quantity * (line.packSize ?? 1) * line.unitSize
  }
  if (unit === "CT" || unit === "EA" || unit === "EACH") return line.quantity
  return line.quantity
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

function emptyPackingUnits(): PackingUnits {
  return { burgers: 0, fries: 0, loadedFries: 0, grilledCheese: 0 }
}

function addUnits(target: PackingUnits, source: PackingUnits, multiplier = 1): void {
  target.burgers += source.burgers * multiplier
  target.fries += source.fries * multiplier
  target.loadedFries += source.loadedFries * multiplier
  target.grilledCheese += source.grilledCheese * multiplier
}

function normalizeItemName(name: string): string {
  return normalizeKey(name)
    .replace(/[’]/g, "'")
    .replace(/[&]/g, "and")
    .replace(/[-]/g, " ")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isLoadedUpgrade(subItems: Array<{ name: string; quantity: number; subHeader: string | null }>): boolean {
  return subItems.some((sub) => {
    const name = normalizeItemName(sub.name)
    return name === "loaded" || name.startsWith("loaded ")
  })
}

function classifyKnownItem(name: string): { units: PackingUnits; ignoredReason?: string; ambiguousReason?: string } {
  const n = normalizeItemName(name)
  const zero = emptyPackingUnits()

  if (
    n.includes("soda") ||
    n.includes("coca cola") ||
    n.includes("diet coke") ||
    n.includes("coke zero") ||
    n.includes("sprite") ||
    n.includes("fanta") ||
    n.includes("hi c") ||
    n.includes("minute maid") ||
    n.includes("lemonade") ||
    n.includes("shake") ||
    n.includes("water") ||
    n.includes("mexican coke")
  ) {
    return { units: zero, ignoredReason: "drink; not a foam container candidate" }
  }

  if (
    n.includes("sauce") ||
    n.includes("chili") ||
    n.includes("pickle") ||
    n === "add extra cheese" ||
    n === "extra cheese" ||
    n === "cheese" ||
    n === "1 slice of cheese" ||
    n === "single patty"
  ) {
    return { units: zero, ignoredReason: "side/modifier; not modeled as one of the audited foam containers" }
  }

  if (n === "1 slider combo" || n === "1 slider and fries" || n === "signature slider fries and drink combo") {
    return { units: { burgers: 1, fries: 1, loadedFries: 0, grilledCheese: 0 } }
  }

  if (n === "2 slider combo" || n === "2 sliders and fries" || n === "combo 3" || n === "2 triples and fries") {
    return { units: { burgers: 2, fries: 1, loadedFries: 0, grilledCheese: 0 } }
  }

  if (n === "the family box") {
    return { units: { burgers: 4, fries: 2, loadedFries: 0, grilledCheese: 0 } }
  }

  if (n === "the triple pack") {
    return {
      units: { burgers: 3, fries: 1, loadedFries: 0, grilledCheese: 0 },
      ambiguousReason: "3 burgers plus fries exceeds the stated single-container 9x6 capacity",
    }
  }

  if (n === "2 grilled cheeses and fries") {
    return { units: { burgers: 0, fries: 1, loadedFries: 0, grilledCheese: 2 } }
  }

  if (n.includes("loaded fries") || n.includes("cheese fries")) {
    return { units: { burgers: 0, fries: 0, loadedFries: 1, grilledCheese: 0 } }
  }

  if (n.includes("straight cut fries")) {
    return { units: { burgers: 0, fries: 1, loadedFries: 0, grilledCheese: 0 } }
  }

  if (n === "grilled cheese") {
    return { units: { burgers: 0, fries: 0, loadedFries: 0, grilledCheese: 1 } }
  }

  if (n.includes("slider") || n === "the quad" || n === "the reverse bun") {
    return { units: { burgers: 1, fries: 0, loadedFries: 0, grilledCheese: 0 } }
  }

  if (n === "combo 0" || n === "value combo") {
    return { units: zero, ambiguousReason: "combo name is not mapped to a known burger/fries composition" }
  }

  return { units: zero, ambiguousReason: "unclassified menu item" }
}

export function classifyBasket(order: OrderPackInput): BasketClassification {
  const units = emptyPackingUnits()
  const unclassifiedItems: BasketClassification["unclassifiedItems"] = []
  const ignoredItems: BasketClassification["ignoredItems"] = []
  const ambiguousNotes: string[] = []
  const rawParts: string[] = []

  for (const item of order.items) {
    const quantity = item.quantity ?? 0
    const hasLoadedUpgrade = isLoadedUpgrade(item.subItems)
    rawParts.push(`${formatQty(quantity)} ${item.name}${hasLoadedUpgrade ? " (Loaded upgrade)" : ""}`)
    const classified = classifyKnownItem(item.name)
    const itemUnits = { ...classified.units }

    if (hasLoadedUpgrade && itemUnits.fries > 0) {
      itemUnits.loadedFries += itemUnits.fries
      itemUnits.fries = 0
      ambiguousNotes.push(`${item.name}: loaded fries modifier changes fry packing assumption`)
    }

    addUnits(units, itemUnits, quantity)

    if (classified.ignoredReason) {
      ignoredItems.push({ name: item.name, quantity, reason: classified.ignoredReason })
    }
    if (classified.ambiguousReason) {
      unclassifiedItems.push({ name: item.name, quantity, reason: classified.ambiguousReason })
    }
  }

  const normalizedParts = [
    units.burgers ? `${formatQty(units.burgers)} burger` : null,
    units.fries ? `${formatQty(units.fries)} fries` : null,
    units.loadedFries ? `${formatQty(units.loadedFries)} loaded fries` : null,
    units.grilledCheese ? `${formatQty(units.grilledCheese)} grilled cheese` : null,
  ].filter(Boolean)

  return {
    units,
    rawSignature: rawParts.sort().join(" + ") || "(empty)",
    normalizedSignature: normalizedParts.join(" + ") || "(no modeled container units)",
    unclassifiedItems,
    ignoredItems,
    ambiguousNotes,
  }
}

function packBurgerAndFries(units: PackingUnits, scenario: PackingScenario): ContainerCounts {
  const counts = emptyContainerCounts()
  let burgers = units.burgers
  let fries = units.fries

  while (burgers >= 2 && fries >= 1) {
    counts.large_9x6 += 1
    burgers -= 2
    fries -= 1
  }

  while (burgers >= 1 && fries >= 1) {
    counts.medium_6x6 += 1
    burgers -= 1
    fries -= 1
  }

  while (burgers >= 3) {
    counts.large_9x6 += 1
    burgers -= Math.min(4, burgers)
  }

  while (burgers >= 2) {
    counts.medium_6x6 += 1
    burgers -= 2
  }

  if (burgers >= 1) {
    if (scenario === "medium-preferred") counts.medium_6x6 += 1
    else counts.one_compartment += 1
  }

  counts.one_compartment += fries
  return counts
}

function packLoadedFries(loadedFries: number, scenario: PackingScenario): ContainerCounts {
  const counts = emptyContainerCounts()
  let remaining = loadedFries

  while (remaining >= 2) {
    counts.medium_6x6 += 1
    remaining -= 2
  }

  if (remaining > 0) {
    if (scenario === "smallest-fit") counts.one_compartment += 1
    else counts.medium_6x6 += 1
  }

  return counts
}

function packGrilledCheese(grilledCheese: number): ContainerCounts {
  return {
    medium_6x6: 0,
    large_9x6: 0,
    one_compartment: Math.ceil(grilledCheese / 2),
  }
}

export function packBasket(units: PackingUnits, scenario: PackingScenario): ContainerCounts {
  const counts = emptyContainerCounts()
  addContainerCounts(counts, packBurgerAndFries(units, scenario))
  addContainerCounts(counts, packLoadedFries(units.loadedFries, scenario))
  addContainerCounts(counts, packGrilledCheese(units.grilledCheese))

  if (scenario === "large-conservative" && units.burgers >= 2 && units.fries + units.loadedFries > 0) {
    const mediumMealsToPromote = Math.min(counts.medium_6x6, Math.ceil(units.fries + units.loadedFries))
    counts.medium_6x6 -= mediumMealsToPromote
    counts.large_9x6 += mediumMealsToPromote
  }

  return counts
}

export function packOrder(order: OrderPackInput, scenario: PackingScenario = PACKAGING_SCENARIO): {
  classification: BasketClassification
  counts: ContainerCounts
} {
  const classification = classifyBasket(order)
  return {
    classification,
    counts: packBasket(classification.units, scenario),
  }
}
