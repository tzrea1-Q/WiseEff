# Populated Catalog upgrade preparation

> Chinese terminal guide: [Chinese](populated-upgrade.zh-CN.md)

## Current execution contract

PR #824 follow-up: `PCAT-RUNTIME-WORKER-INITIALIZATION-FAILED` means admission
completed but worker initialization failed; its pool was closed or closure was
attempted and failed. Do not respond by raising runtime privileges or reopening
queues. This code does not add a legal startup path or a production upgrade command.

Worker start and shutdown now own the listener, consumers and database pool;
`PCAT-RUNTIME-WORKER-START-FAILED` or `PCAT-RUNTIME-WORKER-SHUTDOWN-FAILED`
keeps a nonzero process outcome with static diagnostics. Polling shutdown waits
for the current task. Durable construction/close awaits Queue/Worker cleanup.
These lifecycle fixes do not authorize a consumer or prove approved startup.
The final durable implementation at source `2381aaff1` now has independent
Standards/Spec PASS. Parent API request draining and the existing-storage P12/journal
increments also have bounded independent reviews and are integrated. These reviews
do not cover a complete startup producer or a successful controller upgrade.
The real supervised Redis suite at `801e0a8b3` passed nine cases, including a
negative test that keeps a failing secret-leak assertion itself secret-free.

The user authorized two bounded implementation changes on 2026-09-07: the
[registered recovery execution layer](storage/execution/README.md), while S11-RP
checks remain effect-free; and the additive [Catalog reader](../../server/modules/catalog-kernel/security/catalog-reader.md)
in migration 0140. Historical 0138/0139 bytes remain unchanged. Neither approval
permits production execution, governance EXECUTE additions, Binding/ProjectValue
grants, or publication. Policy #815 remains a separate decision. Real Kernel reads
with limited logins have been exercised; API/worker startup and the complete
controller are still separate unfinished integration work.

This candidate provides protective interception, bounded canonical conversion and recovery adapters. It does **not** complete a populated release. No production maintenance command is available yet. The source baseline is `82344044b436a8dafecefbb85dfd724cecb05e3f`; current integration base is `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`. Earlier bases and executions remain in the evidence record. Supplied deployment counts/image identity are historical, not fresh inventory or backup proof. Do not copy private deployment paths, values or backups into repository evidence.

| Entry | Actual boundary |
| --- | --- |
| Ordinary stack apply | Legacy stack lifecycle; canonical targets now refused before build/no-op |
| Catalog apply fresh/populated | Frozen plan/execute/P11a only; no public service authorization |
| Release Verification | Purpose, pins, report, approval and runtime-pin module; production startup integration missing |
| P12 | Existing 0137 event/checkpoint implementation and formal report association integrated; successful approved apply still needs the complete live gate/producer chain. The earlier new-table prototype remains excluded |
| P13/P11b/P14/P15 | Existing-storage legacy LOGIN fence and observed source endpoint are integrated components; bootstrap/superuser source, complete retirement, reports and publication remain unfinished |

## Developer commands

On the isolated development checkout, as the development user, run the permanent
worker lifecycle selectors below. They use synthetic adapters and actual private
HTTP listeners; no database or production credentials are inputs, and no service
is stopped. Record the current collected/passed/failed counts; any failure stops validation, not an operational
recovery command. This is not a production startup acceptance command.

```bash
./node_modules/.bin/vitest run --config vitest.runtime-bootstrap.config.ts \
  server/modules/logs/workerRunner.test.ts \
  server/modules/logs/workerRunnerBootstrap.test.ts \
  server/modules/logs/worker.test.ts \
  server/modules/logs/logAnalysisQueueRuntime.test.ts
```

