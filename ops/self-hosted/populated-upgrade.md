# Populated Catalog upgrade preparation

> Chinese terminal guide: [Chinese](populated-upgrade.zh-CN.md)

## Current execution contract

This candidate closes the unbound diagnostic-as-gate failure and provides inspectors. It does **not** complete a populated release. No production maintenance command is available yet. The source baseline is `82344044b436a8dafecefbb85dfd724cecb05e3f`; development base is `1c9fa56e3eaca6e7984f35a097876772a6e4025d`. Supplied deployment counts/image identity are historical, not fresh inventory or backup proof. Do not copy private deployment paths, values or backups into repository evidence.

| Entry | Actual boundary |
| --- | --- |
| Ordinary stack apply | Legacy stack lifecycle; canonical targets now refused before build/no-op |
| Catalog apply fresh/populated | Frozen plan/execute/P11a only; no public service authorization |
| Release Verification | Purpose, pins, report, approval and runtime-pin module; production startup integration missing |
| P12/P13/P11b/P14/P15 | No approved complete executable integration in this candidate |

## Developer commands

Machine: isolated development host; user: developer; directory: reviewed candidate repository; prerequisites: locked dependencies, Git source object, Docker. These tests create their own synthetic database clusters and never accept production backup input. They do write disposable test storage; they do not stop the deployed service.

```bash
npm ci
UPG_IDENTITY_DOCKER_TEST=1 npm run test:scripts -- scripts/inspect-upgrade-runtime-identity.test.ts
npm run test:scripts -- scripts/inspect-populated-upgrade-source.test.ts scripts/inspect-populated-upgrade-source.integration.test.ts
npm run test:scripts -- scripts/reconcile-upgrade-cli.test.ts ops/self-hosted/scripts/upgrade-compatibility.test.ts
npm run test:scripts -- ops/self-hosted/scripts/build-network-trust.test.ts
```

Each test command must exit 0 with nonzero collection; setup failure or skip does not satisfy its real boundary. The source regression creates the old schema from 126 original migrations and applies the 11-file candidate suffix; its few synthetic values/history rows are a narrow oracle, not full consumer-family semantics or the real data copy.

## Fixed-entry preparation without changing the deployment

Use a separate reviewed clone on the administrative/development host. Fetch and pin the reviewed candidate commit there, verify its tree and the full-file delivery manifest, and install its locked dependencies there. Retain the old deployment checkout, each service image, Compose project and actual named-volume identities. Do not run `git pull`, checkout, dependency installation, or copy a new `.env` over the serving checkout.

The new clone is currently an inspection workspace only. Do not run its default Compose: it has not been bound to the old deployment's project/volumes/bucket/Redis identity, and its HEAD must never be recorded as `previousSha` of the old running stack. An executable handoff that binds those identities is still a missing integration. No remote script download-and-execute procedure is supplied.

## Production read-only collection

Machine: deployment host; user: existing trusted deployment operator; directory: existing `ops/self-hosted`. Requires separate approval to perform collection. These commands do not stop services or change database contents. Keep results privately. Run the source's existing wrapper, not the unbound new clone.

```bash
git rev-parse HEAD
./scripts/compose ps -q api worker web postgres redis
./scripts/compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U wiseeff -d wiseeff <<'SQL'
BEGIN READ ONLY;
SELECT name, checksum FROM public.schema_migrations ORDER BY name;
SELECT extname, extversion FROM pg_extension ORDER BY extname;
SELECT count(*) AS revisions,
       count(typed_value) AS typed_present,
       count(canonical_value) AS canonical_present,
       count(raw_value) AS raw_present
FROM public.project_parameter_binding_revisions;
ROLLBACK;
SQL
```

Expected: complete ledger and aggregate-only value presence. SQL null and JSON null differ; these totals do not prove relationship preservation. Authentication failure, missing relation or checksum, or unavailable query is a stop, not zero. Do not change credentials or repair the ledger. Container IDs are private operational references; use filtered `docker inspect` for image IDs/Compose and mount identities, never export an unredacted full inspect containing environment secrets.

From the reviewed administrative clone, the two new inspectors use a private `DATABASE_URL` supplied by the approved secret facility (never command-line credentials):

