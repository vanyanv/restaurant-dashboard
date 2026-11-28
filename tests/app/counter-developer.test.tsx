// @vitest-environment jsdom
/**
 * The developer portal page: its four tabs on both surfaces, the map and its
 * text, what moves and what stops it, and who is let in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { existsSync, readFileSync } from "node:fs"

const nav = vi.hoisted(() => ({ search: "", refresh: vi.fn(), redirect: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: nav.refresh }),
  usePathname: () => "/dashboard/admin/developer",
  useSearchParams: () => new URLSearchParams(nav.search),
  redirect: (to: string) => {
    nav.redirect(to)
    throw new Error(`REDIRECT ${to}`)
  },
}))
vi.mock("@/lib/counter/actions/developer", () => ({
  unlockKeys: vi.fn(),
  revealKey: vi.fn(),
  exportEnvFile: vi.fn(),
  lockKeys: vi.fn(),
}))
const auth = vi.hoisted(() => ({ session: null as unknown }))
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
const adapter = vi.hoisted(() => ({ calls: [] as unknown[] }))
vi.mock("@/lib/counter/adapters/developer", () => ({
  getDeveloperSectionPromises: (who: unknown) => {
    adapter.calls.push(who)
    return {}
  },
}))

import { failed, ready } from "@/lib/counter/section-data"
import type { DeveloperMap, DeveloperSections } from "@/lib/counter/adapters/developer"
import { DeveloperView } from "@/app/dashboard/(counter)/admin/developer/developer-view"
import { CounterDeveloperClient } from "@/app/dashboard/(counter)/admin/developer/counter-developer-client"
import { CounterPhoneDeveloperClient } from "@/app/(mobile)/m/(counter)/developer/counter-phone-developer-client"
import { flowOf, layoutMap, MAP_W } from "@/app/dashboard/(counter)/admin/developer/map-layout"
import { tabPanel, tabPanels } from "./page-tabs-support"

const MAP: DeveloperMap = {
  groups: [
    {
      id: "data",
      label: "Data",
      connections: [
        { id: "neon", name: "Neon Postgres", does: "every figure", flow: "both", icon: "database", status: "ready", missingKeys: [] },
      ],
    },
    {
      id: "outside",
      label: "Outside data",
      connections: [
        { id: "otter", name: "Otter", does: "orders in", flow: "in", icon: "orders", status: "ready", missingKeys: [] },
        { id: "phq", name: "PredictHQ", does: "local events", flow: "in", icon: "events", status: "elsewhere", missingKeys: [] },
      ],
    },
    {
      id: "mail",
      label: "Mail",
      connections: [
        { id: "resend", name: "Resend", does: "sends PINs", flow: "out", icon: "send", status: "missing", missingKeys: ["RESEND_API_KEY", "CHECKS_EMAIL_FROM"] },
      ],
    },
    {
      id: "apps",
      label: "Our other apps",
      connections: [
        { id: "shop", name: "Shop site", does: "signed API", flow: "both", icon: "shop", status: "missing", missingKeys: ["SHOP_API_URL"] },
      ],
    },
  ],
}

const SECTIONS: DeveloperSections = {
  summary: ready({ onMap: 5, ready: 2, elsewhere: 1, missing: ["Resend", "Shop site"] }),
  map: ready(MAP),
  stack: ready({
    groups: [
      {
        id: "framework",
        label: "Framework",
        rows: [
          { name: "Next.js", version: "16.4", icon: "next" },
          { name: "React", version: "19.2", icon: "react" },
        ],
      },
      { id: "data", label: "Data", rows: [{ name: "Postgres on Neon", version: null, icon: "postgres" }] },
    ],
  }),
  keys: ready({
    rows: [
      {
        name: "OPENAI_API_KEY",
        connectionName: "OpenAI",
        icon: "openai",
        secret: true,
        setHere: true,
        vercel: null,
        github: false,
        state: "ok",
        canReveal: true,
      },
    ],
    counts: { ok: 1, missing: 0, unused: 0, githubOnly: 0, notNeededHere: 0 },
    vercelStatus: { ok: true },
    valuesAvailable: true,
  }),
  setup: ready({
    steps: [
      { command: "npm ci", explain: "Installs the exact packages the live site runs on." },
      { command: "npm run dev", explain: "Starts the site." },
    ],
    byHand: ["PREDICTHQ_API_TOKEN", "GH_PAT"],
    warning: "Never run prisma migrate dev. It would reset the live database: .env.local points at the real one.",
  }),
}

/** A browser that has not asked for less motion. jsdom has no matchMedia, which the app reads as "reduced". */
function allowMotion() {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

const view = (sections: DeveloperSections = SECTIONS) =>
  render(<DeveloperView sections={sections} monitoringHref="/dashboard/admin/monitoring/infrastructure" />)

beforeEach(() => {
  nav.search = ""
  nav.refresh.mockReset()
  nav.redirect.mockReset()
  adapter.calls.length = 0
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("developer portal: tabs", () => {
  it("has the four tabs in order, Map open, on desk and phone alike", () => {
    for (const Client of [CounterDeveloperClient, CounterPhoneDeveloperClient]) {
      const { container, unmount } = render(<Client sections={SECTIONS} />)
      const root = container.querySelector(".dv")!
      expect([...root.querySelectorAll(".cu-tab")].map((t) => t.textContent)).toEqual(["Map", "Stack", "Keys", "New computer"])
      expect(tabPanels(root).map((p) => [p.dataset.tab, p.hidden])).toEqual([
        ["map", false],
        ["stack", true],
        ["keys", true],
        ["setup", true],
      ])
      expect(screen.getByRole("heading", { name: "Developer portal" })).toBeTruthy()
      unmount()
    }
  })

  it("opens the tab the address names, so a reload or a shared link lands on it", () => {
    nav.search = "tab=keys"
    const { container } = view()
    const root = container.querySelector(".dv")!
    expect(tabPanel(root, "keys").hidden).toBe(false)
    expect(tabPanel(root, "map").hidden).toBe(true)
  })

  it("a failed section offers Try again, which asks for the page again", () => {
    view({ ...SECTIONS, stack: failed("Stack unavailable", "retryDeveloper") })
    const again = screen.getAllByRole("button", { hidden: true }).find((b) => /try again|retry/i.test(b.textContent ?? ""))
    expect(again).toBeTruthy()
    fireEvent.click(again!)
    expect(nav.refresh).toHaveBeenCalledTimes(1)
  })
})

describe("developer portal: map", () => {
  it("answers in a sentence, with the count and who is missing a key", () => {
    const { container } = view()
    expect(container.querySelector(".cu-answer")!.textContent).toBe(
      "The app talks to 5 outside services. 2 have their keys on this server. Resend and Shop site don't. 1 keeps its key elsewhere.",
    )
    expect(screen.getByText("2 need a key")).toBeTruthy()
  })

  it("draws a labelled picture and carries the same list as text, key names included", () => {
    const { container } = view()
    const svg = container.querySelector("svg.dv-map__svg")!
    expect(svg.getAttribute("role")).toBe("img")
    expect(svg.getAttribute("aria-label")).toMatch(/5 outside services/)
    expect(svg.querySelectorAll(".dv-wire")).toHaveLength(4)

    const text = container.querySelector(".dv-groups")!
    expect([...text.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"))).toEqual(["Data", "Outside data", "Mail", "Our other apps"])
    const resend = within(text as HTMLElement).getByText("Resend").closest("li")!
    expect(resend.textContent).toContain("sends PINs · No key on this server")
    expect(resend.textContent).toContain("Missing: RESEND_API_KEY, CHECKS_EMAIL_FROM")
    expect(within(text as HTMLElement).getByText("PredictHQ").closest("li")!.textContent).toContain("Kept elsewhere")
    // And says which keys in plain sight on the wide page too.
    expect(container.querySelector(".dv-missing")!.textContent).toContain("SHOP_API_URL")
  })

  it("links to Monitoring for the timed jobs instead of repeating them", () => {
    view()
    expect(screen.getByRole("link", { name: "Open Monitoring" }).getAttribute("href")).toBe("/dashboard/admin/monitoring/infrastructure")
  })

  it("is still, with no pause control, when the device asked for less motion (the default)", () => {
    const { container } = view()
    expect(container.querySelectorAll(".dv-travel,.dv-ring,.dv-dot__ring")).toHaveLength(0)
    expect(screen.queryByRole("button", { name: /motion/i })).toBeNull()
  })

  it("moves when motion is allowed, and Pause motion takes every loop out", () => {
    allowMotion()
    const { container } = view()
    // One dot per one-way wire, two for a wire that runs both ways.
    expect([...container.querySelectorAll(".dv-travel")].map((d) => d.getAttribute("data-way"))).toEqual([
      "out", "in", "in", "out", "out", "in",
    ])
    // A ring on each missing key, in the picture and in the text form.
    expect(container.querySelectorAll(".dv-ring")).toHaveLength(2)
    expect(container.querySelectorAll(".dv-dot__ring")).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: "Pause motion" }))
    expect(container.querySelectorAll(".dv-travel,.dv-ring,.dv-dot__ring")).toHaveLength(0)
    const play = screen.getByRole("button", { name: "Play motion" })
    // The words change, so it is not also a pressed toggle.
    expect(play.hasAttribute("aria-pressed")).toBe(false)
    fireEvent.click(play)
    expect(container.querySelectorAll(".dv-travel").length).toBeGreaterThan(0)
  })

  it("lays the groups out inside the picture, without overlap", () => {
    const l = layoutMap(MAP.groups)
    expect(l.groups.map((g) => g.side)).toEqual(["left", "left", "right", "right"])
    for (const g of l.groups) {
      expect(g.x).toBeGreaterThanOrEqual(0)
      expect(g.x + g.w).toBeLessThanOrEqual(MAP_W)
      expect(g.y).toBeGreaterThanOrEqual(0)
      expect(g.y + g.h).toBeLessThanOrEqual(l.h)
    }
    const [a, b] = l.groups.filter((g) => g.side === "left")
    expect(a.y + a.h).toBeLessThan(b.y)
    expect(MAP.groups.map(flowOf)).toEqual(["both", "in", "out", "both"])
    expect(layoutMap([]).groups).toEqual([])
  })
})

describe("developer portal: stack and new computer", () => {
  it("lists what the app is built with, and labels a row that has no version", () => {
    nav.search = "tab=stack"
    const { container } = view()
    const panel = tabPanel(container.querySelector(".dv")!, "stack")
    expect(panel.querySelector(".cu-answer")!.textContent).toContain("Built on Next.js 16.4 and React 19.2.")
    expect(within(panel).getByText("Postgres on Neon").closest("li")!.textContent).toContain("no package")
  })

  it("numbers the commands, copies one with a tick, lists the by-hand keys and warns", async () => {
    nav.search = "tab=setup"
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    const { container } = view()
    const panel = tabPanel(container.querySelector(".dv")!, "setup")
    expect(panel.querySelector(".cu-answer")!.textContent).toBe("A new computer is two commands, then 2 keys Vercel can't hand over.")
    expect([...panel.querySelectorAll("ol code")].map((c) => c.textContent)).toEqual(["npm ci", "npm run dev"])

    fireEvent.click(within(panel).getByRole("button", { name: "Copy: npm ci" }))
    expect(writeText).toHaveBeenCalledWith("npm ci")
    await vi.waitFor(() => expect(within(panel).getByRole("button", { name: "Copy: npm ci" }).textContent).toBe("✓ Copied"))

    expect(within(panel).getByText("PREDICTHQ_API_TOKEN")).toBeTruthy()
    const warning = within(panel).getByText("Never run prisma migrate dev.").closest("p")!
    expect(warning.textContent).toContain("It would reset the live database")
  })

  it("selects the command when the browser will not copy", async () => {
    nav.search = "tab=setup"
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("no")) } })
    const { container } = view()
    const panel = tabPanel(container.querySelector(".dv")!, "setup")
    fireEvent.click(within(panel).getByRole("button", { name: "Copy: npm run dev" }))
    await vi.waitFor(() => expect(panel.textContent).toContain("Couldn't copy from here. The command is selected"))
    expect(window.getSelection()!.toString()).toBe("npm run dev")
  })
})

