# Backup and restore

## Where the backups are

- **What:** a `pg_dump` of the production database in custom format
  (`--format=custom --compress=9 --no-owner --no-privileges`), made with the
  same major version of `pg_dump` as the server.
- **Where:** the private R2 bucket the app already uses (`R2_BUCKET_NAME`),
  under `backups/db/YYYY-MM-DD.dump` (UTC date).
- **How often:** nightly at 09:10 UTC, by `.github/workflows/db-backup.yml`
  (`.github/scripts/db-backup.sh`). It can also be run by hand from the Actions
  tab (`workflow_dispatch`).
- **Kept:** the newest 30. Each run deletes older `backups/db/*.dump` objects.
- **Watched:** each run records a `db.backup` JobRun. The staleness check
  flags it when no run has been recorded for a while. A failed run opens a
  `[Auto] DB Backup failing` issue.
- **Not covered:** R2 objects such as invoice PDFs. Those live in R2 and are not
  in the dump. Neon's own point-in-time restore window is a separate,
  shorter-term safety net. This file covers the off-Neon copy.

The repository is public, so the dump is never uploaded as a GitHub artifact
and the job never prints the connection string. Keep it that way.

The workflow needs these GitHub repository secrets: `DATABASE_URL`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, and either
`R2_ENDPOINT` or `R2_ACCOUNT_ID`. These are the names `src/lib/blob.ts` reads
on Vercel.

## Restoring: always into a NEW Neon branch, never over production

1. **Pick the dump.** List `backups/db/` in the R2 dashboard, or run
   `aws --endpoint-url https://<account>.r2.cloudflarestorage.com s3 ls s3://<bucket>/backups/db/`.
   Download the date you want to a local machine, not to a CI runner.
2. **Create an empty Neon branch** in the Neon console (or
   `neonctl branches create --name restore-YYYY-MM-DD`). Do not branch from
   production's current state: choose an empty branch or a new database on
   it. Copy that branch's **direct** connection string, the host without
   `-pooler`.
3. **Check that the string is NOT production** before running anything. The
   host must be the new branch's endpoint. Never paste the production
   `DATABASE_URL` into a restore command.
4. **Restore** with a `pg_restore` of the same major version as the dump
   (`pg_restore --version`):

   ```bash
   pg_restore --no-owner --no-privileges --exit-on-error \
     --dbname "<new-branch-direct-url>" YYYY-MM-DD.dump
   ```

5. **Verify** on the branch: row counts of the big tables (`OtterOrder`,
   `OtterDailySummary`, `HarriDailyLabor`, `Invoice`) look close to
   production's, and the newest `OtterDailySummary.date` is the day before
   the dump.
6. **Use it.** To read old data, query the branch. To replace production
   after a disaster, use Neon's console to make the restored branch the
   primary branch, or point Vercel's `DATABASE_URL` at it. Do this only after
   step 5 passes, and with the owner's go. Never `pg_restore` into the live
   production database.
7. Delete the branch when you are done with it.

## How often to test a restore

- **Monthly:** restore the newest dump into a throwaway Neon branch (steps
  1–5), then delete the branch. A backup nobody has restored is only a
  hope.
- **After any Postgres major-version upgrade on Neon:** test once straight
  away. The job installs the matching `pg_dump` automatically. This test
  confirms that worked.
- Write the date and the result (tables and rows checked) in the ops notes.