The component runner owns separate `reader-pg16`, `runtime-identity-pg16`, `read-projections-pg16`, `report-pg16`,
`authority-pg16`, `scripts-pgvector`, `server-pgvector` and
`schema-doc`, `docs-check`, `log-redis`, `activation-existing-pg16` and
`retirement-existing-pg16` lanes. After independently confirming the
development Docker Desktop daemon and its owned resources, pass its actual ID
with `--expected-daemon-id` and the selected `--suite` to
`scripts/run-upgrade-component-tests.ts` using the repository's `tsx` binary.
These commands create and remove a fresh cluster/network/volume. `schema-doc`
also writes `docs/generated/db-schema.md`; it is a generator, not a read-only
inspection. `docs-check` requires actual database schema comparison and fails
instead of skipping when its dedicated database or vector extension is unavailable.
A failed test or unverified cleanup stops acceptance. Never supply
an ambient deployment database or use these component results as a release.

To repeat the actual Catalog route and persisted Review query checks on that
independently approved development host, as the developer in the fixed candidate
checkout, use the existing owned lane below. Input is the verified development
daemon ID; all database data and roles are synthetic and created by the runner.
It writes and removes only its new cluster/network/volume, and stops no deployment.

```bash
: "${UPG_EXPECTED_DAEMON_ID:?set the independently approved development daemon ID}"
env -i PATH="$PATH" HOME="$HOME" ./node_modules/.bin/tsx \
  scripts/run-upgrade-component-tests.ts \
  --expected-daemon-id "$UPG_EXPECTED_DAEMON_ID" --suite read-projections-pg16
```

At code `8ed7ac196` expect two files, 10 tests, exit 0 and verified cleanup.
Missing files fail before Docker creation; any setup, assertion or cleanup failure
stops acceptance. Catalog GET success uses an actual 0140-only LOGIN. The Review
positive uses existing wider governance capabilities in a read-only transaction;
the 0140-only identity remains denied Review. This command does not start the API
or worker and does not authorize runtime, queues, traffic or a production upgrade.

On the same development machine/user/checkout, select `--suite runtime-identity-pg16`
to run the existing eleven actual login, checkout, checkpoint and API/worker
process-refusal cases. The parent supplies the verified PG16 receipt and owns all
resource cleanup; there is no opt-in skip or ambient deployment connection.
Expect eleven collected cases and verified cleanup. These include restricted
business/checkpoint operations but do not include approved runtime-pin startup.

The retirement lane invokes the real role fence and original-endpoint checks on
owned PostgreSQL 16 Alpine. Its parent creates and records all endpoint resources
before the test child starts, and cleans those exact resources after child exit.
It includes actual stopped-container resolver files and two different PG targets.
Run it on the same approved development host/user/checkout described above:

```bash
: "${UPG_EXPECTED_DAEMON_ID:?set the independently approved development daemon ID}"
env -i PATH="$PATH" HOME="$HOME" node --import tsx \
  scripts/run-upgrade-component-tests.ts \
  --expected-daemon-id "$UPG_EXPECTED_DAEMON_ID" --suite retirement-existing-pg16
```

Expect nonzero collection, exit 0 and verified cleanup. The explicit timeout
fault experiment instead expects child/runner failure and separately verifies
cleanup; it is not a business-suite pass. Missing tests/config fail before resource
creation. These are PG/psql source probes, not actual old API/worker handoff, a
complete approved `retireLegacyApplicationLogins` run, P13 approval or restart.

The GitHub-only `--github-hosted` option requires fresh, verified GitHub OIDC
claims, the actual clean checkout (including non-ignored untracked files) and
the pinned local daemon. It does not accept a caller token or a CI boolean.
The mandatory reader, report and authority jobs each use a separate
cluster because role mutation tests cannot share the server suite's cluster. See the
[Hosted admission contract](../../scripts/upgrade-hosted-admission.md).

Machine: isolated development host; user: developer; directory: reviewed candidate repository; prerequisites: locked dependencies, Git source object, Docker. These tests create their own synthetic database clusters and never accept production backup input. They do write disposable test storage; they do not stop the deployed service.

```bash
npm ci
UPG_IDENTITY_DOCKER_TEST=1 npm run test:scripts -- scripts/inspect-upgrade-runtime-identity.test.ts
npm run test:scripts -- scripts/inspect-populated-upgrade-source.test.ts scripts/inspect-populated-upgrade-source.integration.test.ts
npm run test:scripts -- scripts/reconcile-upgrade-cli.test.ts ops/self-hosted/scripts/upgrade-compatibility.test.ts
npm run test:scripts -- ops/self-hosted/scripts/build-network-trust.test.ts
```

