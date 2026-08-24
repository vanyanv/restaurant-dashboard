# Deferred Dependency Upgrades

Task 2 (2026-08-23) cleared all non-breaking security advisories, but the following packages have upgrades available that would introduce breaking changes.

| Package | From → To | Why deferred | Blocks |
|---------|-----------|--------------|--------|
| prisma | 7.9.1 → 6.12.0 | Would fix deepmerge-ts stack exhaustion advisory, but requires MAJOR VERSION DOWNGRADE (7→6), which violates modernization direction | None (Task 3–9 upgrades do not touch Prisma); awaits upstream deepmerge-ts fix or Prisma 8.0+ release |

## Known landmine: cosmiconfig's TypeScript loader under TypeScript 7 (not a deferred upgrade)

Task 8 (2026-08-24) upgraded `typescript` to `7.0.2`, the native Go-ported compiler. Its
package no longer ships the classic Compiler API (`typescript/lib/typescript.js`) — only
a `bin/tsc` CLI shim over a native binary. `shadcn@3.8.5` transitively pulls in
`cosmiconfig@9.0.2`, whose `dist/loaders.js` defines `loadTsSync`/`loadTsAsync` loaders
that `require('typescript')` and then call `.transpileModule`, `.findConfigFile`, and
`.sys.fileExists` — none of which exist on TS7's restructured package export surface.
That code path throws if it is ever reached.

**Why it's not reachable today:** shadcn's CLI constructs its cosmiconfig search with
`searchPlaces: ["components.json"]` (JSON only), so cosmiconfig's TS loader is never
invoked. shadcn is also not wired into any `npm` script in this repo — it's only ever
run ad hoc via `npx shadcn@latest ...`.

**What would make it reachable:** any change that gives cosmiconfig a `searchPlaces`
entry ending in `.ts` (e.g. a future shadcn config format, a different cosmiconfig
consumer added to the repo, or someone hand-rolling a `cosmiconfig(...)` call with a
`.ts`-inclusive search list) would hit `loadTsSync`/`loadTsAsync` and throw under TS7.

Flag for whoever next touches shadcn or adds a cosmiconfig-based tool: if you introduce
or change a `searchPlaces` list, check whether it includes `.ts`, and if so, verify it
actually works under TS7 before shipping — don't assume cosmiconfig's TS loader still
works just because `npx tsc` is clean.
