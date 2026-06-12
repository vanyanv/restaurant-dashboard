# F21 — Smart Contextual Alerts (Design)

**Issue:** [#23](https://github.com/vanyanv/restaurant-dashboard/issues/23) · **Priority:** P0 · **Date:** 2026-05-18

## Context

Today the dashboard fires alerts from three disconnected places:

1. **`AnomalyEvent`** (F12 z-score detector) — contextual, per-(store, target) noise band, but only surfaced inside the forecast page; no inbox, no preferences.
2. **`AlertsBanner`** in product-usage — hard-coded thresholds (`|change%| > 15` for price; static rules for quantity spikes / new products).
3. **`getHarriAlerts`** — static labor variance thresholds, surfaced inline on the labor page.

F21 unifies all three into a single `Alert` inbox with severity tiers, per-(store, category) preferences, and a migration path that dual-writes to the new system before decommissioning the old. The verification gate is "alert volume drops ≥ 50% with no real-incidents missed."

The ML side of contextual detection (the per-(store, dow, target) noise band) already exists via F12's rolling z-score; this work is the **routing + UX + migration** layer on top of it.

## Architecture (one screen)

```
                          ┌─ AnomalyEvent (F12 z-score)
                          │
ml/anomaly/zscore.py ─────┤  (existing)
                          │
                          └─→ alert-ingestor (server action / nightly cron) ──┐
                                                                              │
ml/anomaly/price.py (NEW residual-based price detector) ──────────────────────┤
                                                                              │
Harri delta jobs (existing) ──→ alert-ingestor (Phase 3 dual-write) ──────────┤
                                                                              ▼
                                                                       ┌──────────────┐
                                                                       │   Alert      │
                                                                       │ (new table)  │
                                                                       └──────┬───────┘
                                                                              │
                          /dashboard/alerts inbox  ◄───── AlertPreference ────┤
                          + per-page banners (read same source)        per-(account, target, severity, channel)
```

**Why a separate `Alert` table instead of extending `AnomalyEvent`:** `AnomalyEvent` is an ML detection record (residual, zScore, method); `Alert` is a UX object (severity, snoozed, dismissed, source). Non-anomaly sources (Harri thresholds during dual-write) can also write `Alert` rows without polluting the ML detection record.

## Data model

### `Alert`
| Field | Type | Notes |
|---|---|---|
| id | String @id @default(cuid) | |
| storeId | String | FK Store, indexed |
| source | enum AlertSource | `ANOMALY_EVENT`, `PRICE_DELTA`, `HARRI_VARIANCE`, `QUANTITY_SPIKE`, `NEW_PRODUCT` |
| anomalyEventId | String? | FK AnomalyEvent, nullable (only for `ANOMALY_EVENT` source) |
| target | enum AlertTarget | mirrors AnomalyTarget + `PRICE`, `PRODUCT` |
| targetId | String? | menu item / ingredient / vendor / null |
| severity | enum AlertSeverity | `INFO`, `WATCH`, `CRITICAL` — derived from z-score band or delta % |
| title | String | short user-facing line |
| body | String? | optional longer text |
| metadata | Json | source-specific payload (residual, %change, etc.) |
| occurredOn | Date | the business date the event refers to |
| detectedAt | DateTime @default(now) | when the row was created |
| status | enum AlertStatus | `OPEN`, `ACKNOWLEDGED`, `DISMISSED`, `EXPLAINED` |
| acknowledgedAt | DateTime? | |
| explanation | String? | |
| dedupeKey | String | `<source>:<storeId>:<target>:<targetId>:<occurredOn>` — unique constraint to make ingestion idempotent |

Indexes: `(storeId, status, occurredOn DESC)`, unique `(dedupeKey)`.

### `AlertPreference`
| Field | Type | Notes |
|---|---|---|
| id | String @id @default(cuid) | |
| accountId | String | FK Account, indexed |
| storeId | String? | null = applies to all stores in account |
| target | enum AlertTarget? | null = applies to all targets |
| minSeverity | enum AlertSeverity | mute anything below this |
| muted | Boolean @default(false) | hard mute |
| channels | String[] | `IN_APP` always; future `EMAIL`, `SMS` |
| updatedAt | DateTime @updatedAt | |

Unique `(accountId, storeId, target)` with NULLs treated as "global".

## Severity derivation

| Source | Rule |
|---|---|
| `ANOMALY_EVENT` z-score | `|z| ≥ 4` → CRITICAL · `|z| ≥ 2.5` → WATCH · else INFO |
| `PRICE_DELTA` | `|%Δ| ≥ 25` → CRITICAL · `|%Δ| ≥ 12` → WATCH · else dropped (no INFO row — replaces the existing `>15` static rule with residual-aware logic in Phase 2) |
| `HARRI_VARIANCE` | matches existing Harri severity strings during dual-write |
| `QUANTITY_SPIKE` / `NEW_PRODUCT` | INFO/WATCH per existing logic during dual-write |

## Phased delivery

This is too big for one PR. Three phases, each independently shippable.

### Phase 1 — Foundation + revenue alerts (this session)
- Prisma: add `Alert`, `AlertPreference`, enums.
- Manual migration SQL under `prisma/manual-migrations/`.
- `src/app/actions/alerts/` — server actions: `listAlerts`, `acknowledgeAlert`, `dismissAlert`, `ingestFromAnomalyEvents`.
- `src/app/dashboard/alerts/page.tsx` — editorial inbox view (paper + hairline-bold panels, `.inv-row` hover, severity proofmark in red).
- Backfill: on first deploy, the ingestor scans existing `AnomalyEvent.OPEN` rows and produces `Alert` rows once (idempotent via `dedupeKey`).
- Wire into `ml-nightly.yml` as a post-step (TS call after Python finishes).
- Sidebar nav entry.

### Phase 2 — Price detector + product-usage migration
- New `ml/anomaly/price.py` — residual-based per-(store, ingredient, vendor) detector replacing the static `|%Δ| > 15` rule. Emits `Alert` rows directly (source = `PRICE_DELTA`).
- `AlertsBanner` switches from `PriceAlert[]`/`OrderAnomaly[]` props to reading `Alert[]` for the relevant store + target filter. Old props become read-only fallbacks behind an env flag for one release.
- After parity is observed in production (≥ 50% volume drop confirmed via a query in the spec), delete the static-threshold path.

### Phase 3 — Harri + preferences UI
- Harri alert source dual-writes during cron.
- `/dashboard/settings/notifications` extends to manage `AlertPreference` per store × target.
- Decommission `getHarriAlerts` inline path; labor page reads from the same `Alert` store.

## Migration / dual-write contract

- **Phase 1 is additive** — old surfaces still work unchanged. New inbox is the only new read path.
- **Phase 2** introduces dual-write for price/usage. Both old banner and new inbox show the same items because the banner reads from `Alert`.
- **Phase 3** removes the old write paths once the verification gate is met.

## Tests

- `Alert.dedupeKey` uniqueness prevents double-ingest.
- Backfill from existing `AnomalyEvent.OPEN` is idempotent on rerun.
- Severity classification table (input z-score → expected severity).
- Server action authorization (`storeId` must be in caller's account).
- Phase 2: contract test — given the same input dataset, the new price detector emits ≤ 50% of the rows the static rule emitted, and every critical-severity output is also flagged by the static rule (no missed incidents).
- E2E (Playwright): inbox renders, acknowledge flow updates status, preferences filter respected.

## Verification gate

Same as the issue:
- Existing static alerts replaced.
- Alert volume drops ≥ 50% with no real-incidents missed (measured across a 14-day window after Phase 2 ships).

## Out of scope

- Email/SMS delivery channels (modeled in `AlertPreference.channels` but not implemented).
- ML-learned thresholds beyond rolling z-score (per-DOW Bayesian noise band could be a follow-up; the current per-(store, target) z-score is sufficient for the verification gate).
- Acknowledge-with-explanation flows beyond what already exists for `AnomalyEvent`.

## Files touched (Phase 1 only)

Create:
- `prisma/manual-migrations/2026-05-18_smart_contextual_alerts.sql`
- `src/app/actions/alerts/index.ts`
- `src/app/dashboard/alerts/page.tsx`
- `src/app/dashboard/alerts/components/alerts-inbox.tsx`
- `src/app/dashboard/alerts/lib/ingestion.ts` (the ingestor; called from server actions + nightly)
- `src/app/api/cron/alerts-ingest/route.ts` (POST endpoint hit by the nightly workflow)
- `.github/workflows/ml-nightly.yml` — append a post-step that POSTs to the ingest endpoint

Modify:
- `prisma/schema.prisma` — add 3 models + 4 enums
- `src/components/app-sidebar.tsx` (or wherever nav lives) — add Alerts link
