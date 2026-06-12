# E2E Tests (Playwright)

End-to-end tests that exercise the dashboard against a real dev server + dev DB on both desktop and mobile.

## Setup (one-time)

1. Create `.env.test.local` at the repo root with credentials for an **existing** dev-DB user:

   ```
   E2E_USER_EMAIL=your-test-user@chrisneddys.com
   E2E_USER_PASSWORD=your-password
   ```

2. Install Playwright browsers:

   ```
   npx playwright install chromium
   ```

## Run

```
npm run e2e          # full suite (desktop + mobile projects)
npm run e2e:smoke    # smoke-tagged tests only (~30s, run by pre-push hook)
npm run e2e:ui       # interactive Playwright UI
npm run e2e:report   # open the last HTML report
```

## Layout

- `auth.setup.ts` — logs in once, caches session in `.auth/user.json` (gitignored).
- `fixtures/test.ts` — extends Playwright `test` with a `consoleErrors` collector.
- `desktop/*.spec.ts` — runs under the `desktop` project (Chromium, 1440x900).
- `mobile/*.spec.ts` — runs under the `mobile` project (iPhone 14 device descriptor). Mobile UA triggers the middleware redirect from `/dashboard/*` to `/m/*` automatically.

## Conventions

- Tag P0 flows with `@smoke` in the `describe` or `test` name. Pre-push runs `--grep @smoke`.
- Prefer role-based locators (`getByRole`, `getByLabel`) over class/CSS.
- Assert on data presence (KPI is rendered, formatted with tabular-nums), not exact values.
- Pin to Hollywood — don't write tests that depend on store switching until GLN/VNYS open.
