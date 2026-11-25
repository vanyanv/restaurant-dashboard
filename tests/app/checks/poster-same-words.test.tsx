import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Poster, POSTER_STEPS, type PosterStore } from "@/app/dashboard/(counter)/checks/posters/poster"

const store = (name: string, link: string): PosterStore => ({
  id: name,
  name,
  link,
  qr: { size: 1, cells: "1" },
  windows: [
    { label: "Morning", labelEs: "Mañana", opens: "9:00 am", submit: "4:30 pm – 6:30 pm", until: [], untilEs: [] },
    { label: "Night", labelEs: "Noche", opens: "5:30 pm", submit: "12:30 am – 2:00 am", until: [], untilEs: [] },
  ],
})

/** Everything a poster says apart from the store's name and link. */
const words = (s: PosterStore) =>
  renderToStaticMarkup(<Poster store={s} />)
    .replaceAll(s.name, "STORE")
    .replaceAll(s.name.split(" - ")[1], "STORE")
    .replaceAll(s.link, "LINK")
    .replace(/ckb?-qr[\s\S]*?<\/svg>/, "")

describe("store checks poster", () => {
  it("says the same thing at every store (owner 2026-11-25)", () => {
    expect(words(store("Chris N Eddys - Glendale", "https://x/g"))).toBe(words(store("Chris N Eddys - Hollywood", "https://x/h")))
  })

  it("has the five steps and the How, Forgot? and Problem? tips", () => {
    const html = renderToStaticMarkup(<Poster store={store("Chris N Eddys - Van Nuys", "https://x/v")} />)
    for (const s of POSTER_STEPS) expect(html).toContain(s.en)
    expect(html).toContain("Tap How")
    expect(html).toContain("Tap Forgot?")
    expect(html).toContain("Tap Problem?")
    expect(html).toContain("Morning")
    expect(html).toContain("Night")
  })
})