Each test command must exit 0 with nonzero collection; setup failure or skip does not satisfy its real boundary. The source regression creates the old schema from 126 original migrations and applies the exact current candidate suffix (12 files, 0129–0140); its few synthetic values/history rows are a narrow oracle, not full consumer-family semantics or the real data copy. Earlier 11-file executions retain their historical scope.

### Reproducible Binding component tests

Machine/user/directory: isolated Docker Desktop development host, developer,
fixed candidate checkout. Prerequisites: locked dependencies, source Git object,
trusted local `pgvector/pgvector:pg16` image. Independently verify the host/daemon
and set `UPG_EXPECTED_DAEMON_ID` from its approved identity record; do not derive
approval automatically from whichever daemon answers. No deployment URL or backup
is accepted.

```bash
: "${UPG_EXPECTED_DAEMON_ID:?approved development daemon identity required}"
env -i PATH="$PATH" HOME="$HOME" node --import tsx \
  scripts/run-upgrade-component-tests.ts \
  --expected-daemon-id "$UPG_EXPECTED_DAEMON_ID" --suite bindings
```

The command creates a fresh owned PostgreSQL cluster, private credential, network
and receipt, and cleans up those exact resources. It does not stop an application.
Expected: nonzero collection, exit 0, `scope=isolated-components-only`,
`cleanupVerified=true`, `releaseApproved=false`. Any setup/test/identity/cleanup
failure stops with nonzero status; retain the output and do not reset deployment
journals or remove unrelated resources. The suite reconstructs old schema and
converts synthetic Bindings through real P8/P9 modules. Its early P0/P7 preparation
is a bounded fixture, not the full controller/report chain. The pgvector image
does not prove production `postgres:16-alpine` compatibility. This is not the M2
upgrade entry.

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

### Continuation implementation boundaries

The candidate now includes `compose.catalog.yaml`, an explicit overlay that replaces
the API and worker environment files with `WISEEFF_API_ENV_FILE` and
`WISEEFF_WORKER_ENV_FILE`. Only the API file contains
`CATALOG_GOVERNANCE_DATABASE_URL`; neither runtime file may contain migration
credentials. `WISEEFF_MANAGEMENT_ENV_FILE` belongs solely to the opt-in
`catalog-management` profile. API startup in this overlay runs the verify-only
server entry. The old ordinary-stack Compose file is retained for compatibility.
The overlay alone does not bind volumes, stop writers, authorize migrations or
make a new checkout a safe production entry.

Machine: isolated development host; user: developer; directory: fixed candidate
checkout with dependencies installed. The following permanent regression runs
actual Compose configuration resolution, creates only temporary private files,
and does not start or stop containers:

```bash
npx vitest run --config vitest.scripts.config.ts ops/self-hosted/scripts/catalog-compose.test.ts
```

Expected: two passing tests; management secrets absent from API/worker/web/proxy,
governance credentials absent from worker, missing API file rejected, management
service isolated in its explicit profile. API/worker `NODE_ENV` is fixed to
production even if a private env file requests development or test. Handoff
additionally rejects conflicting, empty or quoted values; omission uses the fixed
Compose value. Data volumes and network are explicitly
named external resources; candidate images cannot be implicitly built or pulled.
Their names alone still do not establish target identity. Failure stops integration. Compose must
support `!override` and `!reset`; unsupported versions fail rather than merge the
old shared secret file. Build metadata uses `WISEEFF_SOURCE_SHA` and
`WISEEFF_SOURCE_TREE`; handoff separately verifies these labels against fixed Git
objects and the actual image ID. Labels alone are not reproducible-build evidence.

Management activation can reuse `verifyStoppedHandoff` while holding the existing
issued lock for the exact journal directory. It re-observes the fixed handoff
with all three source applications stopped, checks target/configuration drift,
and verifies the same lock again. It does not stop writers, drain queues, produce
a P2 proof or approve activation. The root must separately supply these facts;
ordinary `inspectHandoff` retains its running-source preparation contract.

