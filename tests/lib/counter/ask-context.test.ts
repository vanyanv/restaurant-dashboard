import { describe, it, expect } from "vitest"
import { describeAskContext } from "@/lib/counter/ask-context"

const TODAY = new Date(2026, 7, 24)
const base = { params: new URLSearchParams(), storeName: null, today: TODAY }

describe("describeAskContext", () => {
  it("names the page from the route, not from a caller", () => {
    expect(describeAskContext({ ...base, pathname: "/dashboard/invoices" }).page).toBe("Invoices")
  })

  it("keeps the parent's name on a detail route", () => {
    expect(describeAskContext({ ...base, pathname: "/dashboard/invoices/I28517" }).page).toBe("Invoices")
  })

  it("falls back to Dashboard on an unrecognised route rather than throwing", () => {
    expect(describeAskContext({ ...base, pathname: "/dashboard/nowhere" }).page).toBe("Dashboard")
  })

  it("names the range in the reader's words", () => {
    const c = describeAskContext({ ...base, pathname: "/dashboard", params: new URLSearchParams("range=d30") })
    expect(c.range).toBe("Last 30 days")
  })

  it("says all stores when no store is selected", () => {
    expect(describeAskContext({ ...base, pathname: "/dashboard" }).store).toBe("All stores")
  })

  it("names the selected store when one is given", () => {
    const c = describeAskContext({
      ...base, pathname: "/dashboard",
      params: new URLSearchParams("store=hollywood"), storeName: "Hollywood",
    })
    expect(c.store).toBe("Hollywood")
  })

  it("falls back to the id when the name is not known yet", () => {
    // The switcher's store list may not have loaded. Showing the id is worse
    // than showing a name and far better than showing nothing, because the
    // whole point is that the reader can see what is being answered.
    const c = describeAskContext({
      ...base, pathname: "/dashboard", params: new URLSearchParams("store=hollywood"),
    })
    expect(c.store).toBe("hollywood")
  })

  it("composes a sentence a reader can check before typing", () => {
    const c = describeAskContext({
      ...base, pathname: "/dashboard/pnl",
      params: new URLSearchParams("range=d7&store=hollywood"), storeName: "Hollywood",
    })
    expect(c.sentence).toBe("Answering about P&L · Hollywood · Last 7 days")
  })
})