describe("developer portal: who gets in", () => {
  const DEV = { user: { id: "u1", role: "DEVELOPER", accountId: "acc_platform" } }
  const OWNER = { user: { id: "u2", role: "OWNER", accountId: "acc_platform" } }
  const pages = [
    ["desk page", "@/app/dashboard/(counter)/admin/developer/page", "/login", "/dashboard/forbidden"],
    ["phone page", "@/app/(mobile)/m/(counter)/developer/page", "/m/login", "/m/forbidden"],
  ] as const

  async function open(path: string, props?: unknown) {
    const mod = (await import(/* @vite-ignore */ path)) as { default: (p?: unknown) => Promise<unknown> }
    return mod.default(props)
  }

  beforeEach(() => vi.stubEnv("DEVELOPER_PORTAL_ACCOUNT_ID", "acc_platform"))
  afterEach(() => vi.unstubAllEnvs())

  it.each(pages)("%s: an owner goes to the forbidden page, which is told nothing", async (_n, path, _login, forbidden) => {
    auth.session = OWNER
    await expect(open(path)).rejects.toThrow(`REDIRECT ${forbidden}`)
    expect(nav.redirect).toHaveBeenCalledWith(forbidden)
    expect(adapter.calls).toEqual([])
  })

  it.each(pages)("%s: signed out goes to sign-in", async (_n, path, login) => {
    auth.session = null
    await expect(open(path)).rejects.toThrow(`REDIRECT ${login}`)
  })

  it.each(pages)("%s: a developer of another account is refused too", async (_n, path, _login, forbidden) => {
    auth.session = { user: { id: "u3", role: "DEVELOPER", accountId: "acc_other" } }
    await expect(open(path)).rejects.toThrow(`REDIRECT ${forbidden}`)
    expect(adapter.calls).toEqual([])
  })

  it.each(pages)("%s: a developer gets the page, and the adapter gets their account", async (_n, path) => {
    auth.session = DEV
    await expect(open(path)).resolves.toBeTruthy()
    expect(adapter.calls).toEqual([{ accountId: "acc_platform" }])
  })

  it("the phone route has its own gate; the desk layout does not cover /m", async () => {
    auth.session = OWNER
    await expect(open("@/app/(mobile)/m/(counter)/developer/layout", { children: null })).rejects.toThrow("REDIRECT /m/forbidden")
    auth.session = { user: { id: "u3", role: "DEVELOPER", accountId: "acc_other" } }
    await expect(open("@/app/(mobile)/m/(counter)/developer/layout", { children: null })).rejects.toThrow("REDIRECT /m/forbidden")
    auth.session = null
    await expect(open("@/app/(mobile)/m/(counter)/developer/layout", { children: null })).rejects.toThrow("REDIRECT /m/login")
    auth.session = DEV
    await expect(open("@/app/(mobile)/m/(counter)/developer/layout", { children: null })).resolves.toBeTruthy()
  })

  it("the desk route sits under the developer-only admin layout", async () => {
    auth.session = OWNER
    await expect(open("@/app/dashboard/(counter)/admin/layout", { children: null })).rejects.toThrow("REDIRECT /dashboard/forbidden")
  })
})

