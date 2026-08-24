# Deferred Dependency Upgrades

Task 2 (2026-08-23) cleared all non-breaking security advisories, but the following packages have upgrades available that would introduce breaking changes.

| Package | From → To | Why deferred | Blocks |
|---------|-----------|--------------|--------|
| prisma | 7.9.1 → 6.12.0 | Would fix deepmerge-ts stack exhaustion advisory, but requires MAJOR VERSION DOWNGRADE (7→6), which violates modernization direction | None (Task 3–9 upgrades do not touch Prisma); awaits upstream deepmerge-ts fix or Prisma 8.0+ release |
