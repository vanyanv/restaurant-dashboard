/**
 * Neutralise `server-only` for scripts run under tsx.
 *
 * `server-only`'s whole job is to throw at BUNDLE time if a module marked
 * server-side is pulled into a client component. Its package exposes a
 * `"react-server"` export condition pointing at an empty module, and every
 * bundler picks that up. A plain Node process does not: it resolves the
 * default entry, which is one line — `throw new Error(...)` — and takes the
 * whole script down at import.
 *
 * `src/lib/welcome.ts` is the only file in `src/` that imports it, and the
 * eval runners reach it transitively through the chat system prompt. That is
 * how `npm run eval:llm` came to be unrunnable on this branch while every
 * other entry point was fine.
 *
 * `vitest.config.mts` already solves this by aliasing the specifier to the
 * package's own `empty.js`, resolved through `createRequire` so it survives
 * hoisted and nested installs. tsx has no alias table, so the same resolution
 * is done here as a `Module._resolveFilename` hook and loaded with
 * `tsx -r`. ONE answer, mirrored — not a second opinion about what
 * `server-only` means outside a bundler.
 */
const Module = require("module")
const path = require("path")

const emptyPath = path.join(path.dirname(require.resolve("server-only")), "empty.js")
const resolveFilename = Module._resolveFilename

Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return emptyPath
  return resolveFilename.call(this, request, ...rest)
}
