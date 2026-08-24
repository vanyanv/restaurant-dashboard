import { defineConfig } from "vitest/config"
import path from "path"
import { createRequire } from "module"

// Vitest 4.1.11+ stopped respecting package.json export conditions in module resolution.
// server-only has `"react-server": "./empty.js"` export condition but was resolving to
// the default `index.js` which throws in non-server-component contexts. Use createRequire
// to resolve server-only dynamically, then append empty.js, so it works with
// hoisted/nested installs and different package managers.
const req = createRequire(import.meta.url)
const serverOnlyEmptyPath = path.join(path.dirname(req.resolve("server-only")), "empty.js")

// .mts is loaded as native ESM, where __dirname does not exist (it's a CJS
// global) — import.meta.dirname is its ESM equivalent (Node 20.11+ / 21.2+).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "server-only": serverOnlyEmptyPath,
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["./tests/setup/testing-library.ts"],
  },
})