```bash
node --import tsx scripts/inspect-upgrade-runtime-identity.ts
node --import tsx scripts/inspect-populated-upgrade-source.ts --candidate-sha "$UPGRADE_CANDIDATE_SHA"
```

`UPGRADE_CANDIDATE_SHA` must be the exact reviewed 40-character commit present in that clone. These are read-only queries but require separately authorized connectivity. The runtime inspector inventories a **new login**, not a claim about existing pools. `inventory-collected`, `inspected`, `authorization:none`, and `capabilityAuditComplete:false` do not authorize upgrade. Preserve nonzero results and review each typed reason. Source inventory covers all public/Catalog table counts, columns, complete ledger and extension availability; it is not a frozen P0 graph or full semantic fingerprint.

## Authorized backup, rehearsal and maintenance

A bounded developer-only synthetic three-store restore creates its own PostgreSQL, Redis and MinIO source/target containers, retains PostgreSQL owner/ACL, verifies a restricted login, object bytes/metadata/count and a restored Redis RDB key. It accepts no external URL or backup. Prerequisites are the local images listed in `scripts/rehearse-upgrade-recovery.ts`; missing images fail before container creation. From the reviewed development clone:

```bash
node --import tsx scripts/rehearse-upgrade-recovery.ts --synthetic-only
```

Expected: exit 0, `evidence="synthetic sentinel only"`, separate backup/checksum/restore/behavior flags, `cleanupVerified=true`, `fullBusinessVerification=false`, `releaseReady=false`. Temporary backups are removed (`backupRetained=false`). This verifies synthetic sentinel recovery only, not production write freeze, full business semantics or real-backup intake. Failure stops with a sanitized stage; do not invent a production recovery command.

Production backup/quiescence: **not executable under this candidate's contract**. First identify every writer, bind all storage identities, complete the owner/ACL strategy, private encryption/key custody, persistent Redis uses and same-boundary snapshot implementation. Existing `backup:drill`/`restore:drill` evidence helpers and `pg_restore --list` are not actual restore proof. Do not use old run `completed` or `recovery_point_verified` as new restore evidence.

Authorized real-copy rehearsal: **blocked awaiting a controlled recoverable backup and real intake/restore adapters**. No production export is authorized by this document. Disable external email/webhook/device/model effects in an approved isolated environment. Record provider simulation separately from actual authentication/database/business behavior.

Final maintenance: **not executable**. Before requesting a window the release owner must deliver and prove P2 freeze/drain, P3 same-boundary restore point, P4 independent management migration, frozen source/plan/Archive/mapping, P11a, approved P12, P13, new full V01-V17/D01-D09 attempt, approved runtime pin, verify-only API/worker/web startup, isolated acceptance, exact public-release report and distinct approvals, then P15 traffic. Missing stages cannot be supplied as SQL pasted into a terminal.

## Failure and recovery selection

| Failure point | Safe action |
| --- | --- |
| Inspector/input/trust refusal before writes | Stop; preserve output, fix reviewed input/config; no service change |
| Old controller before migration | Its recorded old-stack recovery remains separate; inspect journal, do not guess |
| Partial migration / unknown commit | Keep isolated; owner must classify exact checkpoint and restore eligibility; no automatic retry or journal reset |
| Candidate accepted any business write/delivery/public traffic | Pointer-only rollback is ineligible; whole-state restore requires incident approval and exact target/run binding |
| Partial DB/object/Redis/roles restore | Stop; no proxy/queue recovery until complete proof |

No destructive production recovery command is supplied: the required target-bound three-store implementation is incomplete. Do not substitute image rollback, `--no-owner`, bucket mirroring with removal or Redis flushing. Preserve old images and recovery artifacts despite their historical insecure-build limitation.

## Independent blockers and owners

Release integration owner: P12/P13 ownership decision, real target context provider, runtime/public gate and controlled handoff. Runtime/security owner: capability inventory, separate pools/login roles, management-only migration/checkpoints, positive and adversarial business tests. Recovery owner: real backup intake, storage/roles adapters, same-boundary and business restore proof. Product owner: #815 authoritative Policy relation or explicitly accepted unavailable contract. Build operator: enterprise CA plus Docker/dependency trust and candidate image provenance. Acceptance owner: full consumer semantics, browser and growth capacity. Data owner: authorized real backup. Production operator/approvers: maintenance authorization. These remain distinct; none is silently moved to OP-09.
