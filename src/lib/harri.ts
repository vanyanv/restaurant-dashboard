/**
 * Harri (LiveWire) API client.
 *
 * Auth: AWS Cognito Bearer JWT (NOT session cookies). Access tokens last
 * 30 minutes; refresh tokens last 30+ days. See docs/harri-api-notes.md
 * for the full endpoint catalog and response shapes.
 *
 * Env vars:
 *   HARRI_REFRESH_TOKEN — long-lived; required for cron/backfill
 *   HARRI_JWT          — short-lived bearer override; optional, used if
 *                        present and not near expiry (handy for ad-hoc scripts)
 *   HARRI_COGNITO_CLIENT_ID — Cognito user-pool client id (default below)
 *   HARRI_COGNITO_USER_POOL_REGION — defaults to us-east-1
 */

const HARRI_BASE = "https://gateway.harri.com"

const HARRI_HEADERS: Record<string, string> = {
  accept: "*/*",
  origin: "https://harri.com",
  referer: "https://harri.com/",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
}

const COGNITO_CLIENT_ID = process.env.HARRI_COGNITO_CLIENT_ID || "7rbq1fkugjphupo0ujb1qetuar"
const COGNITO_REGION = process.env.HARRI_COGNITO_USER_POOL_REGION || "us-east-1"
const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`

// ---------------------------------------------------------------------------
// JWT cache + refresh
// ---------------------------------------------------------------------------

let cachedJwt: string | null = null
let cachedJwtExp = 0 // unix seconds

function decodeJwtExp(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString())
    return payload.exp ?? 0
  } catch {
    return 0
  }
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = process.env.HARRI_REFRESH_TOKEN
  if (!refreshToken) {
    throw new Error(
      "Harri auth requires either HARRI_JWT or HARRI_REFRESH_TOKEN. Grab the refresh token " +
        "from browser localStorage at CognitoIdentityServiceProvider.<clientId>.<userId>.refreshToken " +
        "and set HARRI_REFRESH_TOKEN."
    )
  }

  const res = await fetch(COGNITO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      Origin: "https://harri.com",
    },
    body: JSON.stringify({
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Harri Cognito refresh failed (${res.status}): ${text.slice(0, 400)}`)
  }

  const data = (await res.json()) as {
    AuthenticationResult?: { AccessToken?: string }
    __type?: string
    message?: string
  }
  const access = data.AuthenticationResult?.AccessToken
  if (!access) {
    throw new Error(
      `Harri Cognito refresh response missing AccessToken: ${JSON.stringify(data).slice(0, 300)}`
    )
  }

  cachedJwt = access
  cachedJwtExp = decodeJwtExp(access)
  return access
}

export async function getHarriJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  // 1. Static env override takes priority unless near expiry (5-min buffer).
  const envJwt = process.env.HARRI_JWT
  if (envJwt) {
    const exp = decodeJwtExp(envJwt)
    if (exp === 0 || exp - now > 300) return envJwt
    if (cachedJwt && cachedJwtExp - now > 300) return cachedJwt
    // fall through to refresh
  }

  // 2. Cached JWT still good?
  if (cachedJwt && cachedJwtExp - now > 300) return cachedJwt

  // 3. Refresh via Cognito.
  return refreshAccessToken()
}

// ---------------------------------------------------------------------------
// Day boundary
// ---------------------------------------------------------------------------

/**
 * Harri's business day runs T05:30:00.000Z → T05:30:00.000Z + 1d (≈ 1:30 AM EDT cutoff).
 * Use this for any range-style endpoint to avoid straddling two of Harri's days.
 */
export function harriDayBounds(date: Date): { from: string; to: string } {
  const d = new Date(date)
  d.setUTCHours(5, 30, 0, 0)
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + 1)
  return { from: d.toISOString(), to: next.toISOString() }
}

