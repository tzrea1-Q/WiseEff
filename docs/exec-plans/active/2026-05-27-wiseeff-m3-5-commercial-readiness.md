# WiseEff M3.5 Commercial Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each implementation step must follow `superpowers:test-driven-development`.

**Goal:** Turn the completed M1-M3 API-mode MVP into a controlled commercial pilot baseline before starting M4 Agent work.

**Architecture:** Keep the current React/Vite frontend and `server/` modular monolith. M3.5 adds operational readiness, production configuration gates, contract drift checks, worker/object-store/device hardening seams, and observability without restructuring the repository or replacing the current HTTP router.

**Tech Stack:** TypeScript, Node HTTP server, PostgreSQL, Zod, local object-store seam, simulator-first device gateway, Vitest, Playwright, SQL migrations, and repository-local docs.

---

## Scope Boundary

M3.5 includes:

- Commercial readiness health endpoints and deployment smoke checks.
- Production environment contract hardening for database, object storage, runtime mode, and gateway settings.
- Contract drift tests for M1-M3 handwritten HTTP clients and DTO mappers.
- M2 worker leasing and idempotency hardening for controlled pilot deployments.
- Object-store adapter readiness checks and production adapter boundary documentation.
- M3 device safety hardening: leases, timeout/offline/stderr normalization requirements, and simulator parity tests.
- Observability and audit correlation through request id, trace id, structured error metadata, and docs.
- Documentation updates that keep M4 Agent behind M3.5 completion criteria.

M3.5 does not include:

- Full SSO/OIDC integration.
- Full Redis/BullMQ deployment.
- Real S3/OSS credentials and production bucket provisioning.
- Real HDC rollout to customer labs.
- Agent orchestration or Agent write approvals. Those remain M4+.

## Success Criteria

- `/health/live` returns a process liveness response without requiring dependencies.
- `/health/ready` returns dependency statuses and fails with 503 when required commercial dependencies are unavailable.
- `NODE_ENV=production` fails fast when required database/object-store/runtime/gateway configuration is missing or unsafe.
- M1-M3 route/client contract tests fail when backend route shapes drift.
- M2 job processing cannot claim the same queued job twice in a database-backed repository flow.
- M3 device writes have a documented and test-backed lease/timeout boundary before real-device rollout.
- `npm run test:all`, `npm run build`, and targeted readiness tests pass.

## File Structure

Create:

- `server/modules/operations/health.ts`: pure readiness model and dependency checks.
- `server/modules/operations/health.test.ts`: unit tests for live and ready health responses.
- `server/modules/operations/routes.ts`: `/health/live`, `/health/ready`, and compatibility `/api/v1/health`.
- `server/modules/operations/routes.test.ts`: route-level readiness tests.
- `server/modules/contracts/routeManifest.ts`: static route manifest for M1-M3 API surface.
- `server/modules/contracts/routeManifest.test.ts`: detects missing route groups and duplicate route ids.
- `server/migrations/0006_m3_5_job_leases.sql`: job lease columns.
- `server/migrations/0007_m3_5_device_leases.sql`: device lease table.

Modify:

- `docs/exec-plans/active/development-roadmap.md`: insert M3.5 before M4.
- `docs/PLANS.md`: list M3.5 as the current active execution plan.
- `server/app.ts`: register operations routes through the new module.
- `server/config/env.ts`: enforce production configuration gates.
- `server/modules/logs/repository.ts`: add job leasing behavior.
- `server/modules/logs/worker.ts`: consume leased jobs idempotently.
- `server/modules/logs/objectStore.ts`: expose readiness probes.
- `server/modules/debugging/repository.ts`: add device/session lease helpers.
- `server/modules/debugging/service.ts`: enforce lease checks before production gateway writes.
- `docs/SECURITY.md`, `docs/RELIABILITY.md`, `docs/QUALITY_SCORE.md`, `docs/exec-plans/tech-debt-tracker.md`: document status and remaining risks.

## Task 1: Operations Health And Readiness Endpoints

