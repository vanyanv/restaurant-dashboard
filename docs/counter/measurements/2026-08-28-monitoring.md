# Monitoring, measured before it was built

`P.monitoring` (`docs/counter/counter-prototype.html`) against the live
account, 2026-08-28. The shell only; the six tabs behind it are their own
pages.

Unlike inventory or stock counts, this cluster is **well populated** — eleven
tables, none of them empty:

```
   995  AiUsageEvent          555  ExternalSignalSyncRun
   520  ChatTurn              878  LoginEvent
   195  CacheStat              96  R2BucketSnapshot
    93  DbSnapshot             23  ErrorEvent
   151  AnomalyEvent         2045  StoreEventDetailSignal
```

So the page's problem is not missing data. It is that the data says something
the prototype's strip does not.

---

## 1. `Syncs · Healthy` is false, and two independent signals say so

**PredictHQ has failed 21 of 21 runs in the last seven days.** A 100% failure
rate, on a schedule, every store:

| provider | runs 7d | failed | last run |
|---|---:|---:|---|
| **predicthq** | 21 | **21** | 28 Aug 17:39 |
| open-meteo | 21 | 3 | 28 Aug 17:38 |

The errors are a sequence, not noise:

```
 5 x  HTTP 402: {"error": "subscription expired"}
16 x  HTTP 401: {"error": "unauthorized"}
```

The subscription lapsed, then the credential stopped working. That matches
`project_credential_health`'s "PredictHQ dead" — and this is the page where it
should have been visible without anyone remembering it.

open-meteo's 3 failures are all `_ssl.c:993: The handshake operation timed out`
— transient, self-recovering, and a different kind of thing entirely. A page
that shows one failure count for both would flatten a dead integration and a
flaky network into the same number.

## 2. Every error in the feed is the watchdog reporting stale syncs

`ErrorEvent` holds 3 rows in 24 hours and 5 in seven days. Not one is an
application error:

| source | message |
|---|---|
| `cron.staleness` | 5 stale job(s): otter.metrics.sync (overdue), otte… |
| `cron.failure-streak` | Job "otter.metrics.sync" failed 3 times consecutiv… |
| `cron.staleness` | 3 stale job(s): otter.hourly.sync (overdue), invoi… |
| `cron.staleness` | 7 stale job(s): otter.metrics.sync (overdue), otte… |

So the second signal agrees with the first: `otter.metrics.sync` is overdue and
has failed three times running. Two systems that do not know about each other
both report the syncs are unhealthy, and the prototype's cell says "Healthy".

`Errors, 24h · 2 · both handled` becomes a cell that says what the errors ARE,
because "2 errors, handled" and "the sync watchdog has been shouting for a
week" are different pages.

## 3. The other four subsystems are fine and measurable

| | reading |
|---|---|
| Cache hit rate, 7d | **87.4%** (8,582 hits / 1,234 misses, 0 busts, 0 failures) |
| Database | **292 MB**, +1.5 MB/day over the last three snapshots |
| R2 | **84.3 MB**, 298 objects |
| AI spend | **$0.03** in 24h, **$0.31** over 30 days, 23 calls |

The prototype's `Cache hit · 96.2%` is 87.4% here — the real figure, not a
worse one; it is simply what this cache does. AI spend at $0.31 a month is
consistent with `project_credential_health`'s "$5 OpenAI, keep frugal".

`DB · 41 ms · p95 read` has no source: nothing records query latency.
`DbSnapshot` records SIZE, which is a different question, and the cell reports
that instead of inventing a percentile.

---

## What this changes about the build

1. **`Syncs · Healthy` becomes the failure rate**, and names the provider.
2. **A dead integration and a flaky one are counted separately** — 100% and
   14% are not the same fact.
3. **`Errors, 24h` says what they are.** All five are the cron watchdog.
4. **`DB · p95 read` becomes DB size.** No latency is recorded anywhere.
5. **The subsystem table's `Duration` is real** — `ExternalSignalSyncRun`
   carries `durationMs` — but only for providers that ran.