/** Format a Date as YYYY-MM-DD in UTC (used by alerts + positions/pay_types endpoints). */
export function harriDateStr(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Harri's hourly-anchor ISO timestamp. The labor stats endpoints accept any
 * ISO instant; we use 14:00 UTC (mid-business-day) as a stable anchor.
 */
export function harriDayAnchorISO(date: Date): string {
  const d = new Date(date)
  d.setUTCHours(14, 0, 0, 0)
  return d.toISOString()
}

/** Inclusive UTC day-stepping iterator (matches getDateRange in src/lib/otter.ts). */
export function harriDateRange(start: Date, end: Date): Date[] {
  const out: Date[] = []
  const cur = new Date(start)
  cur.setUTCHours(0, 0, 0, 0)
  const stop = new Date(end)
  stop.setUTCHours(0, 0, 0, 0)
  while (cur <= stop) {
    out.push(new Date(cur))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

export function buildLaborActualUrl(brandId: number, date: Date): string {
  const params = new URLSearchParams({
    relative_to_now: "false",
    date: harriDayAnchorISO(date),
  })
  return `${HARRI_BASE}/lpm-api/api/v1/brands/${brandId}/stats/labor?${params}`
}

export function buildLaborForecastUrl(brandId: number, date: Date): string {
  const params = new URLSearchParams({
    relative_to_now: "false",
    date: harriDayAnchorISO(date),
  })
  return `${HARRI_BASE}/lpm-api/api/v1/brands/${brandId}/stats/labor/forecast?${params}`
}

export function buildLaborCategoriesUrl(brandId: number, date: Date): string {
  const params = new URLSearchParams({ date: harriDayAnchorISO(date) })
  return `${HARRI_BASE}/lpm-api/api/v1/brands/${brandId}/stats/labor/categories?${params}`
}

export function buildPositionsPayTypesUrl(
  brandId: number,
  fromDate: Date,
  toDate: Date
): string {
  const params = new URLSearchParams({
    from_date: harriDateStr(fromDate),
    to_date: harriDateStr(toDate),
  })
  return (
    `${HARRI_BASE}/lpm-api/api/v1/brands/${brandId}/stats/labor/categories/positions/pay_types?${params}`
  )
}

export function buildTimekeepingAlertsUrl(brandId: number, day: Date): string {
  const params = new URLSearchParams({ day: harriDateStr(day) })
  return `${HARRI_BASE}/timekeeping-alert/api/v1/brands/${brandId}/alerts?${params}`
}

export function buildTeamUsersUrl(brandId: number, userIds: number[]): string {
  const params = new URLSearchParams({ user_ids: userIds.join(",") })
  return `${HARRI_BASE}/team/api/v3/brands/${brandId}/users?${params}`
}

// Subset of /team/api/v3 user payload — we only persist the display fields.
// The full response also returns positions, employment_periods, profile_image,
// pay_types, etc. — left out intentionally; payroll detail is a separate scope.
export type HarriUser = {
  id: number
  employee_id?: number | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  status?: string | null
}

// ---------------------------------------------------------------------------
// Fetcher with retry + auto-refresh on 401
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000

export async function harriFetch<T>(url: string): Promise<T> {
  let jwt = await getHarriJwt()

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    let response: Response
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { ...HARRI_HEADERS, authorization: `Bearer ${jwt}` },
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Harri API request timed out after 30s: ${url}`)
      }
      throw err
    }
    clearTimeout(timeout)

    if (response.status === 401 && attempt < MAX_RETRIES) {
      // Stale JWT — burn the cache and refresh.
      cachedJwt = null
      cachedJwtExp = 0
      jwt = await refreshAccessToken()
      continue
    }

    if ((response.status === 403 || response.status === 429) && attempt < MAX_RETRIES) {
      const backoff = RETRY_BASE_MS * attempt
      console.log(
        `Harri API ${response.status} — retrying in ${backoff / 1000}s (attempt ${attempt}/${MAX_RETRIES})`
      )
      await new Promise((r) => setTimeout(r, backoff))
      continue
    }

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Harri API error ${response.status}: ${text.slice(0, 400)}`)
    }

    return (await response.json()) as T
  }

  throw new Error("Harri API: max retries exceeded")
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type HarriEnvelope<T> = { data: T; status: string; status_code: number }

export type HarriLaborTotal = { total_labor_cost: number; date: string }

export type HarriLaborCategory = {
  id: number
  name: string
  code: string
  total_labor_cost: number
}

export type HarriLaborCategoriesResponse = {
  total_labor_cost: number
  categories: HarriLaborCategory[]
  date: string
}

export type HarriPositionCost = {
  bonus_amount?: number
  net_amount?: number
  overtime_amount?: number
  ni_amount?: number
  pension_amount?: number
  additional_cost_amount?: number
  penalties_amount?: number
  right_to_rest_amount?: number
  holiday_accruals_amount?: number
}

export type HarriHourlyPosition = {
  cost: HarriPositionCost
  total_shift_count: number
  total_shift_weights: number
  user_ids: number[]
  actual_seconds: number
  total_labor: number
}

export type HarriSalariedPosition = {
  total_shift_count: number
  user_ids: number[]
  actual_seconds: number
  cost: HarriPositionCost
  total_labor: number
}

export type HarriPosition = {
  code: string
  name: string
  hourly?: HarriHourlyPosition
  salaried?: HarriSalariedPosition
}

export type HarriCategory = { code: string; name: string; positions: HarriPosition[] }

export type HarriDayBreakdown = { date: string; categories: HarriCategory[] }

export type HarriPositionsPayTypesResponse = { days: HarriDayBreakdown[] }

export type HarriAlert = {
  id: number
  brand_id: number
  employee_id: number
  user_id: number
  position: {
    id: number
    code: string
    name: string
    category: { id: number; code: string; name: string }
  }
  alert_time: string
  alert_type: { id: number; code: string }
  extra_info: { time_diff?: number; missed_clock_at?: string } | null
}

export type HarriAlertsResponse = { alerts: HarriAlert[] }

// Cents → dollars at the persistence layer.
export const CENTS_TO_USD = 100

/** Convert Harri's native cents value (sometimes a fraction) to USD. Returns null for null/undefined. */
export function harriCentsToUSD(v: number | null | undefined): number | null {
  if (v == null) return null
  return v / CENTS_TO_USD
}
