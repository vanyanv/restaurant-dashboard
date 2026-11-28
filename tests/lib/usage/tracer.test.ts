import { beforeEach, describe, expect, it, vi } from "vitest"
import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api"
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base"

vi.mock("@/lib/usage/flush", () => ({ maybeFlush: vi.fn() }))

import { resetMeterForTest, sourceOfTrace, takePending } from "@/lib/usage/meter"
import { maybeFlush } from "@/lib/usage/flush"
import { usageProcessor, usagePropagator, usageSampler } from "@/lib/usage/tracer"

const ROOT = "BaseServer.handleRequest"
const FETCH = "AppRender.fetch"
const provider = new BasicTracerProvider({ sampler: usageSampler, spanProcessors: [usageProcessor] })
const tracer = provider.getTracer("test")

const taken = () =>
  Object.fromEntries(
    (takePending()?.rows ?? []).filter((r) => r[2] !== "cpuMs").map((r) => [`${r[1]}/${r[2]}`, r[3]]),
  )

function request(target: string, opts: { route?: string; referer?: string } = {}) {
  const parent = usagePropagator.extract(ROOT_CONTEXT, { referer: opts.referer }, {
    get: (c: Record<string, string | undefined>, k: string) => c[k],
    keys: (c: Record<string, string | undefined>) => Object.keys(c),
  })
  const root = tracer.startSpan("GET", { attributes: { "next.span_type": ROOT, "http.target": target } }, parent)
  if (opts.route !== undefined) root.setAttribute("next.route", opts.route)
  return { root, ctx: trace.setSpan(parent, root) }
}

function outside(ctx: ReturnType<typeof request>["ctx"], host: string, status?: number) {
  const span = tracer.startSpan("fetch", { attributes: { "next.span_type": FETCH, "net.peer.name": host } }, ctx)
  if (status !== undefined) span.setAttribute("http.status_code", status)
  span.end()
}

describe("usage tracer", () => {
  beforeEach(() => {
    resetMeterForTest()
    vi.mocked(maybeFlush).mockClear()
  })

  it("counts a finished request under its source and forgets the trace", () => {
    const { root } = request("/api/tv/checkin", { route: "/api/tv/checkin" })
    const traceId = root.spanContext().traceId
    expect(sourceOfTrace(traceId)).toBe("tv")
    root.end()
    const got = taken()
    expect(got["tv/calls"]).toBe(1)
    expect(got["tv/wallMs"]).toBeGreaterThanOrEqual(0)
    expect(sourceOfTrace(traceId)).toBeUndefined()
    expect(maybeFlush).toHaveBeenCalledTimes(1)
  })

  it("uses the referer for an API call made from a page", () => {
    const { root } = request("/api/stores", { route: "/api/stores", referer: "https://x/m/overview" })
    root.end()
    expect(taken()["phone/calls"]).toBe(1)
  })

  it("counts a pass through the proxy apart from a request", () => {
    const { root } = request("/m/overview")
    root.end()
    const got = taken()
    expect(got["phone/proxyCalls"]).toBe(1)
    expect(got["phone/calls"]).toBeUndefined()
  })

  it("counts an outside call, and a refused one twice", () => {
    const { root, ctx } = request("/api/tv/checkin", { route: "/api/tv/checkin" })
    outside(ctx, "api.openai.com", 429)
    outside(ctx, "api.openai.com", 200)
    outside(ctx, "api.resend.com", 503)
    outside(ctx, "api.resend.com", 404)
    outside(ctx, "api.github.com")
    outside(ctx, "x.upstash.io", 200)
    root.end()
    const got = taken()
    expect(got["tv/out:openai"]).toBe(2)
    expect(got["tv/out:openai:refused"]).toBe(1)
    expect(got["tv/out:resend"]).toBe(2)
    expect(got["tv/out:resend:refused"]).toBe(1)
    expect(got["tv/out:github"]).toBe(1)
    expect(Object.keys(got).some((k) => k.includes("upstash"))).toBe(false)
  })

  it("does not record Next's other spans", () => {
    const span = tracer.startSpan("render", { attributes: { "next.span_type": "AppRender.getBodyResult" } })
    expect(span.isRecording()).toBe(false)
    span.end()
    expect(takePending()).toBeNull()
  })

  it("never throws out of the processor", () => {
    const bad = { attributes: null, spanContext: () => { throw new Error("x") } } as never
    expect(() => usageProcessor.onStart(bad, context.active())).not.toThrow()
    expect(() => usageProcessor.onEnd(bad)).not.toThrow()
  })
})
