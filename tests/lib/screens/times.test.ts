import { describe, expect, it } from "vitest"
import { EVERY_DAY, activeTime, inWindow, sniffImage, storeOffsetMinutes, windowWords } from "@/lib/screens/core"
import { playerHtml } from "@/lib/screens/player-html"
import { qrRows, pairLink } from "@/lib/screens/pair-link"

const at = (h: number, m = 0) => h * 60 + m
const LUNCH = { days: EVERY_DAY, start: at(11), end: at(15) }
const LATE = { days: 1 << 5, start: at(22), end: at(4) } // Friday night
const WEEKEND = { days: 0b1000001, start: 0, end: 0 }

describe("windows of the week", () => {
  it("covers its start and stops at its end", () => {
    expect(inWindow(LUNCH, 2, at(10, 59))).toBe(false)
    expect(inWindow(LUNCH, 2, at(11))).toBe(true)
    expect(inWindow(LUNCH, 2, at(14, 59))).toBe(true)
    expect(inWindow(LUNCH, 2, at(15))).toBe(false)
  })
  it("runs past midnight and belongs to the day it started", () => {
    expect(inWindow(LATE, 5, at(23))).toBe(true)
    expect(inWindow(LATE, 6, at(3, 59))).toBe(true)
    expect(inWindow(LATE, 6, at(4))).toBe(false)
    expect(inWindow(LATE, 5, at(2))).toBe(false)
    expect(inWindow(LATE, 6, at(23))).toBe(false)
  })
  it("a Saturday night window wraps into Sunday", () => {
    expect(inWindow({ days: 1 << 6, start: at(22), end: at(4) }, 0, at(1))).toBe(true)
  })
  it("the same minute at both ends is the whole day", () => {
    expect(inWindow(WEEKEND, 6, at(13))).toBe(true)
    expect(inWindow(WEEKEND, 0, at(23, 59))).toBe(true)
    expect(inWindow(WEEKEND, 1, 0)).toBe(false)
  })
  it("the one added last wins an overlap", () => {
    expect(activeTime([LUNCH, WEEKEND], 6, at(12))).toBe(WEEKEND)
    expect(activeTime([LUNCH, WEEKEND], 3, at(12))).toBe(LUNCH)
    expect(activeTime([LUNCH], 3, at(9))).toBeNull()
  })
  it("says itself in words", () => {
    expect(windowWords(LUNCH)).toBe("11 am to 3 pm")
    expect(windowWords(WEEKEND)).toBe("Sun, Sat, all day")
    expect(windowWords(LATE)).toBe("Fri, 10 pm to 4 am")
  })
})

describe("the TV's own copy of the rule", () => {
  const src = /\/\/ BEGIN pickTime([\s\S]*?)\/\/ END pickTime/.exec(playerHtml({ base: "", app: false }))![1]
  const pickTime = new Function(`${src}; return pickTime`)() as (t: object[], utc: number, off: number) => object | null

  it("agrees with the server's for every quarter hour of two weeks", () => {
    const times = [LUNCH, LATE, WEEKEND, { days: 0b0010100, start: at(6), end: at(10, 30) }]
    const start = Date.UTC(2026, 10, 22, 8) // Sunday midnight in Los Angeles
    for (let i = 0; i < 14 * 96; i++) {
      const utc = start + i * 15 * 60_000
      const local = new Date(utc - 480 * 60_000)
      const want = activeTime(times, local.getUTCDay(), local.getUTCHours() * 60 + local.getUTCMinutes())
      expect(pickTime(times, utc, -480)).toBe(want)
    }
  })
})

describe("store time", () => {
  it("follows daylight saving", () => {
    expect(storeOffsetMinutes(new Date("2026-11-23T20:00:00Z"))).toBe(-480)
    expect(storeOffsetMinutes(new Date("2026-07-01T20:00:00Z"))).toBe(-420)
    expect(storeOffsetMinutes(new Date("2026-03-08T09:59:30Z"))).toBe(-480)
    expect(storeOffsetMinutes(new Date("2026-03-08T10:00:30Z"))).toBe(-420)
  })
})

describe("uploads", () => {
  it("goes by the bytes, not the name", () => {
    const pad = (b: number[]) => new Uint8Array([...b, ...Array(16).fill(0)])
    expect(sniffImage(pad([0xff, 0xd8, 0xff]))).toBe("image/jpeg")
    expect(sniffImage(pad([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png")
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp")
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull()
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})

describe("the square on a new TV", () => {
  it("is a square of 0s and 1s leading to Screens with the code", () => {
    expect(pairLink("482913")).toBe("https://dashboard.chrisneddys.com/dashboard/screens?pair=482913")
    const rows = qrRows(pairLink("482913"))
    expect(rows.length).toBeGreaterThan(20)
    expect(rows.every((r) => r.length === rows.length && /^[01]+$/.test(r))).toBe(true)
  })
})
