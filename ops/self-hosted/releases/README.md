# Self-Hosted Releases

This directory defines the WiseEff M6.6 release-candidate process for controlled self-hosted Linux environments.

## Release Candidate Record

Every candidate must record:

- release label and commit SHA,
- branch and dirty-worktree state,
- target environment label and host,
- artifact reference,
- environment-file fingerprint,
- migration list,
- backup evidence path,
- rollback plan and rehearsal evidence,
- capacity evidence,
- target synthetic acceptance artifacts,
- explicit HDC status.

Use [release-template.md](release-template.md) for the human release record. `npm run selfhost:release-gate` writes the machine-readable summary to `docs/generated/m6-release-readiness.md`.

## Gate Order

Run the gates in this order:

```bash
npm run docs:check
npm run contract:check
npm run test:all
npm run build
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:evidence
npm run selfhost:check
git diff --check
```

Then run target evidence gates against the already deployed self-hosted target:

```bash
npm run selfhost:smoke -- --env-file ops/self-hosted/.env --base-url https://<host>
npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime
npm run capacity:gate -- --target-url https://<host>
npm run selfhost:release-gate -- --target-environment <label> --artifact-ref <artifact> --env-fingerprint <sha256>
```

`npm run capacity:gate` without observed metrics records pending evidence. After the target run, pass the observed values with `--observed-p95-ms`, `--observed-error-rate`, `--observed-rps`, `--observed-cpu`, `--observed-memory`, `--observed-db-connections`, `--observed-queue-backlog`, and `--object-store-probe`.

## Evidence Boundary

Local gates prove repository shape and deterministic behavior. They do not prove a self-hosted target is release-ready. Rollback rehearsal, capacity, target synthetic acceptance, backup/restore, queue drain, observability watch, and HDC device-lab evidence remain pending until they are run against a non-customer target environment and linked from the release record.