The new `handoff.ts` binds observed source/candidate artifacts, Compose resources,
private configuration and store identities under the existing operation lock.
Its real Compose regression uses identity-fixture application images. It now
accepts the exact stopped old application containers only when committed P2
evidence permits that process state; it still rejects replaced containers or
unknown journal outcomes. Lock liveness uses a fresh nonce exchange with the
actual lock holder. This is not full old-application startup, candidate
replacement, stopped-Redis resume or a complete report lineage. There is no
production handoff command yet.

Activation intent/binding digests use the formal domain contract serializer.
Their enclosing host events and journal retain the existing host serialization;
these are different digest scopes. Earlier host-only synthetic activation
fixtures were not valid domain records and are now rejected. Do not rewrite
journal hashes or infer that an unknown SQL outcome did not commit. Reconcile
the exact domain attempt under the original lock. This correction issues no P12,
runtime or public approval.

The management migration CLI now reads only `DATABASE_URL` and
`XIAOZE_CHECKPOINTER`; it does not require runtime auth/provider/storage secrets.
Checkpoint mode defaults to `memory` as before. The isolated management stage must
explicitly select `postgres` when preparing checkpoint tables. A parent test ran
the actual CLI with only these inputs and production mode on an owned fresh PG
database: 137 migrations and four checkpoint tables, exit 0. This is management
evidence, not populated conversion or permission to migrate a deployment. Do not
invoke it on a production URL outside the missing approved root workflow.

The controlled management function additionally requires a fixed source
descriptor, candidate migration inventory, live host lock, real writer/recovery
boundary adapter and durable attempt in the existing target-scoped journal.
It preserves the complete old public row projection, checks every migration
filename/checksum, fixes the management search path, and prepares PostgreSQL
checkpoints administratively. Its receipt is recomputed read-only before P4;
ordinary CLI success, table existence, a supplied digest or a pending attempt
does not replace that receipt. Partial/unknown outcomes require explicit
reconciliation, which is still missing from the terminal composition.

Additional PostgreSQL 16 Alpine component matrix (not a deployment upgrade):
machine: the independently verified local Docker Desktop development host;
user: developer; directory: fixed candidate checkout with installed dependencies.
Input is the previously verified development daemon ID. This creates and removes
only owned synthetic databases, roles, containers, networks and volumes; it never
stops existing services or accepts a production URL. The local images must already
exist. Set the private shell variable `UPG_DEVELOPMENT_DAEMON_ID` to the
independently verified development daemon ID before this command; do not derive
authorization merely from the current Docker context:

```bash
node --import tsx scripts/run-upgrade-component-tests.ts --expected-daemon-id "$UPG_DEVELOPMENT_DAEMON_ID" --suite bindings-pg16
```

Expected: nonzero tests collected, exit 0 and an `isolated-components-only`
summary with the actual `postgres:16-alpine` image ID and verified cleanup.
Wrong daemon, missing private target receipt, setup or test failures stop; they
are not skips or performance passes. The separate `--suite bindings` retains
the required pgvector Catalog lane; this extra profile does not relax it.

A bounded developer-only synthetic three-store restore creates its own PostgreSQL, Redis and MinIO source/target containers, retains PostgreSQL owner/ACL, verifies a restricted login, two different objects and their backup-derived metadata, and Redis AOF persistence. It exports a package, stops the source stores, then restores in a separate process consuming only the package and private target inputs. It accepts no external URL or production backup through this CLI. Prerequisites are the local images listed in `scripts/rehearse-upgrade-recovery.ts`, including the source MinIO version; missing images fail before container creation. From the reviewed development clone:

```bash
node --import tsx scripts/rehearse-upgrade-recovery.ts --synthetic-only
```

Expected: exit 0, `evidence="synthetic package only"`, separate backup/checksum/restore/behavior flags, `sourceStoppedBeforeRestore=true`, `separateRestoreProcess=true`, `redisPersistence="AOF"`, and `cleanupVerified=true`. The producer records the actual stopped-store capture under the existing host lock. A separate owned authentication cluster supplies four independent synthetic principals through the formal confirmation/approval commands. The restore child only consumes the package and private target inputs; it never starts consumers.

