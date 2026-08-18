# Harri API — reverse-engineered notes

Reference for the `src/lib/harri.ts` client and `src/lib/harri-labor-sync.ts` runner. Every detail below was confirmed against live calls on **2026-05-09** (HAR captures + curl). Update this file when you discover new endpoints or the schema shifts.

---

## Auth

- **Type:** AWS Cognito Bearer JWT (NOT session cookies, despite first-pass HAR analysis suggesting otherwise — Chrome's "save HAR" was hiding the `authorization` header at the time)
- **Issuer:** `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Ggpbqc92e`
- **Client ID:** `7rbq1fkugjphupo0ujb1qetuar`
- **Token lifetime:** 30 minutes (`exp - iat = 1800s`)
- **Refresh:** standard Cognito refresh-token flow against `https://cognito-idp.us-east-1.amazonaws.com/` with `X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth`, body:
  ```json
  {
    "AuthFlow": "REFRESH_TOKEN_AUTH",
    "ClientId": "7rbq1fkugjphupo0ujb1qetuar",
    "AuthParameters": { "REFRESH_TOKEN": "<refresh-token>" }
  }
  ```
  Refresh tokens are long-lived (Cognito default 30 days; configurable). Response contains a fresh `AccessToken`.

### Env vars used by the integration

- `HARRI_JWT` — short-lived bearer. Optional; takes priority if not near expiry. Useful for scripts/CI where a manually-pasted token is fine.
- `HARRI_REFRESH_TOKEN` — long-lived refresh token grabbed from browser localStorage at `CognitoIdentityServiceProvider.7rbq1fkugjphupo0ujb1qetuar.<userId>.refreshToken`. Used by production cron to mint fresh access tokens.

If both are present and `HARRI_JWT` is fresh enough, the static one is used; otherwise `HARRI_REFRESH_TOKEN` produces a new bearer.

---

## Brand IDs (multi-store)

Harri uses parent → child brand hierarchy. Each child brand corresponds to **one physical store**.

| Brand ID | Role | Use for |
|---|---|---|
| `5756975` | Parent — "Chris N Eddy's LLC" | `account_suspension/check`, `rum_settings`, billing scope |
| `5756969` | Child — first operations brand confirmed | All labor/timekeeping/team data for that location |
| `5756968` | Group | User-policy scope (not used by sync) |

**Mapping table** (`HarriBrand` model): `Store.id` → `brandId: Int`. To populate for additional stores (e.g., Hollywood vs. another), have an admin switch LiveWire to that store, capture a single `gateway.harri.com` request — the `brand_id` in the URL identifies the location.

---

## Endpoints (all `gateway.harri.com`, all GET)

Required headers on every request:

```
authorization: Bearer <jwt>
accept: */*
origin: https://harri.com
referer: https://harri.com/
user-agent: Mozilla/5.0 ... Chrome/148.0.0.0 Safari/537.36
```

### Day boundary

Harri's "business day" runs `T05:30:00.000Z` → `T05:30:00.000Z+1d` (≈ 1:30 AM EDT cutoff). Use this for any date-range queries — using midnight UTC will straddle two of Harri's days.

### 1. Daily labor — actual

```
GET /lpm-api/api/v1/brands/{brandId}/stats/labor?relative_to_now=false&date={ISO8601}
```

Response:
```json
{ "data": { "total_labor_cost": 127987.5, "date": "2026-05-08T14:00:00.000Z" }, "status": "SUCCESS", "status_code": 200 }
```

`total_labor_cost` is in **cents** (USD × 100). Verified by cross-checking endpoint #5: Line Cook `total_labor: 81214` cents over `actual_seconds: 146100` (40.58 hrs) = $20.01/hr — matches realistic line-cook pay. Divide by 100 at the persistence layer.

### 2. Daily labor — forecast

```
GET /lpm-api/api/v1/brands/{brandId}/stats/labor/forecast?relative_to_now=false&date={ISO8601}
```

Same shape as #1. Represents the budgeted/scheduled cost.

### 3. Daily labor — by category

```
GET /lpm-api/api/v1/brands/{brandId}/stats/labor/categories?date={ISO8601}
```

Response:
```json
{
  "data": {
    "total_labor_cost": 127987.5,
    "categories": [
      { "id": 3, "name": "Quick Service", "code": "QS", "total_labor_cost": 127987.5 }
    ],
    "date": "2026-05-08T14:00:00.000Z"
  },
  "status": "SUCCESS"
}
```

For Chris N Eddy's, only `QS` (Quick Service) is currently active. Persist the full categories array as JSON.

### 4. Positions × pay_types (richest endpoint)

```
GET /lpm-api/api/v1/brands/{brandId}/stats/labor/categories/positions/pay_types?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
```

Returns per-day, per-category, per-position cost breakdown. **Note**: dates here are plain `YYYY-MM-DD` (not ISO with time).

Shape (truncated):
```json
{
  "data": {
    "days": [
      {
        "date": "2026-04-27",
        "categories": [
          {
            "code": "QS",
            "name": "Quick Service",
            "positions": [
              {
                "code": "line-cook-5",
                "name": "Line Cook",
                "hourly": {
                  "cost": {
                    "bonus_amount": 0.0,
                    "net_amount": 80426.66,
                    "overtime_amount": 787.5,
                    "ni_amount": 0.0,
                    "pension_amount": 0.0,
                    "additional_cost_amount": 0.0,
                    "penalties_amount": 0.0,
                    "right_to_rest_amount": 0.0,
                    "holiday_accruals_amount": 0.0
                  },
                  "total_shift_count": 6,
                  "total_shift_weights": 6.0,
                  "user_ids": [2674212, 1356102, 488841, 3125965, 2194772, 3126261],
                  "actual_seconds": 146100,
                  "total_labor": 81214.16
                }
              }
            ]
          },
          {
            "code": "MANAGE",
            "name": "Management",
            "positions": [
              {
                "code": "operator",
                "name": "Operator",
                "salaried": { "total_shift_count": 0, "user_ids": [], "actual_seconds": 0, "cost": {…}, "total_labor": 0.0 }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

- All cost values in **cents**.
- Hourly positions have a `hourly` block; salaried positions have a `salaried` block (different cost shape — no `right_to_rest_amount`/`penalties_amount`).
- `total_labor` is the sum of all cost amounts and matches what feeds the daily `total_labor_cost` from endpoint #1.
- `user_ids` is the de-duped list of employees who worked that position that day. Use it for "who worked" analytics; resolve to names via endpoint #6.

### 5. Timekeeping alerts (clock-in/out anomalies)

```
GET /timekeeping-alert/api/v1/brands/{brandId}/alerts?day=YYYY-MM-DD
```

Response:
```json
{ "data": { "alerts": [
  {
    "id": 258569269,
    "brand_id": 5756969,
    "employee_id": 631692,
    "user_id": 1277425,
    "position": { "id": 6104, "code": "line-cook-5", "name": "Line Cook",
                  "category": { "id": 3, "code": "QS", "name": "Quick Service" } },
    "alert_time": "2026-05-08T07:28:34.000000Z",
    "alert_type": { "id": 1, "code": "EARLY_CLOCK_IN" },
    "extra_info": { "time_diff": 5220 }
  }
]}}
```

**Alert type catalog** (confirmed from live data):

| id | code | extra_info |
|----|------|------------|
| 1 | `EARLY_CLOCK_IN` | `time_diff` (seconds early) |
| 2 | `EARLY_CLOCK_OUT` | `time_diff` (seconds early) |
| 3 | `LATE_CLOCK_IN` | `time_diff` (seconds late) |
| 4 | `LATE_CLOCK_OUT` | `time_diff` (seconds late) |
| 5 | `UNSCHEDULED_CLOCK_IN` | `null` |
| 6 | `MISSED_CLOCK_IN` | `missed_clock_at` (ISO) |
| 8 | `MISSED_CLOCK_OUT_OT_NOW` | `missed_clock_at` (ISO) |

`time_diff` unit is **seconds**. Real-world examples seen: 5220s = 87 min early; 17580s = 4hr 53min late.

Upsert key: `id` (Harri's alert UUID).

### 6. Employee directory (resolve user_ids → names)

```
GET /team/api/v3/brands/{brandId}/users?user_ids=ID1,ID2,...
```

Bulk fetch up to ~10 users per call. Returns `{ data: [{ id, first_name, last_name, email, phone, positions, employment_periods, user_pay_types: [{ type: "HOURLY"|"SALARIED" }], harri_user_id, status, profile_image, … }] }`.

**Note**: `user_pay_types[].type` is exposed but the **actual hourly rate is not** in this response — likely behind a separate payroll endpoint requiring an HR-role session. v1 derives effective hourly rate from `total_labor / (actual_seconds / 3600)` in endpoint #4 instead.

---

## Endpoints that returned empty (skip)

These look interesting but returned `data: []` for live dates — Harri likely doesn't have POS sales integrated:

- `/lpm-stats/api/v2/brands/{id}/stats/actual?from_date=&to_date=`
- `/lpm-stats/api/v2/brands/{id}/stats/forecast?from_date=&to_date=&relative_to_now=false`
- `/lpm-stats/api/v1/brands/{id}/stats/sales/items?date=`
- `/lpm-stats/api/v1/brands/{id}/stats/sales/employees?date=`

We don't need these — Otter is the source of truth for sales.

---

## Auth recovery — what to do when sync starts 401-ing

1. First check: is `HARRI_REFRESH_TOKEN` env var still populated? If not, set it.
2. If populated, the refresh token itself probably expired (Cognito default is 30 days). Recapture from browser:
   - Log into harri.com → F12 → Application → Local Storage → `https://harri.com`
   - Find key matching `CognitoIdentityServiceProvider.7rbq1fkugjphupo0ujb1qetuar.<userId>.refreshToken`
   - Copy the value, update Vercel env var.
3. If refresh works but specific endpoints 403: Cognito access token is fine, but the user's role lacks permission for that endpoint. Verify `core-reader/.../groups/{groupId}/users/policy` includes the relevant service flag (e.g., `TEAM_SCHEDULING`, `PAYROLL`).

---

## Addendum — 2026-08-18 probe session

Confirmed against live calls on **2026-08-18**. Three findings, one of which is a
standing data-loss bug.

### 7. BUG: `positions/pay_types` needs a **Monday-anchored, single-week** range

`src/lib/harri-labor-sync.ts` calls the endpoint once per day with
`from_date === to_date`. That only succeeds when the day happens to be a Monday;
every other day returns **500**. The failures are swallowed by the
`console.warn` at `harri-labor-sync.ts:141`, so the sync reports success while
writing ~1/7 of the rows. As of this probe `HarriPositionDaily` held **15 dates,
every one a Monday** — i.e. `actualSeconds` (our only source of labor *hours*)
was ~8% complete.

Empirically derived range rule:

| `from_date` | span | result |
|---|---|---|
| Monday | 1 day | ✅ 200 |
| Monday | 2–7 days (through Sun) | ✅ 200, one entry per day |
| Monday | 8+ days | ❌ 400 |
| any non-Monday | any | ❌ 500 |

**So: one call per ISO week, `from_date` = Monday, `to_date` = that Sunday.**
A `Mon..Sun` call returns all 7 days in a single response.

Verified data depth: weeks resolve back to at least **2025-02-17**, so a full
18-month hours backfill is ~78 calls.

### 8. Scheduling — shift-level start/end times (NEW)

```
GET /scheduling/api/v1/brands/{brandId}/schedule?week={date}
```

**Date format is `%b %d, %Y`** — e.g. `Aug 10, 2026` (URL-encoded). ISO dates are
rejected with `{"field":"week","error":"Incorrect date format, should be %b %d, %Y"}`.
Accepted params (per the endpoint's own 400 body): `week`, `days`, `dates`,
`from_day`, `to_day`. `week` = the Monday; returns the whole week (~66 KB).

Shape:

```
data.schedule[]                       // one per week
  .id .start_date .status .publish_time .lock_status
  .roles[]
    .position { id, name, code, color, category { id, name, code } }
    .role_days[]
      .date                           // "Aug 10, 2026"
      .assignees[]
        .user_id                      // null when type === "VIRTUAL" (unfilled slot)
        .type                         // "USER" | "VIRTUAL"
        .assignee_shifts[]
          .start_time                 // "Aug 10, 2026 09:00"  (local wall-clock)
          .end_time                   // "Aug 11, 2026 01:00"  (may cross midnight)
          .status .weight .breaks[] .day_parts[] .revenue_center_id .note
```

~64 shifts / ~440 scheduled hours per week for brand 5756969. `type: "VIRTUAL"`
rows are empty placeholder slots — filter to `type === "USER"` with a non-empty
`assignee_shifts` to get real scheduled labor. Shifts crossing midnight must be
split across dates when bucketing to hours.

This is the first intra-day labor signal available anywhere in the integration —
`HarriDailyLabor` and `HarriPositionDaily` are both daily-grain. Crossing it with
`OtterHourlySummary` yields hour-of-day SPLH.

Scheduled hours reconcile closely with actual: week of Aug 10 was 439.5 scheduled
vs 433.7 actual (endpoint #4), ~1.3% apart.

Future weeks return an empty `schedule[]` until published, so this is a
backward-looking source; don't build forecasting on it.

### 9. Gateway 403 is meaningless — it's the default for unknown services

`/zzz-nonexistent-api/...` and `/totally-made-up/...` both return **403**. Do not
read 403 as "exists but forbidden". The informative signal is **404**, which means
the service name routes but the path is wrong. That is how `/scheduling/` was
found (403 on `scheduling-api`, 404 on `scheduling`).

Service names confirmed to route: `lpm-api`, `lpm-stats`, `timekeeping-alert`,
`team`, `scheduling`, `attendance` (routes, but no working path found yet).

Still not found after sweeping ~40 name/path combinations: raw punches /
timecards / clock-in-out detail, and any wage-rate endpoint.
