import { describe, it, expect } from "vitest"
import {
  CHANNELS, channelById, bandClassFor, markClassFor, commissionFor,
  bandVarFor, markVarFor,
} from "@/lib/counter/channels"

describe("channels", () => {
  it("knows the four the restaurant actually sells through", () => {
    expect(CHANNELS.map((c) => c.id)).toEqual(["house", "doordash", "ubereats", "grubhub"])
  })

  it("carries the commission each marketplace takes, from one place", () => {
    expect(commissionFor("house")).toBe(0)
    expect(commissionFor("doordash")).toBe(0.25)
    expect(commissionFor("ubereats")).toBe(0.23)
    expect(commissionFor("grubhub")).toBe(0.20)
  })

  it("maps a channel to a BAND class fixed to the channel, never to its rank", () => {
    // The same channel gets the same band whatever order it is drawn in.
    expect(bandClassFor("house")).toBe(bandClassFor("house"))
    expect(new Set(CHANNELS.map((c) => bandClassFor(c.id))).size).toBe(4)
  })

  it("band classes are the lightness-separated mx ramp, not the brand hexes", () => {
    expect(CHANNELS.map((c) => bandClassFor(c.id)))
      .toEqual(["bg-ct-mx-1", "bg-ct-mx-2", "bg-ct-mx-3", "bg-ct-mx-4"])
  })

  it("mark classes ARE the brand colours — identity, used beside a label", () => {
    expect(markClassFor("doordash")).toBe("text-ct-ch-dd")
    expect(markClassFor("house")).toBe("text-ct-ch-house")
  })

  it("the var form names the SAME two decisions the class form does", () => {
    // A component emitting the prototype's DOM cannot reach either colour
    // through a utility class — `.chip i` reads `var(--pc)` and the band steps
    // are custom properties — so both forms exist. They must not be able to
    // disagree: each is derived from one entry in CHANNELS.
    for (const c of CHANNELS) {
      expect(markVarFor(c.id)).toBe(`var(--${markClassFor(c.id).replace("text-ct-", "")})`)
      expect(bandVarFor(c.id)).toBe(`var(--${bandClassFor(c.id).replace("bg-ct-", "")})`)
    }
  })

  it("the var forms are tokens, never literals, and stay one-per-channel", () => {
    for (const c of CHANNELS) {
      expect(markVarFor(c.id)).toMatch(/^var\(--ch-[a-z]+\)$/)
      expect(bandVarFor(c.id)).toMatch(/^var\(--mx-[1-4]\)$/)
    }
    expect(new Set(CHANNELS.map((c) => markVarFor(c.id))).size).toBe(4)
    expect(new Set(CHANNELS.map((c) => bandVarFor(c.id))).size).toBe(4)
  })

  it("channelById is exhaustive and throws on an unknown id rather than returning undefined", () => {
    expect(channelById("grubhub").name).toBe("Grubhub")
    // @ts-expect-error — an unknown id must not type-check either
    expect(() => channelById("deliveroo")).toThrow(/unknown channel/)
  })
})
