# WiseEff M6.3 Self-Hosted Storage And Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow `superpowers:test-driven-development`: write the failing test first, verify it fails, implement the smallest change, then verify green.

**Goal:** Provide self-hosted S3-compatible object storage plus repeatable PostgreSQL, object-store, and queue-state backup/restore drills.

**Architecture:** WiseEff keeps the existing object-store seam and standardizes on S3-compatible behavior rather than a cloud vendor. M6.3 adds self-hosted object storage deployment guidance, adapter validation, backup/restore scripts, evidence generation, and restore integrity checks; Redis backup validation is defined here and fully exercised after M6.4 adds the durable queue service.

**Tech Stack:** S3-compatible self-hosted object storage, PostgreSQL backup/restore, optional Redis persistence after M6.4, TypeScript smoke scripts, Docker Compose/self-hosted Linux runbooks, WiseEff object-store readiness checks.

**Current status (2026-06-02):** Local implementation, documentation, evidence-shape checks, restore-target safety checks, and repository verification are complete in branch `codex/m6-3-self-hosted-storage-backup`. The generated M6 evidence is local non-customer example evidence only. This plan remains active and must not move to `docs/exec-plans/completed/` until a real non-customer or pilot target restore drill runs against isolated PostgreSQL and object-store restore targets.

**Reconciliation (2026-06-03):** The integrated M6 branch contains the provider decision docs, object-store env template, backup/restore scripts, evidence checker, generated local evidence, runbook updates, and S3-compatible object-store tests. Fresh local checks passed with `npm test -- --run scripts/check-backup-drill.test.ts scripts/run-backup-drill.test.ts scripts/run-restore-drill.test.ts`, `npm run test:server -- server/modules/logs/objectStore.test.ts server/modules/logs/s3ObjectStore.test.ts server/objectStoreFactory.test.ts`, and `npm run backup:check`. The backup checker now rejects `queue.status=conditional` when target evidence declares `queue.mode=durable`, and requires Redis persistence snapshot/checkpoint metadata for captured durable queue evidence. These prove repository-local implementation and evidence-shape readiness only. The remaining blocker is still the real target restore drill: isolated PostgreSQL restore, isolated object-store bucket/prefix restore, durable queue persistence validation when enabled, cross-store log reference validation, and redacted target evidence archival.

**Target-evidence guard hardening (2026-06-05):** `npm run m6:target-evidence` now requires both `docs/generated/m6-backup-restore-evidence.md` and machine-readable `docs/generated/m6-backup-restore-evidence.json` before M6.3 can complete. The JSON must prove a target environment label, isolated PostgreSQL and object-store restore targets, zero missing log objects, successful `restore:drill`, `backup:drill`, and `backup:check` command records, and durable queue persistence metadata. `npm run m6:target-plan` now requires `REDIS_URL`, `BACKUP_REDIS_SNAPSHOT_TARGET`, and `BACKUP_REDIS_CHECKPOINT_VALIDATED=true` so the operator manifest matches the final M6.3 completion gate. This prevents a handwritten Markdown summary or local-only drill from moving M6.3 to completed.

---

## Reference Basis

- RustFS S3 compatibility docs: https://docs.rustfs.com/features/s3-compatibility
- Ceph Object Gateway docs: https://docs.ceph.com/en/latest/radosgw
- MinIO S3 compatibility reference: https://minio.community/community/minio-object-store/reference/s3-api-compatibility.html
- Docker Compose volumes reference: https://docs.docker.com/reference/compose-file/volumes/
- Redis persistence docs for the later queue drill: https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/

## Storage Provider Decision

M6.3 must not hard-code WiseEff to a single object-storage product. The app should require an S3-compatible endpoint and a health/read/write/delete probe. Operator deployment templates may include one default product, but the plan requires a provider decision record before implementation.

Recommended decision criteria:

- License and commercial obligations.
- Upstream maintenance and security update posture.
- S3 API compatibility needed by WiseEff: bucket exists, put object, get object, head object, delete object, metadata, content type, and checksum behavior.
- Backup/export support.
- TLS and credential rotation support.
- Single-node and future multi-node operation complexity.

Practical starting recommendation for a self-hosted commercial pilot:

- Prefer a maintained S3-compatible server with a commercially acceptable license and documented Linux deployment.
- Treat MinIO-compatible behavior as an API target, not as an automatic product choice.
- Use Ceph only if the operator already has storage-cluster expertise.

