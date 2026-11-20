import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  anomalyEventToAlert,
  CRITICAL_DOLLARS,
  gradeSeverity,
  titleFor,
} from "@/lib/alerts/ingest"
import type { AnomalyEvent } from "@/generated/prisma/client"

function ev(over: Partial<AnomalyEvent>): AnomalyEvent {
  return {
    id: "ev1",
    storeId: "s1",
    target: "REVENUE",
    targetId: null,
    occurredOn: new Date("2026-11-17T00:00:00Z"),
    residual: -1480,
    zScore: null,
    method: "PREDICTION_INTERVAL",
    status: "OPEN",
    explanation: null,
    detectedAt: new Date("2026-11-18T06:00:00Z"),
    acknowledgedAt: null,
    ...over,
  } as AnomalyEvent
}

const ctx = { storeName: "Hollywood", unitPrice: null, intervalExcess: null }

describe("alert severity", () => {
  it("a shake 11 units over its usual is not CRITICAL, however large the z", () => {
    const a = anomalyEventToAlert(
      ev({ target: "MENU_ITEM", targetId: "Vanilla Shake", residual: 11, zScore: 6.2, method: "ZSCORE" }),
      { ...ctx, unitPrice: 6.99 },
    )
    expect(a.severity).toBe("INFO")
    expect(a.body).toContain("About $77 of sales")
    expect(a.body).toContain("Check stock of Vanilla Shake before tonight.")
  })

  it("an item with no price on file is capped at WATCH and says the size is unknown", () => {
    const a = anomalyEventToAlert(
      ev({ target: "MENU_ITEM", targetId: "Mystery", residual: 300, zScore: 9, method: "ZSCORE" }),
      ctx,
    )
    expect(a.severity).toBe("WATCH")
    expect(a.body).toContain("dollar size is not known")
    expect(a.body).not.toContain("$0")
  })

  it("an interval alert is graded instead of falling to INFO for want of a z", () => {
    expect(
      gradeSeverity({ zScore: null, method: "PREDICTION_INTERVAL", intervalExcess: null, dollarsAtRisk: 1480 }),
    ).toBe("WATCH")
    expect(
      gradeSeverity({ zScore: null, method: "PREDICTION_INTERVAL", intervalExcess: 1.4, dollarsAtRisk: 1480 }),
    ).toBe("CRITICAL")
    expect(
      gradeSeverity({ zScore: null, method: "PREDICTION_INTERVAL", intervalExcess: 3, dollarsAtRisk: 120 }),
    ).toBe("INFO")
  })

  it("a big dollar miss that is ordinary noise is not critical", () => {
    expect(gradeSeverity({ zScore: 2.6, method: "ZSCORE", dollarsAtRisk: CRITICAL_DOLLARS * 5 })).toBe("WATCH")
    expect(gradeSeverity({ zScore: 1.5, method: "ZSCORE", dollarsAtRisk: CRITICAL_DOLLARS * 5 })).toBe("INFO")
  })
})

describe("alert words", () => {
  it("z-score alerts compare to usual, not forecast, and revenue carries a $", () => {
    expect(titleFor(ev({ method: "ZSCORE", residual: -1200 }))).toBe("Revenue -$1,200 vs usual")
    expect(titleFor(ev({ method: "PREDICTION_INTERVAL", residual: -1480 }))).toBe("Revenue -$1,480 below forecast")
    expect(
      titleFor(ev({ method: "ZSCORE", target: "MENU_ITEM", targetId: "Soda", residual: -56 })),
    ).toBe("Soda — -56 units vs usual")
  })

  it("keeps the interval detector's own explanation as the body, with store and next step", () => {
    const explanation =
      "$5,210 came in under a forecast of $6,690 (expected $5,900-$7,400); $1,480 under."
    const a = anomalyEventToAlert(ev({ explanation }), ctx)
    expect(a.body).toBe(
      "Hollywood, Tue, Nov 17: $5,210 came in under a forecast of $6,690 (expected $5,900-$7,400); $1,480 under. " +
        "$1,480 of sales short of forecast. Check that every order for the day synced and no app was switched off.",
    )
  })
})
