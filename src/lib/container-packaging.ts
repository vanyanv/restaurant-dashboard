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

export type CostAwarePackingAlternative = {
  label: string
  counts: ContainerCounts
  cost: number | null
  missingCostGroups: ContainerGroup[]
}

export type CostAwarePackingResult = {
  counts: ContainerCounts
  cost: number | null
  chosenAlternative: string
  fallback: boolean
  fallbackScenario: PackingScenario
  fallbackReason: string | null
  missingCostGroups: ContainerGroup[]
  consideredAlternatives: CostAwarePackingAlternative[]
}

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
export const PACKAGING_COST_AWARE_SCENARIO = "cost-aware"

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

function cloneContainerCounts(counts: ContainerCounts): ContainerCounts {
  return { ...counts }
}

function missingCostGroupsForCounts(
  counts: ContainerCounts,
  groupCosts: Record<ContainerGroup, number | null>
): ContainerGroup[] {
  return (Object.keys(counts) as ContainerGroup[]).filter(
    (group) => counts[group] > 0 && groupCosts[group] == null
  )
}

function containerCountsKey(counts: ContainerCounts): string {
  return (Object.keys(EMPTY_COUNTS) as ContainerGroup[]).map((group) => `${group}:${counts[group]}`).join("|")
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

function addAlternative(
  alternatives: Array<{ label: string; counts: ContainerCounts }>,
  seen: Set<string>,
  label: string,
  counts: ContainerCounts
): void {
  const key = containerCountsKey(counts)
  if (seen.has(key)) return
  seen.add(key)
  alternatives.push({ label, counts })
}

function makeRuleCounts(input: {
  loadedSliderPairs: number
  loadedSliderContainer: "large_9x6" | "medium_plus_one"
  sliderFryPairs: number
  sliderFryContainer: "large_plus_one" | "two_one_compartment"
  remainder: PackingUnits
  remainderScenario: PackingScenario
}): ContainerCounts {
  const counts = emptyContainerCounts()

  if (input.loadedSliderContainer === "large_9x6") {
    counts.large_9x6 += input.loadedSliderPairs
  } else {
    counts.medium_6x6 += input.loadedSliderPairs
    counts.one_compartment += input.loadedSliderPairs
  }

  if (input.sliderFryContainer === "large_plus_one") {
    counts.large_9x6 += input.sliderFryPairs
    counts.one_compartment += input.sliderFryPairs
  } else {
    counts.one_compartment += input.sliderFryPairs * 2
  }

  addContainerCounts(counts, packBasket(input.remainder, input.remainderScenario))
  return counts
}

function costAwareAlternatives(units: PackingUnits): Array<{ label: string; counts: ContainerCounts }> {
  const alternatives: Array<{ label: string; counts: ContainerCounts }> = []
  const seen = new Set<string>()
  const isExactLoadedSliderRule =
    units.loadedFries > 0 &&
    units.burgers === units.loadedFries * 2 &&
    units.fries === 0 &&
    units.grilledCheese === 0
  const isExactSliderFryRule =
    units.burgers > 0 &&
    units.burgers % 2 === 0 &&
    units.fries === units.burgers &&
    units.loadedFries === 0 &&
    units.grilledCheese === 0
  const isOwnerConfirmedSingleBurger =
    units.burgers === 1 &&
    units.fries === 0 &&
    units.loadedFries === 0 &&
    units.grilledCheese === 0

  if (isOwnerConfirmedSingleBurger) {
    addAlternative(alternatives, seen, "owner-confirmed single burger as 1-compartment", packBasket(units, "smallest-fit"))
  } else if (!isExactLoadedSliderRule && !isExactSliderFryRule) {
    for (const scenario of PACKING_SCENARIOS) {
      addAlternative(alternatives, seen, scenario, packBasket(units, scenario))
    }
  }

  // Triple Pack (3 burgers + 1 fries) overflows the 9x6 capacity. The default
  // packer pairs 2B+1F into a 9x6 and leaves a stray burger, but two mediums
  // (one holds 2 burgers, the other holds 1 burger + 1 fries) is also valid
  // and often cheaper. Add it so cost-aware selection can pick it.
  const isTriplePackBasket =
    units.burgers === 3 &&
    units.fries === 1 &&
    units.loadedFries === 0 &&
    units.grilledCheese === 0
  if (isTriplePackBasket) {
    addAlternative(alternatives, seen, "triple pack as 2 medium 6x6", {
      medium_6x6: 2,
      large_9x6: 0,
      one_compartment: 0,
    })
  }

  // Multiple 1 Slider Combos can be packed as one burger + fries per medium
  // 6x6. The generic smallest-fit path groups 2B+1F into a 9x6 and leaves
  // stray fries, which can be more expensive than individual combo boxes.
  const isExactSingleSliderComboBasket =
    Number.isInteger(units.burgers) &&
    units.burgers >= 2 &&
    units.fries === units.burgers &&
    units.loadedFries === 0 &&
    units.grilledCheese === 0
  if (isExactSingleSliderComboBasket) {
    addAlternative(alternatives, seen, `${formatQty(units.burgers)}x(1 slider + fries) as medium 6x6`, {
      medium_6x6: units.burgers,
      large_9x6: 0,
      one_compartment: 0,
    })
  }

  const maxLoadedSliderPairs = Math.min(Math.floor(units.burgers / 2), units.loadedFries)
  const loadedSliderPairOptions = isExactLoadedSliderRule
    ? [units.loadedFries]
    : Array.from({ length: maxLoadedSliderPairs + 1 }, (_, i) => i)
  for (const loadedSliderPairs of loadedSliderPairOptions) {
    const afterLoaded = {
      burgers: units.burgers - loadedSliderPairs * 2,
      fries: units.fries,
      loadedFries: units.loadedFries - loadedSliderPairs,
      grilledCheese: units.grilledCheese,
    }
    const maxSliderFryPairs = Math.min(Math.floor(afterLoaded.burgers / 2), Math.floor(afterLoaded.fries / 2))
    const sliderFryPairOptions = isExactSliderFryRule
      ? [units.burgers / 2]
      : Array.from({ length: maxSliderFryPairs + 1 }, (_, i) => i)

    for (const sliderFryPairs of sliderFryPairOptions) {
      const remainder = {
        burgers: afterLoaded.burgers - sliderFryPairs * 2,
        fries: afterLoaded.fries - sliderFryPairs * 2,
        loadedFries: afterLoaded.loadedFries,
        grilledCheese: afterLoaded.grilledCheese,
      }

      for (const loadedSliderContainer of ["large_9x6", "medium_plus_one"] as const) {
        for (const sliderFryContainer of ["large_plus_one", "two_one_compartment"] as const) {
          for (const remainderScenario of PACKING_SCENARIOS) {
            const labels: string[] = []
            if (loadedSliderPairs > 0) {
              labels.push(
                `${loadedSliderPairs}x(2 sliders + loaded fries) ${
                  loadedSliderContainer === "large_9x6" ? "as 9x6" : "as medium 6x6 + 1-compartment"
                }`
              )
            }
            if (sliderFryPairs > 0) {
              labels.push(
                `${sliderFryPairs}x(2 sliders + 2 fries) ${
                  sliderFryContainer === "large_plus_one"
                    ? "as 9x6 + 1-compartment"
                    : "as 2 x 1-compartment"
                }`
              )
            }
            if (labels.length === 0) continue

            addAlternative(
              alternatives,
              seen,
              `${labels.join("; ")}; remainder ${remainderScenario}`,
              makeRuleCounts({
                loadedSliderPairs,
                loadedSliderContainer,
                sliderFryPairs,
                sliderFryContainer,
                remainder,
                remainderScenario,
              })
            )
          }
        }
      }
    }
  }

  return alternatives
}

export function packBasketCostAware(
  units: PackingUnits,
  groupCosts: Record<ContainerGroup, number | null>,
  fallbackScenario: PackingScenario = PACKAGING_SCENARIO
): CostAwarePackingResult {
  const fallbackCounts = packBasket(units, fallbackScenario)
  const alternatives = costAwareAlternatives(units)
  const consideredAlternatives = alternatives.map((alternative) => ({
    ...alternative,
    counts: cloneContainerCounts(alternative.counts),
    cost: costForCounts(alternative.counts, groupCosts),
    missingCostGroups: missingCostGroupsForCounts(alternative.counts, groupCosts),
  }))
  const requiredMissingCostGroups = [
    ...new Set(consideredAlternatives.flatMap((alternative) => alternative.missingCostGroups)),
  ] as ContainerGroup[]
  const fallbackCost = costForCounts(fallbackCounts, groupCosts)

  if (requiredMissingCostGroups.length > 0) {
    return {
      counts: fallbackCounts,
      cost: fallbackCost,
      chosenAlternative: fallbackScenario,
      fallback: true,
      fallbackScenario,
      fallbackReason: "missing container group cost",
      missingCostGroups: requiredMissingCostGroups,
      consideredAlternatives,
    }
  }

  let best = consideredAlternatives.find((alternative) => alternative.label === fallbackScenario) ?? consideredAlternatives[0]
  if (!best) {
    best = {
      label: fallbackScenario,
      counts: fallbackCounts,
      cost: fallbackCost,
      missingCostGroups: [],
    }
  }

  for (const alternative of consideredAlternatives) {
    if (alternative.cost == null || best.cost == null) continue
    if (alternative.cost < best.cost - 0.000001) best = alternative
  }

  return {
    counts: cloneContainerCounts(best.counts),
    cost: best.cost,
    chosenAlternative: best.label,
    fallback: false,
    fallbackScenario,
    fallbackReason: null,
    missingCostGroups: [],
    consideredAlternatives,
  }
}

export function packOrderCostAware(
  order: OrderPackInput,
  groupCosts: Record<ContainerGroup, number | null>,
  fallbackScenario: PackingScenario = PACKAGING_SCENARIO
): {
  classification: BasketClassification
  packing: CostAwarePackingResult
  counts: ContainerCounts
} {
  const classification = classifyBasket(order)
  const packing = packBasketCostAware(classification.units, groupCosts, fallbackScenario)
  return {
    classification,
    packing,
    counts: packing.counts,
  }
}
