# M6 Backup Restore Evidence

Status: `passed`

- Missing fields: _none_
- Unsafe fields: _none_
- Validation errors: _none_

## Summary

- Provider: `rustfs`
- Decision record: `ops/self-hosted/storage/provider-decision.md`
- Environment: `local-non-customer`
- Branch: `codex/m6-3-self-hosted-storage-backup`
- Commit: `54925ef0238b373035d79387a2ec475524a34635`
- Object store: `https://storage.example.test` / `wiseeff-prod`
- Object checksum validated: `true`
- Database table counts validated: `true`
- Missing log objects: `0`
- Queue: `conditional` (Redis durable queue is introduced in M6.4.)

## Restore targets:

- `postgres://wiseeff_restore@localhost:5432/wiseeff_restore`
- `s3://wiseeff-restore/m6-drill/`
