# Two-database setup — keep them in sync

> **Read this before any `prisma db push` or schema change.** This project
> writes to **two** Postgres databases that share a single
> `prisma/schema.prisma`. If you push to one and forget the other, the
> chat layer breaks at runtime with confusing errors like
> `column "(not available)" does not exist`.

## The two databases

| Env var | Branch / role | What lives there |
|---|---|---|
| `DATABASE_URL` | **Primary** Neon branch (`ep-spring-bar-…`) | Source of truth for the dashboard. All app reads & writes go here through `src/lib/prisma.ts`. Has Conversation/Message/ToolCall tables but the rows are empty — the chat layer doesn't read from this DB. |
| `DATABASE_URL2` | **Chat / vector** Neon branch (`ep-noisy-wave-…`) | Dedicated to the chat layer. Holds all `*Embedding` rows (~1k vectors), pgvector extension, **and a clone of the source data** (Invoice, OtterOrder, Recipe, etc.) so the chat tools can JOIN embeddings → source rows in one DB. Accessed via `src/lib/chat/prisma-chat.ts`. |

Why split: pgvector workloads (HNSW similarity search) are isolated from
dashboard reads, and the chat DB can be rebuilt/wiped without touching
the dashboard. Don't collapse them — you'd lose the embeddings.

## The contract

Both DBs must always match `prisma/schema.prisma`. There is **one schema
file**, **two `prisma db push` / `db execute` targets**.

### When you change the schema

1. Edit `prisma/schema.prisma` as usual.
2. Apply to **both** DBs in the same change:

   ```bash
   # Primary (the default — uses prisma.config.ts)
   npx prisma db push

   # Chat / vector branch — override DATABASE_URL inline
   DATABASE_URL="$DATABASE_URL2" npx prisma db push
   ```

3. If `db push` complains that an `ADD COLUMN NOT NULL` would lose data
   on the chat branch (it has real rows), don't pass
   `--accept-data-loss`. Instead write a hand-crafted SQL migration in
   `prisma/manual-migrations/` using the
   `ADD COLUMN ... NOT NULL DEFAULT '<value>'` → `DROP DEFAULT` pattern,
   then apply it to the chat branch with
   `DATABASE_URL="$DATABASE_URL2" npx prisma db execute --file <path>`.
   See [`prisma/manual-migrations/2026-04-30_chat_db_multi_tenant_sync.sql`](../prisma/manual-migrations/2026-04-30_chat_db_multi_tenant_sync.sql)
   for the canonical template.

### Verify both DBs match the schema

This is the one-shot drift check — run it any time you suspect the two
DBs have diverged, and as the last step of every schema change:

```bash
# Primary
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma

# Chat / vector
DATABASE_URL="$DATABASE_URL2" npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma
```

Both must print **`No difference detected.`** If either prints a diff,
that DB is out of sync — the diff itself is the SQL you need to apply.
Pipe `--script` to capture it:

```bash
DATABASE_URL="$DATABASE_URL2" npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script \
  > /tmp/chat-drift.sql
```

`migrate diff` is **read-only** — it never modifies the DB.

## Symptoms of drift

| Symptom | What's likely wrong |
|---|---|
| `column "(not available)" does not exist` from a chat-page query | A column was added to the schema and pushed to primary, but not to `DATABASE_URL2`. Re-run `db push` against the chat branch. |
| Type errors after `prisma generate` complaining about new fields | Generated client is from the schema; one DB is behind. Run the verify step above. |
| Cron / monitoring writes succeed but chat tools error | Monitoring writes use the primary client; chat uses `chatPrisma` against URL2. The monitoring tables (DbSnapshot/JobRun/AiUsageEvent/CacheStat/ErrorEvent/ChatTurn) need to exist on URL2 too — the schema requires it even though chat code may not query them. |

## Things that only live on the chat branch

These can't be regenerated without cost / time, so never wipe URL2
casually:

- All `*Embedding` rows (`InvoiceLineEmbedding`, `MenuItemEmbedding`,
  `RecipeEmbedding`, `CanonicalIngredientEmbedding`,
  `PnlNarrativeEmbedding`) — re-embedding them costs OpenAI calls.
- The HNSW indexes documented in
  [`prisma/manual-migrations/2026-04-28_chat_layer_pgvector.sql`](../prisma/manual-migrations/2026-04-28_chat_layer_pgvector.sql).
  These are NOT in the schema (Prisma can't express HNSW); they live
  only on URL2 and must be re-applied manually after any
  `prisma db push` that recreates the embedding tables.

## Manual migrations directory

`prisma/manual-migrations/*.sql` is the canonical record of changes that
`prisma db push` can't or shouldn't make on its own (extension enables,
HNSW indexes, data-preserving column additions on populated tables).
File naming: `YYYY-MM-DD_short_slug.sql`. Each file should be
**idempotent** (`CREATE … IF NOT EXISTS`, `DO $$ ... EXCEPTION` blocks
around constraint adds) so re-running is safe.

## Quick reference — common commands

```bash
# Primary DB
npx prisma db push
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
npx prisma db pull --print                # introspect, read-only

# Chat / vector DB — same commands, with DATABASE_URL overridden
DATABASE_URL="$DATABASE_URL2" npx prisma db push
DATABASE_URL="$DATABASE_URL2" npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma
DATABASE_URL="$DATABASE_URL2" npx prisma db pull --print
DATABASE_URL="$DATABASE_URL2" npx prisma db execute --file <path>
```

## For Claude / future agents

Before you change `prisma/schema.prisma`:

- [ ] Is this change schema-only? If yes, the rule is: every push to
      one DB needs the equivalent push to the other.
- [ ] Will it add a NOT NULL column to a populated table? On the chat
      branch most tables ARE populated. Plan a manual migration with
      the `DEFAULT '…' → DROP DEFAULT` pattern.
- [ ] After applying changes, run **both** `migrate diff` commands and
      confirm both print `No difference detected.` Treat this as the
      definition of "done."