**Files:**
- Create: `server/modules/operations/health.ts`
- Create: `server/modules/operations/health.test.ts`
- Create: `server/modules/operations/routes.ts`
- Create: `server/modules/operations/routes.test.ts`
- Modify: `server/app.ts`
- Modify: `docs/RELIABILITY.md`

- [ ] **Step 1: Write failing health model tests**

Add `server/modules/operations/health.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildLiveHealth, buildReadyHealth } from "./health";

describe("operations health", () => {
  it("reports liveness without checking dependencies", () => {
    expect(buildLiveHealth()).toMatchObject({
      ok: true,
      service: "wiseeff-api",
      status: "live"
    });
  });

  it("reports ready when database dependency passes", async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ ok: 1 }], rowCount: 1 })) };

    await expect(buildReadyHealth({ db })).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        service: "wiseeff-api",
        status: "ready",
        dependencies: {
          database: { ok: true, status: "ready" }
        }
      }
    });
  });

  it("returns 503 with actionable dependency status when database is missing", async () => {
    await expect(buildReadyHealth({})).resolves.toMatchObject({
      status: 503,
      body: {
        ok: false,
        service: "wiseeff-api",
        status: "not_ready",
        dependencies: {
          database: {
            ok: false,
            status: "missing",
            message: "DATABASE_URL is not configured for this API process."
          }
        }
      }
    });
  });
});
```

- [ ] **Step 2: Run model tests to verify RED**

Run:

```bash
npm run test:server -- server/modules/operations/health.test.ts
```

Expected: FAIL because `server/modules/operations/health.ts` does not exist.

- [ ] **Step 3: Implement minimal health model**

Create `server/modules/operations/health.ts` with the public functions `buildLiveHealth()` and `buildReadyHealth({ db })`. `buildReadyHealth` must call `db.query("select 1 as ok")` when `db` exists, return status 200 when it succeeds, return status 503 when `db` is missing, and return status 503 with a failure message when the query throws.

- [ ] **Step 4: Run model tests to verify GREEN**

Run:

```bash
npm run test:server -- server/modules/operations/health.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing route tests**

Add `server/modules/operations/routes.test.ts` with tests for:

- `GET /health/live` returns `{ ok: true, service: "wiseeff-api", status: "live" }`.
- `GET /health/ready` returns 200 with `dependencies.database.status === "ready"` when the injected db query succeeds.
- `GET /health/ready` returns 503 with `dependencies.database.status === "missing"` when no db is injected.
- `GET /api/v1/health` remains compatible and returns `{ ok: true, service: "wiseeff-api" }`.

- [ ] **Step 6: Run route tests to verify RED**

Run:

```bash
npm run test:server -- server/modules/operations/routes.test.ts
```

Expected: FAIL because `registerOperationsRoutes` does not exist.

- [ ] **Step 7: Implement routes and app registration**

Create `server/modules/operations/routes.ts` exporting:

```ts
export function registerOperationsRoutes(router: WiseEffRouter, options: { db?: Database }) {
  router.get("/health/live", async () => ({ status: 200, body: buildLiveHealth() }));
  router.get("/health/ready", async () => buildReadyHealth({ db: options.db }));
  router.get("/api/v1/health", async () => ({ status: 200, body: { ok: true, service: "wiseeff-api" } }));
}
```

Modify `server/app.ts` to import `registerOperationsRoutes`, remove the inline `/api/v1/health` handler, and call:

```ts
registerOperationsRoutes(router, { db: options.db });
```

- [ ] **Step 8: Run route and app tests to verify GREEN**

Run:

```bash
npm run test:server -- server/modules/operations/health.test.ts server/modules/operations/routes.test.ts server/app.test.ts
```

Expected: PASS.

- [ ] **Step 9: Update reliability docs**

In `docs/RELIABILITY.md`, update Health Checks to list:

- `/health/live`: process is alive and can serve HTTP.
- `/health/ready`: commercial readiness check for configured dependencies.
- `/api/v1/health`: compatibility smoke endpoint for existing clients.

- [ ] **Step 10: Commit**

Run:

```bash
git add server/modules/operations server/app.ts docs/RELIABILITY.md
git commit -m "feat: add commercial readiness health checks"
```

## Task 2: Production Environment Contract

**Files:**
- Modify: `server/config/env.ts`
- Create or modify: `server/config/env.test.ts`
- Modify: `README.md`
- Modify: `docs/RELIABILITY.md`

- [ ] **Step 1: Write failing env tests**

Add tests proving:

- production throws `DATABASE_URL is required in production` when `DATABASE_URL` is absent.
- production throws `OBJECT_STORE_ROOT is required in production` when `OBJECT_STORE_ROOT` is blank.
- production still throws `MOCK_RUNTIME_ENABLED cannot be true in production` when mock runtime is enabled.

- [ ] **Step 2: Run env tests to verify RED**

Run:

```bash
npm run test:server -- server/config/env.test.ts
```

Expected: FAIL for missing production gates.

- [ ] **Step 3: Implement production gates**

In `server/config/env.ts`, after parsing:

```ts
if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in production");
}
if (env.NODE_ENV === "production" && !env.OBJECT_STORE_ROOT.trim()) {
  throw new Error("OBJECT_STORE_ROOT is required in production");
}
```

- [ ] **Step 4: Run env tests to verify GREEN**

Run:

```bash
npm run test:server -- server/config/env.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/config/env.ts server/config/env.test.ts README.md docs/RELIABILITY.md
git commit -m "fix: enforce production environment contract"
```

## Task 3: M1-M3 API Contract Drift Guard

**Files:**
- Create: `server/modules/contracts/routeManifest.ts`
- Create: `server/modules/contracts/routeManifest.test.ts`
- Modify: `docs/design-docs/api-contract.md`

- [ ] **Step 1: Write failing manifest tests**

`routeManifest.test.ts` must assert:

- every route has a unique `id`.
- route groups include `parameters`, `logs`, `jobs`, `debugging`, and `operations`.
- `debugging.writeNode` is `POST /api/v1/debugging/nodes/write`.
- `logs.upload` is `POST /api/v1/logs`.
- `parameters.mergeChangeRequest` is `POST /api/v1/parameter-change-requests/:requestId/merge`.

- [ ] **Step 2: Implement static manifest**

Add route entries with `id`, `method`, `path`, `module`, and `stability: "mvp" | "commercial-readiness"`.

- [ ] **Step 3: Run contract tests**

```bash
npm run test:server -- server/modules/contracts/routeManifest.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add server/modules/contracts docs/design-docs/api-contract.md
git commit -m "test: add api route contract manifest"
```

## Task 4: M2 Worker Leasing And Idempotency

**Files:**
- Modify: `server/modules/jobs/types.ts`
- Modify: `server/modules/jobs/repository.ts`
- Modify: `server/modules/logs/worker.ts`
- Modify: `server/modules/logs/worker.test.ts`
- Create: `server/migrations/0006_m3_5_job_leases.sql`

- [ ] **Step 1: Write failing worker tests**

Add a worker test where two claim attempts target the same queued job and only one receives it. The second call must receive no job or a clear already-claimed result.

- [ ] **Step 2: Add job lease migration**

Add:

```sql
alter table jobs add column if not exists lease_owner text;
alter table jobs add column if not exists lease_expires_at timestamptz;
alter table jobs add column if not exists attempt_count integer not null default 0;
```

- [ ] **Step 3: Implement claim semantics**

Add a repository method that atomically claims queued or expired jobs by setting `lease_owner`, `lease_expires_at`, `status`, and `attempt_count`, returning the claimed row.

- [ ] **Step 4: Run worker tests**

```bash
npm run test:server -- server/modules/logs/worker.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add server/modules/jobs server/modules/logs server/migrations/0006_m3_5_job_leases.sql
git commit -m "fix: lease log analysis jobs"
```

## Task 5: Object Store Readiness Boundary

**Files:**
- Modify: `server/modules/logs/objectStore.ts`
- Modify: `server/modules/logs/objectStore.test.ts`
- Modify: `server/modules/operations/health.ts`
- Modify: `server/modules/operations/health.test.ts`
- Modify: `docs/RELIABILITY.md`

- [ ] **Step 1: Write failing readiness tests**

Add tests requiring object-store readiness to report `ready`, `missing`, and `failed` statuses.

- [ ] **Step 2: Implement object-store `checkHealth()`**

The local adapter must verify the root directory and perform a small write/read/delete probe in test/development.

- [ ] **Step 3: Include object store in `/health/ready`**

Readiness returns 503 if object store is missing or failed.

- [ ] **Step 4: Commit**

```bash
git add server/modules/logs/objectStore.ts server/modules/operations docs/RELIABILITY.md
git commit -m "feat: include object store readiness"
```

## Task 6: Debugging Device Lease Boundary

**Files:**
- Modify: `server/modules/debugging/types.ts`
- Modify: `server/modules/debugging/repository.ts`
- Modify: `server/modules/debugging/service.ts`
- Modify: `server/modules/debugging/service.test.ts`
- Create: `server/migrations/0007_m3_5_device_leases.sql`
- Modify: `docs/SECURITY.md`

- [ ] **Step 1: Write failing service tests**

Add tests proving a second active session cannot write to a leased device until the lease expires or is released.

- [ ] **Step 2: Add lease migration**

Add a `debug_device_leases` table keyed by device/project with owner session, expiration, and audit timestamps.

- [ ] **Step 3: Enforce lease on write and rollback**

Before node write or rollback, the service must acquire or validate a lease for the session.

- [ ] **Step 4: Commit**

```bash
git add server/modules/debugging server/migrations/0007_m3_5_device_leases.sql docs/SECURITY.md
git commit -m "fix: enforce debugging device leases"
```

## Task 7: Structured Request And Audit Correlation

**Files:**
- Modify: `server/shared/http/server.ts`
- Modify: `server/shared/http/server.test.ts`
- Modify: `server/modules/audit/types.ts`
- Modify: `docs/SECURITY.md`

- [ ] **Step 1: Write failing request-id tests**

Require `x-request-id` to be reflected or generated and passed into route request context.

- [ ] **Step 2: Implement request id propagation**

Route handlers receive a stable `request.requestId`; audit helpers use it when available.

- [ ] **Step 3: Commit**

```bash
git add server/shared/http server/modules/audit docs/SECURITY.md
git commit -m "feat: propagate request ids through audit"
```

## Task 8: M3.5 Acceptance And Documentation

**Files:**
- Modify: `package.json`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`
- Modify: `docs/FRONTEND.md`
- Modify: `README.md`

