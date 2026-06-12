// Pins the formatter families being consolidated into lib/format.ts.
// Two distinct money styles exist on purpose:
//  - fmtMoney/fmtSignedMoney (chat artifacts): null-safe, em-dash for missing,
//    U+2212 minus sign, manual "$" prefix
//  - formatCurrency/formatCurrencyWhole (mobile pages): plain Intl currency
//    (ASCII hyphen negatives), 2dp vs 0dp
// fmtPctFromRatio takes a 0-1 ratio; the pre-existing formatPct takes an
// already-scaled percent and adds a sign. Do NOT merge them.

import { describe, it, expect } from "vitest"
import {
  fmtMoney,
  fmtCount,
  fmtPctFromRatio,
  fmtSignedMoney,
  formatCurrency,
  formatCurrencyWhole,
} from "@/lib/format"

describe("fmtMoney", () => {
  it("formats with two decimals and a dollar prefix", () => {
    expect(fmtMoney(1234.5)).toBe("$1,234.50")
  })

  it("returns an em dash for null/undefined/NaN", () => {
    expect(fmtMoney(null)).toBe("—")
    expect(fmtMoney(undefined)).toBe("—")
    expect(fmtMoney(Number.NaN)).toBe("—")
  })

  it("uses U+2212 minus for negatives", () => {
    expect(fmtMoney(-42)).toBe("−$42.00")
  })
})

describe("fmtCount", () => {
  it("rounds and groups", () => {
    expect(fmtCount(1234.6)).toBe("1,235")
  })

  it("returns an em dash for null", () => {
    expect(fmtCount(null)).toBe("—")
  })
})

describe("fmtPctFromRatio", () => {
  it("multiplies a 0-1 ratio by 100 with 1 decimal by default", () => {
    expect(fmtPctFromRatio(0.0834)).toBe("8.3%")
  })

  it("honors the digits param", () => {
    expect(fmtPctFromRatio(0.5, 0)).toBe("50%")
  })

  it("returns an em dash for null", () => {
    expect(fmtPctFromRatio(null)).toBe("—")
  })
})

describe("fmtSignedMoney", () => {
  it("prefixes positives with +", () => {
    expect(fmtSignedMoney(12)).toBe("+$12.00")
  })

  it("renders exact zero unsigned", () => {
    expect(fmtSignedMoney(0)).toBe("$0.00")
  })

  it("uses U+2212 minus for negatives (via fmtMoney)", () => {
    expect(fmtSignedMoney(-12)).toBe("−$12.00")
  })

  it("returns an em dash for null", () => {
    expect(fmtSignedMoney(null)).toBe("—")
  })
})

describe("formatCurrencyWhole", () => {
  it("formats USD with no decimals", () => {
    expect(formatCurrencyWhole(1234.56)).toBe("$1,235")
  })

  it("matches formatCurrency's locale family (en-US grouping)", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56")
    expect(formatCurrencyWhole(1000000)).toBe("$1,000,000")
  })
})