Actual BullMQ jobs, payloads and paused state survive the AOF restore. A separate controlled acceptance then resumes those synthetic jobs using a restricted database login. A committed effect followed by failure/retry must produce one row through the business uniqueness constraint. `actualQueueVerified`, `queuePausedAfterRestore`, `queueRetryVerified` and `queueDeduplicationVerified` describe this representative task, not all application queues or exactly-once delivery. `fullBusinessVerification=false` and `releaseReady=false` remain mandatory.

Private capture/package/approval/journal evidence is retained (`backupRetained=true` once capture commits), including after failed or unknown execution. Docker cleanup is separate from evidence retention; no automatic recursive removal of this evidence is authorized. Missing payload, wrong run and existing target AOF must expose their own finite child refusal, not just a generic process failure. The package's 256 MiB memory bound and private unencrypted format are not production encryption/key custody. Failure remains isolated; no production recovery command is implied.

Permanent regression uses the existing admitted runner, with an independently verified development daemon ID supplied by the operator:

```bash
node --import tsx scripts/run-upgrade-component-tests.ts --expected-daemon-id "$verified_development_daemon_id" --suite recovery-three-store
```

Run only from the reviewed isolated development checkout, with the listed local images and an already verified daemon. It writes its own disposable stores and retains private evidence; it does not stop any deployment. The owned CI job runs the same complete file without opt-in skips. A failed admission, missing image, test or cleanup stops this lane.

Package v2 records role INHERIT and each PostgreSQL 16 membership's INHERIT/SET
options explicitly. Unknown flags, privileged attributes, ADMIN, external edges
and secret fields are refused. Old v1 packages are not silently upgraded; re-export
from an authorized source. `roleCapabilitiesVerified=true` covers the declared
synthetic profile's inherited read, explicit SET ROLE and denied writes/escalation;
it does not prove all application or database-global privileges were restored.
The additional v3 profile requires source and target to have the same explicitly
provisioned bootstrap role, including `wiseeff` at OID 10, before restore. It
never creates, renames or translates a superuser. Both profiles require the
observed vanilla PG16 Alpine database encoding/locale/provider and settings;
unsupported database properties are refused, not silently lost. Test input
secrets remain separate from the package. The actual adapter regression covers
both bootstrap profiles; the older synthetic CLI is not relabeled as v3 proof.

Production backup/quiescence: **not executable under this candidate's contract**. First identify every writer, bind all storage identities, complete the owner/ACL strategy, private encryption/key custody, persistent Redis uses and same-boundary snapshot implementation. Existing `backup:drill`/`restore:drill` evidence helpers and `pg_restore --list` are not actual restore proof. Do not use old run `completed` or `recovery_point_verified` as new restore evidence.

Authorized real-copy rehearsal: **blocked awaiting a controlled recoverable backup and production-capable encryption, role policy and full business restore integration**. No production export is authorized by this document. Disable external email/webhook/device/model effects in an approved isolated environment. Record provider simulation separately from actual authentication/database/business behavior.

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

The parent and assigned implementation agents own the unfinished release,
runtime, recovery and acceptance integrations. P12/P13 unavailability, terminal
composition, full consumer coverage and browser/capacity are internal gaps.
The current bounded S6 decision concerns P01's management-membership classification
and P02's actual restricted-login probes; it does not authorize runtime grants.
Policy #815 still requires an authoritative relation or an explicitly accepted
unavailable contract. The P12 new-table prototype is excluded and is not a
prerequisite for the existing-storage path. Serial source-lock routing leaves
the frozen test unchanged; any later algorithm/identity revision needs its own
precise review. Additional business capability gaps require an actual caller,
operation and failure before a separate permission proposal.
0140 Kernel reader and the independent recovery execution layer are already
authorized; neither decision is pending. Report approval now uses the formal
public report service. External environment inputs are an authorized
recoverable backup and enterprise CA/network build access; production operation
and release approvals remain separate. These do not move all remaining work to
OP-09 or authorize an incomplete synthetic upgrade.
