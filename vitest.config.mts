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

/**
 * `import logo from "../../public/logo-wordmark.png"` has to arrive as
 * `StaticImageData`, not as a URL string.
 *
 * Next's own image loader turns a static import into
 * `{ src, width, height, blurDataURL }`, and `next/image` THROWS on anything
 * without a width: `Image with src "..." is missing required "width"
 * property.` Vite has no such loader — it returns the resolved URL as a plain
 * string — so every component that draws `Logo` blew up under Vitest.
 *
 * Nothing caught it for as long as it was true, because until the rail drew
 * the mark no test had ever rendered `Logo`: it lived only on the auth pages
 * and the phone's fifth tab, none of which have component tests. Putting it
 * in the rail put it under `AppShell`, and 111 tests across six files failed
 * at once.
 *
 * The numbers are the asset's real intrinsic size (logo.png cropped to its
 * alpha bounds — see `shell/logo.tsx`), so a test that ever does read the
 * aspect reads the true one. Nothing measures them in jsdom today.
 */
const staticImageStub = {
  name: "static-image-stub",
  enforce: "pre" as const,
  load(id: string) {
    if (!/\.(png|jpe?g|gif|webp|avif)(\?.*)?$/.test(id)) return null
    const src = id.split("?")[0]
    return `export default ${JSON.stringify({ src, width: 957, height: 253, blurDataURL: src })}`
  },
}

// .mts is loaded as native ESM, where __dirname does not exist (it's a CJS
// global) — import.meta.dirname is its ESM equivalent (Node 20.11+ / 21.2+).
export default defineConfig({
  plugins: [staticImageStub],
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