describe("developer portal: registered where its siblings are", () => {
  const DESK = "src/app/dashboard/(counter)/admin/developer"
  const PHONE = "src/app/(mobile)/m/(counter)/developer"

  it("both routes have a loading file that lists the first tab's sections in order", () => {
    for (const dir of [DESK, PHONE]) {
      const src = readFileSync(`${dir}/loading.tsx`, "utf8")
      expect([...src.matchAll(/<Section bare title="([^"]+)"/g)].map((m) => m[1])).toEqual(["Developer portal", "Connections"])
    }
    const viewSrc = readFileSync(`${DESK}/developer-view.tsx`, "utf8")
    expect([...viewSrc.matchAll(/<Section bare title="([^"]+)"/g)].map((m) => m[1]).slice(0, 2)).toEqual(["Developer portal", "Connections"])
  })

  it("both pages mark when they are ready, for the speed sweep", () => {
    expect(readFileSync(`${DESK}/page.tsx`, "utf8")).toContain('data-perf-ready="/dashboard/admin/developer"')
    expect(readFileSync(`${PHONE}/page.tsx`, "utf8")).toContain('data-perf-ready="/m/developer"')
    expect(existsSync(`${PHONE}/layout.tsx`)).toBe(true)
  })

  it("client files take only types from the server-only lists", () => {
    for (const f of ["developer-view.tsx", "developer-keys.tsx", "developer-map.tsx", "counter-developer-client.tsx", "map-layout.ts"]) {
      const src = readFileSync(`${DESK}/${f}`, "utf8")
      const bad = [...src.matchAll(/^import (?!type )[^\n]*from "@\/lib\/(?:counter\/(?:connections|stack|adapters\/developer)|developer\/[^"]+)"/gm)]
      expect(bad.map((m) => m[0]), f).toEqual([])
    }
    const mark = readFileSync("src/components/counter/ui/service-mark.tsx", "utf8")
    expect(mark).toMatch(/import type \{ ConnectionIcon \} from "@\/lib\/counter\/connections"/)
  })
})
