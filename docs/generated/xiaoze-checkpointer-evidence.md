# Xiaoze Postgres Checkpointer — Local Evidence (2026-06-29)

Redacted local verification for TD-029 closure.

## Configuration

- `XIAOZE_CHECKPOINTER=postgres`
- `DATABASE_URL=postgres://wiseeff:***@127.0.0.1:5432/wiseeff`

## `npm run db:migrate`

```
Applied 0 migration(s): none
Ensured Xiaoze LangGraph checkpoint tables.
```

## Checkpoint tables (public schema)

```
checkpoint_blobs, checkpoint_migrations, checkpoint_writes, checkpoints
```

## Cross-instance resume test

```
npm run test:server -- durableCheckpointer.integration
→ 2 passed (interrupt on agent instance A, resume on fresh agent instance B, same thread_id + Postgres saver)
```

## Notes

- Unit tests default to `MemorySaver`; no live Postgres required in CI.
- User-visible chat history remains TD-030 (separate from LangGraph checkpoint payloads).
