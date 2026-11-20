import { describe, expect, it } from "vitest"
import {
  isLocalDatabaseUrl,
  refuseNonLocal,
  refuseRealUsers,
} from "../../scripts/db-guard"

const PROD = "postgresql://user:secret@ep-quiet-sun-123-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require"

describe("db-guard", () => {
  it("allows only a local Postgres by default", () => {
    expect(isLocalDatabaseUrl("postgresql://u:p@localhost:5432/dev")).toBe(true)
    expect(isLocalDatabaseUrl("postgresql://u:p@127.0.0.1/dev")).toBe(true)
    expect(isLocalDatabaseUrl(PROD)).toBe(false)
    expect(isLocalDatabaseUrl("not a url")).toBe(false)
    expect(refuseNonLocal("postgresql://u:p@localhost/dev", {})).toBeNull()
  })

  it("refuses a remote host and never echoes the credentials", () => {
    const reason = refuseNonLocal(PROD, {})
    expect(reason).toContain("ep-quiet-sun-123-pooler.us-west-2.aws.neon.tech")
    expect(reason).not.toContain("secret")
    expect(refuseNonLocal(undefined, {})).toContain("not set")
  })

  it("the explicit override, and only that exact value, lets it through", () => {
    expect(refuseNonLocal(PROD, { ALLOW_DB_RESET: "I_UNDERSTAND" })).toBeNull()
    expect(refuseNonLocal(PROD, { ALLOW_DB_RESET: "yes" })).not.toBeNull()
  })

  it("the seed refuses a database that already holds real users", () => {
    expect(refuseRealUsers(0, {})).toBeNull()
    expect(refuseRealUsers(4, {})).toContain("4 user(s)")
    expect(refuseRealUsers(4, { ALLOW_DB_RESET: "I_UNDERSTAND" })).toBeNull()
  })
})