## Scope Boundary

M6.3 includes:

- Self-hosted object-storage deployment profile or operator runbook.
- Object-store env template for local, target, and self-hosted production.
- Readiness probe evidence against the selected object store.
- Backup scripts for PostgreSQL and object storage.
- Restore scripts into isolated restore targets.
- Integrity validation that restored database records still reference existing log objects.
- Redis backup/restore procedure definition, with execution gated by M6.4.
- Evidence report for backup timestamp, restore timestamp, object count, checksum validation, and skipped dependencies.

M6.3 excludes:

- Cloud object storage accounts or cloud IaC.
- Durable queue implementation. That is M6.4.
- Full release rollback orchestration. That is M6.6.
- Customer-data backup retention legal policy beyond documenting retention knobs and evidence needs.

## Dependencies And Ordering

- M6.1 should provide the self-hosted runtime baseline.
- M6.2 may change auth but is not required for object-store backup mechanics.
- Redis backup execution is conditional only for polling mode or targets without durable queue enabled. After M6.4, durable queue target evidence must record Redis persistence metadata and pass `queue:check`.
- M6.6 will consume M6.3 backup/restore scripts for release rollback rehearsal.

## Success Criteria

- A self-hosted S3-compatible object store can be configured without using a cloud service.
- `/health/ready` reports object-store readiness with actionable failure details.
- Log upload and analysis continue to store bytes and metadata through the object-store seam.
- PostgreSQL backup can be restored into an isolated database and validated.
- Object-store backup can be restored into an isolated bucket/prefix and validated.
- Cross-store validation confirms referenced log objects exist after restore.
- Redis backup procedure is present. For durable queue targets, Redis persistence metadata and queue validation are required; conditional queue evidence remains valid only for polling mode or explicitly non-durable drills.
- Backup/restore evidence is recorded without secrets or customer data.

## Expected File Structure

Create:

- `ops/self-hosted/storage/README.md`: provider decision and storage deployment guide.
- `ops/self-hosted/storage/provider-decision.md`: selected provider rationale and rejected alternatives.
- `ops/self-hosted/storage/object-store.env.example`: S3-compatible object-store template.
- `scripts/run-backup-drill.ts`: orchestrates database/object-store/queue backup evidence.
- `scripts/run-restore-drill.ts`: restores to isolated targets and validates integrity.
- `scripts/check-backup-drill.ts`: validates evidence shape and required fields.
- `scripts/check-backup-drill.test.ts`: tests for backup/restore metadata validation.
- `docs/generated/m6-backup-restore-evidence.md`: generated evidence when safe to commit.

Modify:

