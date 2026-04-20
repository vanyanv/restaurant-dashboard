// scripts/test-cost-derive.ts
// Fixture-based correctness test for deriveCostFromLineItem.

import { deriveCostFromLineItem } from "../src/lib/ingredient-cost"

type Case = {
  name: string
  line: Parameters<typeof deriveCostFromLineItem>[0]
  recipeUnit: string
  conv?: Parameters<typeof deriveCostFromLineItem>[2]
  expect: number | null
}

const cases: Case[] = [
  {
    name: "butter CS pack=30 size=1 LB $98.95 → $/lb",
    line: { quantity: 1, unit: "CS", packSize: 30, unitSize: 1, unitSizeUom: "LB", unitPrice: 98.95, extendedPrice: 98.95 },
    recipeUnit: "lb",
    expect: 98.95 / 30,
  },
  {
    name: "tomato CS pack=125 size=1 LB $84.77 → $/lb",
    line: { quantity: 1, unit: "CS", packSize: 125, unitSize: 1, unitSizeUom: "LB", unitPrice: 84.77, extendedPrice: 84.77 },
    recipeUnit: "lb",
    expect: 84.77 / 125,
  },
  {
    name: "lettuce CS pack=1 size=12 CT $26.89 → $/each",
    line: { quantity: 1, unit: "CS", packSize: 1, unitSize: 12, unitSizeUom: "CT", unitPrice: 26.89, extendedPrice: 26.89 },
    recipeUnit: "each",
    expect: 26.89 / 12,
  },
  {
    name: "ground beef LB 478.92 qty $4.37 → $/lb (no pack/size)",
    line: { quantity: 478.92, unit: "LB", packSize: null, unitSize: null, unitSizeUom: null, unitPrice: 4.37, extendedPrice: 478.92 * 4.37 },
    recipeUnit: "lb",
    expect: 4.37,
  },
  {
    name: "butter $/lb → $/oz (standard LB↔OZ conversion)",
    line: { quantity: 1, unit: "CS", packSize: 30, unitSize: 1, unitSizeUom: "LB", unitPrice: 98.95, extendedPrice: 98.95 },
    recipeUnit: "oz",
    expect: 98.95 / 30 / 16,
  },
  {
    name: "5 gal mayo CS → $/fl oz",
    line: { quantity: 1, unit: "CS", packSize: 1, unitSize: 5, unitSizeUom: "GAL", unitPrice: 60, extendedPrice: 60 },
    recipeUnit: "fl oz",
    expect: 60 / (5 * 128),
  },
  {
    name: "cross-category returns null (lb → fl oz)",
    line: { quantity: 1, unit: "CS", packSize: 30, unitSize: 1, unitSizeUom: "LB", unitPrice: 98.95, extendedPrice: 98.95 },
    recipeUnit: "fl oz",
    expect: null,
  },
  {
    name: "per-ingredient conv: 1 head = 15 leaves → $/each (leaf)",
    line: { quantity: 1, unit: "CS", packSize: 1, unitSize: 12, unitSizeUom: "CT", unitPrice: 26.89, extendedPrice: 26.89 },
    recipeUnit: "leaf",
    conv: { conversionFactor: 15, fromUnit: "each", toUnit: "leaf" },
    expect: (26.89 / 12) / 15,
  },
]

let pass = 0
let fail = 0
for (const c of cases) {
  const got = deriveCostFromLineItem(c.line, c.recipeUnit, c.conv)
  const ok =
    (c.expect == null && got == null) ||
    (c.expect != null && got != null && Math.abs(got - c.expect) < 1e-6)
  if (ok) pass++
  else fail++
  const gotStr = got == null ? "null" : `$${got.toFixed(6)}`
  const expStr = c.expect == null ? "null" : `$${c.expect.toFixed(6)}`
  console.log(`${ok ? "✓" : "✗"}  ${c.name}`)
  if (!ok) console.log(`    expected ${expStr}, got ${gotStr}`)
}
console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
