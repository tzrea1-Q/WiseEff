# Rebuild reviewed example parameters

> Chinese: [Chinese guide](seed-rebuild.zh-CN.md). Design and failure boundaries: [operator design](seed-rebuild-design.md).

This operator is for an adopted self-hosted instance with old example parameters and **zero canonical bindings**. It archives and replaces parameter data for Atlas, Aurora and Nebula with the reviewed DTS and JSON sources. Other projects, users, roles, device nodes and non-parameter objects are preserved. It does not grant capabilities, change publication policy, rotate passwords, or enable P11–P16.

Use the same reviewed application revision for the checkout and running images. First finish the ordinary application upgrade and verify its status, service health and DTS toolchain. The earlier upgrade backup is not this operation's recovery point. Do not run the old M1 seed, the local disposer CLI, or a legacy Catalog installer against the deployment.

## Before maintenance

The one-shot container runs with the operator's host UID/GID so private run files remain operator-owned. The application image makes `/app` readable and directories traversable even when the checkout was created with a restrictive umask. If an older image reports `EACCES` on `/app/package.json` during `plan`, upgrade to the corrected image and plan with a new run ID; do not switch the operator to root or loosen private state-directory permissions.

Run commands from the server's `ops/self-hosted` directory. The operator needs Python 3, the existing private `.env` and one-shot management DSN already used for upgrades. It supports the Compose-owned `wiseeff` PostgreSQL database, local MinIO endpoint `http://minio:9000`, and local Redis service; an external database or store is outside this recovery boundary. Do not copy credentials into diagnostics. By default, fresh backups are stored under `/var/backups/wiseeff/upgrades/seed-rebuild`, inside the directory prepared by the normal upgrade setup.

Choose an active persisted user in the target organization with parameter-file administration (`admin:access`), parameter editing permission on all three projects, and `catalog:author`. Publication must be reviewed by an authorized user distinct from the candidate author when the native high-risk policy requires it; the existing organization-admin exception remains unchanged. Keep `lowRiskSingleActorPublish=false`. Missing permissions or policy incompatibility are blockers to resolve explicitly through the existing [publication operations](catalog-publication.md), never automatic grants by this operator.

To identify the signed-in user, inspect the application's successful `GET /api/v1/me` response in browser Network and use `user.id` and `organization.id`. Opening that URL in the address bar does not attach the application's bearer token. Do not copy request headers or tokens into terminal output.

```bash
wiseeff_seed_run="seed-$(date -u +%Y%m%dT%H%M%SZ)"
wiseeff_seed_actor='<author-user-id>'
wiseeff_seed_org='<organization-id>'
./scripts/seed-rebuild.sh plan --run-id "$wiseeff_seed_run" \
  --actor "$wiseeff_seed_actor" --organization-id "$wiseeff_seed_org"
```

Review the exact database identity, organization, three project IDs, source/code hashes and original inventory digest. The plan performs no database or object-store writes. It saves private local state; retain that directory through completion and recovery. Replanning uses a new run ID.

## Maintenance, publication and rebuild

Copy the plan digest into `wiseeff_seed_plan`. Beginning maintenance stops traffic and writers, pauses/drains queues, freezes publication, and creates a **fresh, verified PostgreSQL/object/Redis recovery point**. Rebuilding cannot proceed unless these checks pass.

```bash
wiseeff_seed_plan='sha256:<digest-from-plan>'
./scripts/seed-rebuild.sh begin --run-id "$wiseeff_seed_run" --confirm-plan "$wiseeff_seed_plan"
```

Prepare and review the vendor candidate first. Publish only the exact reviewed artifact digest through the authorized reviewer. Wait for the intended activation receipt. Repeat for `configuration-schema` using its own artifact digest. The manager is the only application writer temporarily enabled during publication; the wrapper refreezes it afterwards.

```bash
./scripts/seed-rebuild.sh catalog-prepare --run-id "$wiseeff_seed_run" --stage vendor
wiseeff_seed_reviewer='<authorized-reviewer-user-id>'
wiseeff_seed_artifact='sha256:<reviewed-vendor-artifact-digest>'
./scripts/seed-rebuild.sh catalog-publish --run-id "$wiseeff_seed_run" --stage vendor \
  --actor "$wiseeff_seed_reviewer" --confirm-artifact "$wiseeff_seed_artifact"
./scripts/seed-rebuild.sh catalog-status --run-id "$wiseeff_seed_run" --stage vendor

./scripts/seed-rebuild.sh catalog-prepare --run-id "$wiseeff_seed_run" --stage configuration-schema
wiseeff_seed_artifact='sha256:<reviewed-configuration-artifact-digest>'
./scripts/seed-rebuild.sh catalog-publish --run-id "$wiseeff_seed_run" --stage configuration-schema \
  --actor "$wiseeff_seed_reviewer" --confirm-artifact "$wiseeff_seed_artifact"
./scripts/seed-rebuild.sh catalog-status --run-id "$wiseeff_seed_run" --stage configuration-schema

./scripts/seed-rebuild.sh rebuild --run-id "$wiseeff_seed_run"
./scripts/seed-rebuild.sh verify --run-id "$wiseeff_seed_run"
./scripts/seed-rebuild.sh finish --run-id "$wiseeff_seed_run"
```

The core archives and verifies all three old planes before materializing. It compares the complete reviewed identity set and source pins, verifies preserved data, and only then removes captured old residue. A total of 372 bindings is expected today, but count alone cannot pass verification. Successful repeat verification performs no rebuild writes.

## Failure and manual acceptance

An interrupted archive/materialization/disposal is not a restartable seed command. Keep maintenance in place and inspect status. An uncertain publication is resolved against its exact job and receipt; do not submit another candidate to guess the outcome.

```bash
printf '\n=== BEGIN WISEEFF SEED STATUS ===\n'
./scripts/seed-rebuild.sh status --run-id "$wiseeff_seed_run"
printf '\n=== END WISEEFF SEED STATUS ===\n'
```

When status requires whole-state recovery, restore only this run's verified recovery point:

```bash
./scripts/seed-rebuild.sh recover --run-id "$wiseeff_seed_run" --confirm "restore-$wiseeff_seed_run"
```

Recovery restores the stores and observed service/queue/publication state. Never manually clear a running-stage journal, remove the lock to force a replay, delete volumes, or run a global prune. If recovery itself fails, keep traffic stopped and retain the run's diagnostics.

If maintenance fails **before** a verified backup exists, no rebuild command is allowed. Use `resume-maintenance --run-id "$wiseeff_seed_run"` to retry the backup while isolated, or `abort --run-id "$wiseeff_seed_run"` to restore the original service state without restoring unverified store snapshots. Both are actions of `./scripts/seed-rebuild.sh`; follow the recorded status and retain diagnostics.

After successful finish, the server operator must verify each project in the actual browser: parameter workbench modules/rows; administration definitions; parameter debugging absolute target paths; unchanged backend nodes; a reviewed DTS and JSON draft/approval/writeback/export/re-import; and stable reads after service restart. Use a disposable example edit. Retain the private archives and fresh backup until this acceptance is complete. Local PostgreSQL or wrapper tests are not server/browser acceptance.