- `server/modules/logs/objectStore.ts`
- `server/modules/logs/s3ObjectStore.ts`
- `server/modules/operations/health.ts`
- `server/modules/operations/health.test.ts`
- `docs/runbooks/backup-restore.md`
- `docs/runbooks/staging-deployment.md`
- `docs/runbooks/manual-acceptance.md`
- `docs/developer/environment-variables.md`
- `docs/developer/verification-matrix.md`
- `docs/RELIABILITY.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `.env.example`
- `ops/self-hosted/.env.example` if M6.1 has landed.

## Implementation Tasks

### Task 1: Provider Decision And Config Gate

- [x] Write failing tests in `scripts/check-backup-drill.test.ts` that require provider decision metadata, object-store endpoint shape, backup target, restore target, and redaction rules.
- [x] Add provider decision documentation under `ops/self-hosted/storage/`.
- [x] Add object-store env example with endpoint, bucket, access key, secret, region, path-style flag if needed, TLS policy, and health prefix.
- [x] Run `npm test -- scripts/check-backup-drill.test.ts` and confirm the expected failure before implementation.

### Task 2: Object-Store Readiness And Compatibility

- [x] Add or extend object-store health tests for bucket missing, credential failure, TLS failure, metadata mismatch, and write/read/delete probe failure.
- [x] Ensure readiness messages are actionable and safe to expose.
- [x] Verify log upload stores checksum, size, content type, retention class, and encryption-mode metadata where supported.
- [x] Run focused tests for logs object store and operations health.

### Task 3: Backup Drill Script

- [x] Implement `scripts/run-backup-drill.ts` with database dump command configuration, object-store sync/export command configuration, optional Redis snapshot capture, and evidence writing.
- [x] Require explicit target directories or bucket prefixes to avoid accidental production overwrite.
- [x] Redact credentials and signed URLs.
- [x] Record branch, commit, environment label, timestamps, object counts, and command exit statuses.
- [x] Run tests for successful evidence, failed database backup, failed object-store backup, and Redis-unavailable conditional status.

### Task 4: Restore Drill Script

- [x] Implement `scripts/run-restore-drill.ts` to restore PostgreSQL into an isolated database and object storage into an isolated bucket/prefix.
- [x] Validate restored table counts and sampled log object references.
- [x] Validate restored object checksums where available.
- [x] Refuse to restore into the configured live production database or live production bucket/prefix.
- [x] Run tests for target safety checks and integrity validation.

### Task 5: Runbooks And Evidence

- [x] Update `docs/runbooks/backup-restore.md` with self-hosted PostgreSQL, object store, and Redis sections.
- [x] Update `docs/runbooks/manual-acceptance.md` so target acceptance distinguishes local object-store evidence from self-hosted target evidence.
- [x] Add `npm run backup:drill`, `npm run restore:drill`, and `npm run backup:check` if script names are accepted during implementation.
- [x] Update Chinese security/reliability docs.

### Task 6: Verification And Completion

- [x] Run `npm run backup:check`.
- [x] Run focused object-store and operations-health tests.
- [x] Run `npm run docs:check`.
- [x] Run `npm run contract:check`.
- [x] Run `npm run test:all`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [ ] Run a real backup/restore drill in a non-customer target environment before claiming M6.3 complete. If no target exists, keep target evidence open.

## External Inputs Needed

- Selected object-storage product and deployment model.
- Storage hostname, TLS policy, bucket name, and credential rotation policy.
- Backup destination path or isolated backup bucket/prefix.
- Restore drill destination database and restore bucket/prefix.
- Maximum acceptable data loss target and restore-time target.
- Whether Redis is already deployed when this plan executes.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Update | `docs/README.md`, `docs/runbooks/README.md`, `AGENTS.md` | Add storage/backup runbook paths if new durable docs are created. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan, `docs/exec-plans/tech-debt-tracker.md` | Track M6.3 and Redis conditional backup status. |
| Product specs | No change | `docs/product-specs/` | No user workflow change expected. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/deployment-operations.md` | Document self-hosted S3-compatible storage and restore validation. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md` | Add backup/restore gates. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`, `docs/runbooks/backup-restore.md`, `docs/runbooks/staging-deployment.md`, `docs/runbooks/manual-acceptance.md` | Backup/restore is reliability-critical. |
| Security/governance docs | Update | `docs/SECURITY.md`, `docs/security/secrets-management.md`, `docs/security/data-classification.md`, `docs/security/audit-retention.md` | Object storage and backups contain sensitive operational data. |
| Frontend/design docs | No change | `docs/FRONTEND.md` | No UI behavior change expected. |
| Generated artifacts | Review | `docs/generated/m6-backup-restore-evidence.md`, `docs/generated/m5-pilot-acceptance.md` | Commit only redacted evidence. |
| References | Review | `docs/references/` | Add compact storage reference only if repeated agent execution needs it. |
| Chinese developer docs | Update | `docs/zh-CN/security-reliability.md`, `docs/zh-CN/backend-runtime.md` | Backup/restore and storage env changes are developer-facing. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan is moved to completed.
- Provider decision and backup/restore runbook updates are blocking.
- If durable queue mode is not enabled, record the conditional Redis backup status in docs and technical debt rather than marking it complete. If durable queue mode is enabled, target evidence must capture Redis persistence metadata instead of using conditional status.
- Target restore evidence must name the isolated restore targets and validation commands.

## UI Interaction Automation Review

M6.3 should not change user-facing UI behavior.

- Affected acceptance specs: `e2e/acceptance/log-analysis.acceptance.spec.ts` may be rerun because log uploads depend on object storage.
- Acceptance requirement IDs: `LOG-HAPPY-001`, `LOG-REANALYZE-001`.
- Operation IDs: `LOG-HAPPY-001`, `LOG-REANALYZE-001`.
- Required action: If object-store errors change visible upload/analyze behavior, update log-analysis browser acceptance and operation evidence. Otherwise record that existing tests cover unchanged behavior.
