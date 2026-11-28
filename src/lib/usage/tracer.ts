/**
 * How a request gets its usage source, and where requests and outside calls
 * are counted.
 *
 * Next already emits a span per request and a span per `fetch`. This registers
 * a tracer that exports nothing: its one span processor reads those spans and
 * adds to the in-memory meter. Measured on a production build, 2026-11-28:
 * about 0.1 ms of CPU per request (two spans locally: the proxy pass, then the
 * route).
 *
 * - The sampler records only the request span and fetch spans. Next's other
 *   spans (render, metadata, segments) are created non-recording.
 * - The propagator is how the referer arrives. Next hands every request's
 *   headers to the registered propagator before it starts the request span
 *   (`withPropagatedContext` in next/dist/server/lib/trace/tracer.js), so
 *   `src/proxy.ts` needs no change.
 * - The context manager is what lets the Prisma and Redis counters find the
 *   request they are running in (`currentSource()` in meter.ts).
 */
import {
  context,
  createContextKey,
  propagation,
  trace,
  type Context,
  type TextMapPropagator,
} from "@opentelemetry/api"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import {
  BasicTracerProvider,
  SamplingDecision,
  type ReadableSpan,
  type Sampler,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base"
import { maybeFlush } from "./flush"
import { serviceOfHost } from "./hosts"
import { bindTrace, count, sourceOfTrace, unbindTrace } from "./meter"
import { sourceOf } from "./source"

const REFERER = createContextKey("usage.referer")
/** `next.span_type` of the span around a whole request, and of a `fetch`. */
const REQUEST = "BaseServer.handleRequest"
const FETCH = "AppRender.fetch"

export const usagePropagator: TextMapPropagator = {
  inject() {},
  extract(ctx: Context, carrier, getter) {
    try {
      const value = getter.get(carrier, "referer")
      const referer = Array.isArray(value) ? value[0] : value
      return referer ? ctx.setValue(REFERER, referer) : ctx
    } catch {
      return ctx
    }
  },
  fields: () => ["referer"],
}

export const usageSampler: Sampler = {
  shouldSample(_ctx, _traceId, _name, _kind, attributes) {
    const type = attributes?.["next.span_type"]
    return {
      decision:
        type === REQUEST || type === FETCH
          ? SamplingDecision.RECORD_AND_SAMPLED
          : SamplingDecision.NOT_RECORD,
    }
  },
  toString: () => "UsageSampler",
}

const durationMs = (span: ReadableSpan): number => span.duration[0] * 1000 + span.duration[1] / 1e6

export const usageProcessor: SpanProcessor = {
  onStart(span, parent) {
    try {
      if (span.attributes["next.span_type"] !== REQUEST) return
      const target = span.attributes["http.target"]
      if (typeof target !== "string") return
      const referer = parent.getValue(REFERER)
      bindTrace(
        span.spanContext().traceId,
        sourceOf(target, typeof referer === "string" ? referer : null),
      )
    } catch {
      // Never throws.
    }
  },
  onEnd(span) {
    try {
      const a = span.attributes
      const traceId = span.spanContext().traceId
      const source = sourceOfTrace(traceId) ?? "other"
      if (a["next.span_type"] === REQUEST) {
        unbindTrace(traceId)
        // With `next start` a request passes through twice: once for the proxy
        // (no route yet), once for the route. On Vercel those are two
        // functions. Only the second is a request to the app.
        if (a["next.route"] === undefined) {
          count(source, "proxyCalls")
        } else {
          count(source, "calls")
          count(source, "wallMs", durationMs(span))
        }
        maybeFlush()
        return
      }
      const host = a["net.peer.name"]
      const service = typeof host === "string" ? serviceOfHost(host) : null
      if (!service) return
      count(source, `out:${service}`)
      const status = Number(a["http.status_code"])
      if (status === 429 || status >= 500) count(source, `out:${service}:refused`)
    } catch {
      // Never throws.
    }
  },
  forceFlush: async () => {},
  shutdown: async () => {},
}

let registered = false

/** Called once from `src/instrumentation.ts`. Does nothing the second time. */
export function registerUsageTracer(): void {
  if (registered) return
  registered = true
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  propagation.setGlobalPropagator(usagePropagator)
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ sampler: usageSampler, spanProcessors: [usageProcessor] }),
  )
  if (process.env.VERCEL_ENV === "preview") console.log("[usage] tracer registered")
}