- [ ] **Step 1: Add M3.5 verification script**

Add:

```json
"test:m3-5": "npm run test:all && npm run build && npm run test:e2e -- e2e/debugging.api.spec.ts"
```

- [ ] **Step 2: Update docs**

Document readiness commands, environment variables, known production gaps, and which technical debt IDs are reduced but still open.

- [ ] **Step 3: Final verification**

Run:

```bash
npm run test:all
npm run build
git diff --check
```

Run E2E if `DATABASE_URL` is available:

```bash
npm run test:m3-5
```

- [ ] **Step 4: Commit**

```bash
git add package.json docs
git commit -m "docs: document commercial readiness verification"
```

## Execution Order

1. Task 1: operations health endpoints.
2. Task 2: production env contract.
3. Task 3: API route contract manifest.
4. Task 4: worker leasing.
5. Task 5: object-store readiness.
6. Task 6: debugging device leases.
7. Task 7: request/audit correlation.
8. Task 8: acceptance docs and final verification.

## Risk Notes

- M3.5 intentionally avoids full OIDC, full queue infrastructure, and real HDC rollout. Those should get separate implementation plans once the hardened seams are tested.
- The current Node version in this workspace is 22.12.0; `npm ci` reports package engine warnings for packages that prefer Node 22.13.0+.
- M1 completed plan checkboxes were not all backfilled, but PR #33 is merged. Do not use unchecked boxes in completed historical plans as the source of truth for implementation status.

## Self-Review

- Spec coverage: roadmap update, commercial readiness gates, production config, contract drift, worker/object-store/device/observability hardening, and M4 sequencing are covered by Tasks 1-8.
- Placeholder scan: no deferred placeholder markers or unspecified Task 1 implementation steps remain.
- Type consistency: operations health types use `Database` from `server/shared/database/client`; route registration uses existing `WiseEffRouter`.
