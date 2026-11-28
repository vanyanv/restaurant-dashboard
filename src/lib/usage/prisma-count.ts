import { count, currentSource } from "./meter"

type Extendable = { $extends: (extension: never) => unknown }

/**
 * Counts every database round trip under the source of the request it runs in.
 * `$allOperations` at the root sees model calls and raw SQL alike. Applied to
 * both clients (`@/lib/prisma` and `@/lib/chat/prisma-chat`).
 *
 * Imports nothing from `next/*`: scripts use these clients too.
 */
export function withUsageCount<T extends Extendable>(client: T): T {
  return client.$extends({
    query: {
      $allOperations({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) {
        count(currentSource(), "dbQueries")
        return query(args)
      },
    },
  } as never) as T
}
