import type { Redis } from "@upstash/redis"
import { count, currentSource } from "./meter"

const wrapped = new WeakMap<object, object>()

type Batch = { exec: (...args: unknown[]) => unknown; length?: () => number }

/** A pipeline or transaction is one HTTP call but bills each command in it. */
function countedBatch<T extends Batch>(batch: T): T {
  const exec = batch.exec.bind(batch)
  batch.exec = (...args: unknown[]) => {
    try {
      count(currentSource(), "redisCommands", batch.length?.() || 1)
    } catch {
      // Never throws.
    }
    return exec(...args)
  }
  return batch
}

/**
 * The Redis client with every command counted under the current source.
 * Upstash bills per command, so this is the figure its monthly limit is in;
 * Upstash's own total stays the authority and this is the split by source.
 */
export function countedRedis(client: Redis): Redis {
  const existing = wrapped.get(client)
  if (existing) return existing as Redis
  const methods = new Map<PropertyKey, unknown>()
  const proxy = new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (typeof value !== "function") return value
      let method = methods.get(prop)
      if (!method) {
        method =
          prop === "pipeline" || prop === "multi"
            ? (...args: unknown[]) => countedBatch(value.apply(target, args))
            : (...args: unknown[]) => {
                count(currentSource(), "redisCommands")
                return value.apply(target, args)
              }
        methods.set(prop, method)
      }
      return method
    },
  })
  wrapped.set(client, proxy)
  return proxy
}
