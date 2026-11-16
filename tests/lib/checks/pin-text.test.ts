import { describe, expect, it } from "vitest"
import { formatUsPhone, howToLink, howToTextBody, normalizeUsPhone, pinTextBody, smsHref } from "@/lib/checks/text"

describe("normalizeUsPhone", () => {
  it("accepts the ways an owner types a number", () => {
    for (const raw of ["818-555-0123", "(818) 555-0123", "818.555.0123", "8185550123", "+1 818 555 0123", "1-818-555-0123"]) {
      expect(normalizeUsPhone(raw)).toBe("+18185550123")
    }
  })
  it("refuses numbers that can't be US mobiles", () => {
    for (const raw of ["555-0123", "81855501234", "018-555-0123", "818-155-0123", "+44 20 7946 0958", "+65 6555 0123", "0065 6555 0123", "abc"]) {
      expect(normalizeUsPhone(raw)).toBeNull()
    }
  })
})

describe("formatUsPhone", () => {
  it("formats a stored number and passes anything else through", () => {
    expect(formatUsPhone("+18185550123")).toBe("(818) 555-0123")
    expect(formatUsPhone("weird")).toBe("weird")
  })
})

describe("pin text", () => {
  const body = pinTextBody({ firstName: "Ana", storeName: "Glendale", pin: "4829", link: "https://checks.example.com/abc" })
  it("carries the PIN and link in English and Spanish", () => {
    expect(body).toContain("Hi Ana, your store checks PIN for Glendale is 4829.")
    expect(body).toContain("Hola Ana, tu PIN para las revisiones de Glendale es 4829.")
    expect(body.match(/https:\/\/checks\.example\.com\/abc/g)).toHaveLength(2)
  })
  it("falls back to the poster when the store has no link yet", () => {
    const noLink = pinTextBody({ firstName: "Ana", storeName: "Glendale", pin: "4829", link: "" })
    expect(noLink).toContain("Scan the QR poster")
    expect(noLink).not.toContain("Open ")
  })
  it("builds an sms: link both iOS and Android open, with the body encoded", () => {
    const href = smsHref("+18185550123", body)
    expect(href.startsWith("sms:+18185550123?&body=")).toBe(true)
    expect(decodeURIComponent(href.split("body=")[1])).toBe(body)
  })
})

describe("how-to text", () => {
  it("links the guide and the check page, never the PIN", () => {
    const body = howToTextBody({ firstName: "Ana", storeName: "Glendale", link: "https://checks.example.com/abc" })
    expect(body).toContain("https://checks.example.com/abc/how")
    expect(body).toContain("Open the checks here: https://checks.example.com/abc")
    expect(body).toContain("Abre las revisiones aquí")
    expect(body).not.toMatch(/\bPIN\b/)
  })
  it("has no guide link while the store has no check link", () => {
    expect(howToLink("")).toBe("")
    expect(howToLink("https://x.test/abc/")).toBe("https://x.test/abc/how")
  })
})
