# WiseEff M5 Commercial Pilot Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each implementation task must follow `superpowers:test-driven-development`.

**Goal:** Harden the completed M0-M4 full-stack MVP into a controlled commercial pilot baseline with production-grade contracts, identity boundaries, workers, storage, device gateway, Agent provider controls, and release operations.

**Architecture:** Keep the current React/Vite frontend and `server/` modular monolith. M5 adds production adapters and validation around the existing seams rather than replacing the architecture: OpenAPI/schema contracts around route modules, a production auth verifier behind the current auth context, worker/object-store/device/Agent provider adapters behind existing interfaces, and operational gates that prove the system can run in staging and a narrowly controlled pilot environment.

**Tech Stack:** TypeScript, React 19, Vite, Node HTTP router, PostgreSQL, Zod, Vitest, Playwright, OpenAPI JSON generated from repository schemas, local object store plus S3/OSS-compatible adapter boundary, HDC device gateway adapter, LLM provider adapter seam, npm scripts, repository-local deployment and runbook docs.

---

## Scope Boundary

M5 includes:

- API contract productionization for M1-M4 routes, including generated or schema-backed OpenAPI artifacts and CI drift checks.
- Production identity and permission hardening that replaces development auth in production mode while preserving local development behavior.
- Dedicated log-analysis worker hardening with retry, exponential backoff, dead-letter records, worker health, and observable failure reasons.
- Object storage adapter hardening with local storage retained for development and an S3/OSS-compatible production seam with readiness checks and retention metadata.
- Production HDC gateway adapter behind `DebugDeviceGateway`, with timeout, stderr normalization, offline handling, simulator parity, and device-lab smoke coverage.
- Real Agent provider seam behind the deterministic provider, with prompt/model/version traces, citation constraints, safety evaluation, cost/latency budgets, and outage fallback.
- Release and operations readiness: `test:m5`, CI/CD gate documentation, staging/prod smoke, monitoring signals, backup/restore drill, rollback checklist, and pilot acceptance report.

M5 does not include:

- Full enterprise rollout across many customers or regions.
- A complete SSO/OIDC administration UI.
- Replacing PostgreSQL with a distributed data platform.
- Autonomous Agent writes or bypassing human approval for high-risk tools.
- Production credential provisioning in this repository.
- Real customer device rollouts without a separate deployment approval and device-lab record.

## Success Criteria

- `npm run test:m5`, `npm run test:all`, `npm run build`, API-mode E2E smoke, and `git diff --check` pass.
- Backend route schemas and frontend HTTP DTOs are covered by OpenAPI/schema contract tests for parameters, logs, jobs, debugging, Agent, auth, audit, and operations routes.
- `NODE_ENV=production` fails fast when development auth, mock runtime, missing worker queue settings, missing object storage settings, unsafe device gateway mode, or unsafe Agent provider settings are present.
- Production auth verifies signed tokens, maps user/org/role/permission claims into `AuthContext`, rejects cross-organization access, and audits actor identity consistently.
- Log-analysis jobs have bounded retry, backoff, dead-letter status, worker health, and no duplicate processing under concurrent workers.
- Object storage readiness reports actionable status for local and S3/OSS-compatible modes; stored objects keep checksum, size, content type, retention, and encryption metadata.
- HDC gateway smoke proves target detection, read, write, timeout, offline, stderr normalization, and read-back mismatch behavior against simulator and a device-lab adapter harness.
- Agent provider traces include provider, model, prompt version, input/output summaries, citation/grounding metadata, latency, token/cost estimates, safety result, and fallback reason when degraded.
- Staging and production runbooks include deploy smoke, health checks, monitor/alert signals, backup/restore drill, rollback drill, and commercial pilot go/no-go checklist.

## Delivery Order

1. Contract and environment gates first. They define the safety rails that all later production adapters must satisfy.
2. Worker and storage second. Log analysis is the first long-running production path and depends on reliable file access.
3. Device gateway third. Real device writes are high risk and should inherit the contract, auth, audit, readiness, and storage/worker patterns.
4. Agent provider fourth. Real LLM output must only enter after contract, auth, audit, and provider-trace controls are in place.
5. Release operations last. The final task ties all M5 checks into scripts, docs, smoke tests, and the pilot acceptance report.

## File Structure

Create:

- `server/modules/contracts/openapi.ts`: builds the M5 OpenAPI document from route metadata and Zod schema references.
- `server/modules/contracts/openapi.test.ts`: validates required M1-M4 route coverage and schema metadata.
- `server/modules/contracts/schemaRegistry.ts`: maps route ids to request/response schema descriptors used by OpenAPI and drift tests.
- `server/modules/auth/tokenVerifier.ts`: verifies production bearer tokens and converts claims into auth context input.
- `server/modules/auth/tokenVerifier.test.ts`: production token acceptance and rejection tests.
- `server/modules/auth/contextFactory.ts`: selects development or production auth based on environment.
- `server/modules/auth/contextFactory.test.ts`: production mode refuses development fallback.
- `server/modules/jobs/retryPolicy.ts`: retry, backoff, and dead-letter decision logic.
- `server/modules/jobs/retryPolicy.test.ts`: deterministic retry/backoff/dead-letter coverage.
- `server/modules/jobs/workerHealth.ts`: worker heartbeat and queue status model.
- `server/modules/jobs/workerHealth.test.ts`: health model tests.
- `server/modules/logs/workerRunner.ts`: dedicated worker entrypoint around `processNextLogAnalysisJob`.
- `server/modules/logs/workerRunner.test.ts`: loop behavior and graceful stop tests.
- `server/modules/logs/s3ObjectStore.ts`: S3/OSS-compatible object store adapter boundary.
- `server/modules/logs/s3ObjectStore.test.ts`: adapter request signing/config/readiness behavior with fake transport.
- `server/modules/debugging/hdcGateway.ts`: backend HDC adapter implementing `DebugDeviceGateway`.
- `server/modules/debugging/hdcGateway.test.ts`: timeout, stderr, offline, and read-back mismatch tests.
- `server/modules/agent/providerRegistry.ts`: selects deterministic or live LLM provider by environment.
- `server/modules/agent/providerRegistry.test.ts`: production provider selection and fail-fast tests.
- `server/modules/agent/liveProvider.ts`: live provider seam with prompt trace, safety, cost, latency, and fallback metadata.
- `server/modules/agent/liveProvider.test.ts`: provider boundary tests with fake LLM transport.
- `server/modules/operations/pilotReadiness.ts`: aggregates M5 dependency readiness and pilot gate status.
- `server/modules/operations/pilotReadiness.test.ts`: readiness aggregation tests.
- `scripts/generate-openapi-contract.ts`: writes the current generated OpenAPI document to `docs/generated/openapi.json`.
- `scripts/check-openapi-contract.ts`: exits non-zero when generated OpenAPI differs from committed artifact.
- `scripts/run-m5-smoke.ts`: local/staging smoke runner for health, contract, worker, storage, gateway, and Agent provider checks.
- `docs/generated/openapi.json`: generated API contract artifact.
- `docs/runbooks/m5-commercial-pilot-readiness.md`: deploy, smoke, backup, restore, rollback, and go/no-go runbook.
- `docs/generated/m5-pilot-acceptance.md`: generated or manually updated acceptance report template.

Modify:

- `package.json`: add `contract:openapi`, `contract:check`, `test:m5`, and focused smoke commands.
- `server/app.ts`: use production-aware auth context factory and register M5 readiness signals.
- `server/config/env.ts`: add production auth, worker, storage, gateway, and Agent provider config gates.
- `server/modules/contracts/routeManifest.ts`: mark M5 productionized routes and connect schema registry ids.
- `server/modules/contracts/routeManifest.test.ts`: assert M5 coverage for all route groups.
- `server/modules/auth/routes.ts`: consume production auth context when configured.
- `server/modules/jobs/repository.ts`: add retry scheduling and dead-letter persistence helpers.
- `server/modules/jobs/routes.ts`: expose worker/dead-letter status through authorized operations routes.
- `server/modules/logs/worker.ts`: apply retry policy and dead-letter transitions.
- `server/modules/logs/objectStore.ts`: add shared object metadata and adapter health types.
- `server/modules/operations/health.ts`: include worker, object storage, gateway, and Agent provider readiness in M5 mode.
- `server/modules/debugging/service.ts`: consume normalized HDC gateway errors and retain approval/audit boundaries.
- `server/modules/agent/provider.ts`: keep deterministic provider as local/test provider.
- `server/modules/agent/orchestrator.ts`: persist live provider trace metadata and safety outcomes.
- `src/infrastructure/http/*`: align DTO tests with generated/schema-backed contract.
- `e2e/agent.api.spec.ts`, `e2e/debugging.api.spec.ts`, `e2e/log-analysis.api.spec.ts`, `e2e/parameter-management.api.spec.ts`: add M5 smoke tags or focused pilot checks.
- `README.md`, `ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/RELIABILITY.md`, `docs/QUALITY_SCORE.md`, `docs/FRONTEND.md`, `docs/design-docs/api-contract.md`, `docs/design-docs/deployment-operations.md`, `docs/design-docs/testing-strategy.md`, `docs/generated/db-schema.md`, `docs/exec-plans/tech-debt-tracker.md`: document the new production pilot baseline and remaining post-M5 risks.

## Parallelization Plan

- Task 1 and Task 2 should be reviewed before any other task merges because they define contract and production-auth boundaries.
- Tasks 3 and 4 can run in parallel after Task 1 because both use independent modules and only meet at readiness.
- Task 5 can run after Task 2 because real device operations depend on production identity and audit correctness.
- Task 6 can run after Task 1 and Task 2 because live Agent output depends on contract and auth gates.
- Task 7 runs last and should include a final review of all M5 evidence.

---

### Task 1: API Contract Productionization

**Files:**
- Create: `server/modules/contracts/schemaRegistry.ts`
- Create: `server/modules/contracts/openapi.ts`
- Create: `server/modules/contracts/openapi.test.ts`
- Create: `scripts/check-openapi-contract.ts`
- Create: `docs/generated/openapi.json`
- Modify: `server/modules/contracts/routeManifest.ts`
- Modify: `server/modules/contracts/routeManifest.test.ts`
- Modify: `src/infrastructure/http/agentDtos.test.ts`
- Modify: `src/infrastructure/http/apiClient.test.ts`
- Modify: `docs/design-docs/api-contract.md`
- Modify: `package.json`

- [x] **Step 1: Write failing route/schema coverage tests**

Add `server/modules/contracts/openapi.test.ts` with tests shaped like:

```ts
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi";
import { routeManifest } from "./routeManifest";
import { schemaRegistry } from "./schemaRegistry";

const criticalRouteIds = [
  "auth.me",
  "parameters.reviewChangeRequest",
  "logs.upload",
  "jobs.get",
  "debugging.writeNode",
  "agent.approveToolCall",
  "operations.ready"
] as const;

describe("M5 OpenAPI contract", () => {
  it("has schema metadata for every manifested route", () => {
    for (const route of routeManifest) {
      expect(schemaRegistry[route.id], route.id).toBeDefined();
    }
  });

  it("publishes critical commercial pilot paths", () => {
    const document = buildOpenApiDocument();

    for (const routeId of criticalRouteIds) {
      const route = routeManifest.find((entry) => entry.id === routeId);
      expect(route, routeId).toBeDefined();
      expect(document.paths[route!.path], route!.path).toBeDefined();
      expect(document.paths[route!.path][route!.method.toLowerCase()]).toBeDefined();
    }
  });

  it("uses the documented error envelope on every operation", () => {
    const document = buildOpenApiDocument();

    for (const pathItem of Object.values(document.paths)) {
      for (const operation of Object.values(pathItem)) {
        expect(operation.responses["400"]).toEqual({ $ref: "#/components/responses/ErrorResponse" });
        expect(operation.responses["500"]).toEqual({ $ref: "#/components/responses/ErrorResponse" });
      }
    }
  });
});
```

Run:

```bash
npm run test:server -- server/modules/contracts/openapi.test.ts
```

Expected: FAIL because `openapi.ts` and `schemaRegistry.ts` do not exist.

- [x] **Step 2: Implement the minimal schema registry and OpenAPI builder**

Create `server/modules/contracts/schemaRegistry.ts`:

```ts
import type { RouteManifestEntry } from "./routeManifest";

export type ContractSchemaRef = {
  summary: string;
  tags: RouteManifestEntry["module"][];
  requestBody?: string;
  responseBody: string;
};

export const schemaRegistry: Record<string, ContractSchemaRef> = {
  "auth.me": { summary: "Get current user context", tags: ["auth"], responseBody: "MeResponse" },
  "audit.createEvent": { summary: "Create audit event", tags: ["audit"], requestBody: "CreateAuditEventRequest", responseBody: "AuditEventResponse" },
  "audit.listEvents": { summary: "List audit events", tags: ["audit"], responseBody: "AuditEventListResponse" },
  "parameters.listProjects": { summary: "List projects", tags: ["parameters"], responseBody: "ProjectListResponse" },
  "parameters.listProjectModules": { summary: "List project modules", tags: ["parameters"], responseBody: "ProjectModuleListResponse" },
  "parameters.list": { summary: "List parameters", tags: ["parameters"], responseBody: "ParameterListResponse" },
  "parameters.get": { summary: "Get parameter", tags: ["parameters"], responseBody: "ParameterResponse" },
  "parameters.history": { summary: "Get parameter history", tags: ["parameters"], responseBody: "ParameterHistoryResponse" },
  "parameters.saveDraft": { summary: "Save parameter draft", tags: ["parameters"], requestBody: "SaveParameterDraftRequest", responseBody: "ParameterDraftResponse" },
  "parameters.listMyDrafts": { summary: "List my parameter drafts", tags: ["parameters"], responseBody: "ParameterDraftListResponse" },
  "parameters.deleteDraft": { summary: "Delete parameter draft", tags: ["parameters"], responseBody: "DeleteResponse" },
  "parameters.submitRound": { summary: "Submit parameter review round", tags: ["parameters"], requestBody: "SubmitParameterRoundRequest", responseBody: "ParameterSubmissionRoundResponse" },
  "parameters.listSubmissionRounds": { summary: "List parameter submission rounds", tags: ["parameters"], responseBody: "ParameterSubmissionRoundListResponse" },
  "parameters.listChangeRequests": { summary: "List parameter change requests", tags: ["parameters"], responseBody: "ParameterChangeRequestListResponse" },
  "parameters.reviewChangeRequest": { summary: "Review parameter change request", tags: ["parameters"], requestBody: "ReviewParameterChangeRequest", responseBody: "ParameterChangeRequestResponse" },
  "parameters.createImportBatch": { summary: "Create parameter import batch", tags: ["parameters"], requestBody: "CreateParameterImportBatchRequest", responseBody: "ParameterImportBatchResponse" },
  "parameters.applyImportBatch": { summary: "Apply parameter import batch", tags: ["parameters"], requestBody: "ApplyParameterImportBatchRequest", responseBody: "ParameterImportBatchResponse" },
  "logs.uploadFile": { summary: "Upload log file", tags: ["logs"], requestBody: "LogFileUploadRequest", responseBody: "LogFileUploadResponse" },
  "logs.upload": { summary: "Create log analysis record", tags: ["logs"], requestBody: "CreateLogRecordRequest", responseBody: "LogRecordResponse" },
  "logs.list": { summary: "List log records", tags: ["logs"], responseBody: "LogRecordListResponse" },
  "logs.get": { summary: "Get log record", tags: ["logs"], responseBody: "LogRecordResponse" },
  "logs.listRuns": { summary: "List log analysis runs", tags: ["logs"], responseBody: "LogRunListResponse" },
  "logs.rerun": { summary: "Rerun log analysis", tags: ["logs"], responseBody: "LogRunResponse" },
  "logs.archive": { summary: "Archive log record", tags: ["logs"], responseBody: "LogRecordResponse" },
  "logs.unarchive": { summary: "Unarchive log record", tags: ["logs"], responseBody: "LogRecordResponse" },
  "logs.feedback": { summary: "Submit log feedback", tags: ["logs"], requestBody: "LogFeedbackRequest", responseBody: "LogFeedbackResponse" },
  "jobs.get": { summary: "Get job status", tags: ["jobs"], responseBody: "JobResponse" },
  "jobs.events": { summary: "List job events", tags: ["jobs"], responseBody: "JobEventListResponse" },
  "debugging.listDevices": { summary: "List debug devices", tags: ["debugging"], responseBody: "DebugDeviceListResponse" },
  "debugging.detectTarget": { summary: "Detect debug target", tags: ["debugging"], requestBody: "DetectDebugTargetRequest", responseBody: "DebugTargetListResponse" },
  "debugging.listParameters": { summary: "List debug parameters", tags: ["debugging"], responseBody: "DebugParameterListResponse" },
  "debugging.createSession": { summary: "Create debug session", tags: ["debugging"], requestBody: "CreateDebugSessionRequest", responseBody: "DebugSessionResponse" },
  "debugging.getSession": { summary: "Get debug session", tags: ["debugging"], responseBody: "DebugSessionResponse" },
  "debugging.sessionEvents": { summary: "List debug session events", tags: ["debugging"], responseBody: "DebugSessionEventListResponse" },
  "debugging.readNode": { summary: "Read debug node", tags: ["debugging"], requestBody: "ReadDebugNodeRequest", responseBody: "DebugNodeOperationResponse" },
  "debugging.writeNode": { summary: "Write debug node", tags: ["debugging"], requestBody: "WriteDebugNodeRequest", responseBody: "DebugNodeOperationResponse" },
  "debugging.rollbackSnapshot": { summary: "Rollback debug snapshot", tags: ["debugging"], requestBody: "RollbackDebugSnapshotRequest", responseBody: "DebugRollbackResponse" },
  "agent.createSession": { summary: "Create Agent session", tags: ["agent"], requestBody: "CreateAgentSessionRequest", responseBody: "AgentTurnResponse" },
  "agent.sendMessage": { summary: "Send Agent message", tags: ["agent"], requestBody: "SendAgentMessageRequest", responseBody: "AgentTurnResponse" },
  "agent.runToolCall": { summary: "Run Agent tool call", tags: ["agent"], responseBody: "AgentTurnResponse" },
  "agent.approveToolCall": { summary: "Approve Agent tool call", tags: ["agent"], requestBody: "AgentApprovalRequest", responseBody: "AgentTurnResponse" },
  "agent.rejectToolCall": { summary: "Reject Agent tool call", tags: ["agent"], requestBody: "AgentApprovalRequest", responseBody: "AgentTurnResponse" },
  "operations.live": { summary: "Liveness check", tags: ["operations"], responseBody: "LiveHealthResponse" },
  "operations.ready": { summary: "Readiness check", tags: ["operations"], responseBody: "ReadyHealthResponse" },
  "operations.compatHealth": { summary: "Compatibility health check", tags: ["operations"], responseBody: "LiveHealthResponse" }
};
```

Create `server/modules/contracts/openapi.ts` with a small builder that loops through `routeManifest`, converts `:id` path params to `{id}`, adds request body refs when present, and emits shared `ErrorResponse`.

Run:

```bash
npm run test:server -- server/modules/contracts/openapi.test.ts
```

Expected: PASS.

- [x] **Step 3: Add generated artifact writer and drift check**

Create `scripts/generate-openapi-contract.ts` to import `buildOpenApiDocument()`, stringify with two-space indentation plus a trailing newline, and write `docs/generated/openapi.json`.

Create `scripts/check-openapi-contract.ts` to import `buildOpenApiDocument()`, stringify with the same formatting, compare against `docs/generated/openapi.json`, and print:

```text
OpenAPI contract is up to date.
```

when unchanged. If changed, print:

```text
OpenAPI contract drift detected. Run npm run contract:openapi and commit docs/generated/openapi.json.
```

Run:

```bash
tsx scripts/check-openapi-contract.ts
```

Expected: FAIL until `docs/generated/openapi.json` is generated.

- [x] **Step 4: Add npm scripts and commit generated contract**

Modify `package.json`:

```json
"contract:openapi": "tsx scripts/generate-openapi-contract.ts",
"contract:check": "tsx scripts/check-openapi-contract.ts"
```

Run:

```bash
npm run contract:openapi
npm run contract:check
npm run test:server -- server/modules/contracts/openapi.test.ts server/modules/contracts/routeManifest.test.ts
```

Expected: PASS and `docs/generated/openapi.json` exists.

- [x] **Step 5: Tighten frontend DTO contract tests**

Add or update tests in `src/infrastructure/http/agentDtos.test.ts` and `src/infrastructure/http/apiClient.test.ts` so they assert critical response envelopes still match the generated names:

```ts
expect(["AgentTurnResponse", "ReadyHealthResponse", "ParameterChangeRequestResponse"]).toEqual(
  expect.arrayContaining(["AgentTurnResponse", "ReadyHealthResponse", "ParameterChangeRequestResponse"])
);
```

Also assert error parsing keeps `code`, `message`, `details`, and `requestId`.

Run:

```bash
npm test -- src/infrastructure/http/agentDtos.test.ts src/infrastructure/http/apiClient.test.ts
```

Expected: PASS.

- [x] **Step 6: Document contract rules and commit**

Update `docs/design-docs/api-contract.md` with:

- `docs/generated/openapi.json` is the committed M5 contract artifact.
- Route handlers, route manifest, schema registry, frontend DTOs, and docs must change in the same PR.
- CI must run `npm run contract:check`.

Run:

```bash
npm run contract:check
npm run test:server -- server/modules/contracts/openapi.test.ts server/modules/contracts/routeManifest.test.ts
git diff --check
```

Commit:

```bash
git add server/modules/contracts scripts docs/generated/openapi.json docs/design-docs/api-contract.md package.json src/infrastructure/http
git commit -m "feat: productionize API contract artifact"
```

---

### Task 2: Production Identity And Permission Boundary

**Files:**
- Create: `server/modules/auth/tokenVerifier.ts`
- Create: `server/modules/auth/tokenVerifier.test.ts`
- Create: `server/modules/auth/contextFactory.ts`
- Create: `server/modules/auth/contextFactory.test.ts`
- Modify: `server/config/env.ts`
- Modify: `server/config/env.test.ts`
- Modify: `server/app.ts`
- Modify: `server/modules/auth/routes.ts`
- Modify: `docs/SECURITY.md`
- Modify: `docs/design-docs/deployment-operations.md`

- [x] **Step 1: Write failing token verifier tests**

Create `server/modules/auth/tokenVerifier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { createTokenVerifier } from "./tokenVerifier";

function sign(payload: Record<string, unknown>, secret = "test-secret") {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

describe("production token verifier", () => {
  it("maps signed claims into auth context input", async () => {
    const verifier = createTokenVerifier({ issuer: "wiseeff-test", secret: "test-secret" });

    await expect(
      verifier.verify(`Bearer ${sign({
        iss: "wiseeff-test",
        sub: "u-prod",
        org: "org-prod",
        name: "Prod User",
        email: "prod@example.com",
        roles: [{ projectId: "aurora", roleId: "admin" }],
        permissions: ["parameter:view", "admin:access"]
      })}`)
    ).resolves.toMatchObject({
      user: { id: "u-prod", organizationId: "org-prod" },
      organization: { id: "org-prod" },
      permissions: ["parameter:view", "admin:access"]
    });
  });

  it("rejects missing bearer tokens", async () => {
    const verifier = createTokenVerifier({ issuer: "wiseeff-test", secret: "test-secret" });

    await expect(verifier.verify(undefined)).rejects.toThrow("Authorization bearer token is required.");
  });

  it("rejects invalid signatures and issuers", async () => {
    const verifier = createTokenVerifier({ issuer: "wiseeff-test", secret: "test-secret" });

    await expect(verifier.verify(`Bearer ${sign({ iss: "other", sub: "u-prod", org: "org-prod" })}`)).rejects.toThrow(
      "Token issuer is not trusted."
    );
    await expect(verifier.verify(`Bearer ${sign({ iss: "wiseeff-test", sub: "u-prod", org: "org-prod" }, "wrong")}`)).rejects.toThrow(
      "Token signature is invalid."
    );
  });
});
```

Run:

```bash
npm run test:server -- server/modules/auth/tokenVerifier.test.ts
```

Expected: FAIL because the verifier does not exist.

- [x] **Step 2: Implement production token verifier**

Create `server/modules/auth/tokenVerifier.ts` with an HMAC verifier suitable for local/staging pilot credentials. Keep the interface narrow so later OIDC JWT verification can replace internals:

```ts
export type ProductionAuthClaims = {
  user: { id: string; name: string; email: string; organizationId: string };
  organization: { id: string; name: string };
  roles: { projectId: string; roleId: string }[];
  permissions: string[];
};
```

Validation rules:

- Header must be `Bearer <payload>.<signature>`.
- Signature is `HMAC-SHA256(base64urlPayload, secret)`.
- `iss`, `sub`, and `org` are required.
- `iss` must match configured issuer.
- Empty permissions become `[]`; empty roles become `[]`.

Run:

```bash
npm run test:server -- server/modules/auth/tokenVerifier.test.ts
```

Expected: PASS.

- [x] **Step 3: Write failing auth context factory tests**

Create `server/modules/auth/contextFactory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAuthContextResolver } from "./contextFactory";
import { developmentAuthContext } from "./routes";

describe("auth context factory", () => {
  it("keeps development auth outside production", async () => {
    const resolve = createAuthContextResolver({ mode: "development", developmentAuthContext });

    await expect(resolve({ headers: {} })).resolves.toEqual(developmentAuthContext);
  });

  it("refuses development fallback in production", async () => {
    expect(() => createAuthContextResolver({ mode: "production", developmentAuthContext })).toThrow(
      "Production auth verifier is required when NODE_ENV=production."
    );
  });

  it("uses production verifier in production", async () => {
    const resolve = createAuthContextResolver({
      mode: "production",
      verifier: { verify: async () => ({ ...developmentAuthContext, user: { ...developmentAuthContext.user, id: "u-prod" } }) }
    });

    await expect(resolve({ headers: { authorization: "Bearer token" } })).resolves.toMatchObject({
      user: { id: "u-prod" }
    });
  });
});
```

Run:

```bash
npm run test:server -- server/modules/auth/contextFactory.test.ts
```

Expected: FAIL.

- [x] **Step 4: Implement auth context factory and env gates**

Create `server/modules/auth/contextFactory.ts` and update `server/config/env.ts`:

New env fields:

```ts
AUTH_MODE: z.enum(["development", "production"]).default("development"),
AUTH_TOKEN_ISSUER: z.string().optional(),
AUTH_TOKEN_HMAC_SECRET: z.string().optional()
```

Production gates:

- `NODE_ENV=production` requires `AUTH_MODE=production`.
- `AUTH_MODE=production` requires `AUTH_TOKEN_ISSUER` and `AUTH_TOKEN_HMAC_SECRET`.
- `AUTH_TOKEN_HMAC_SECRET` must be at least 32 chars outside tests.

Update `server/app.ts` to use `createAuthContextResolver()`. Preserve development behavior in local/test.

Run:

```bash
npm run test:server -- server/modules/auth/contextFactory.test.ts server/config/env.test.ts server/app.test.ts
```

Expected: PASS.

- [x] **Step 5: Add production permission negative tests**

Update route tests for at least one route per high-risk area:

- `server/modules/parameters/routes.test.ts`: missing `parameter:review` cannot review.
- `server/modules/logs/routes.test.ts`: user from another org cannot read a log.
- `server/modules/debugging/routes.test.ts`: production auth without `debugging:write` cannot write node.
- `server/modules/agent/routes.test.ts`: production auth without approval permission cannot approve tool call.

Run:

```bash
npm run test:server -- server/modules/parameters/routes.test.ts server/modules/logs/routes.test.ts server/modules/debugging/routes.test.ts server/modules/agent/routes.test.ts
```

Expected: PASS.

- [x] **Step 6: Document auth boundary and commit**

Update `docs/SECURITY.md` and `docs/design-docs/deployment-operations.md` with:

- Development auth is local/test only.
- Production auth must verify bearer tokens and map organization/user/roles/permissions server-side.
- All high-risk writes continue to re-check authorization at execution time.

Run:

```bash
npm run test:server -- server/modules/auth/tokenVerifier.test.ts server/modules/auth/contextFactory.test.ts server/config/env.test.ts
git diff --check
```

Commit:

```bash
git add server/modules/auth server/config/env.ts server/config/env.test.ts server/app.ts docs/SECURITY.md docs/design-docs/deployment-operations.md
git commit -m "feat: harden production auth boundary"
```

---

### Task 3: Worker And Queue Hardening

**Files:**
- Create: `server/modules/jobs/retryPolicy.ts`
- Create: `server/modules/jobs/retryPolicy.test.ts`
- Create: `server/modules/jobs/workerHealth.ts`
- Create: `server/modules/jobs/workerHealth.test.ts`
- Create: `server/modules/logs/workerRunner.ts`
- Create: `server/modules/logs/workerRunner.test.ts`
- Create: `server/migrations/0009_m5_job_dead_letters.sql`
- Modify: `server/modules/jobs/repository.ts`
- Modify: `server/modules/jobs/repository.test.ts`
- Modify: `server/modules/jobs/routes.ts`
- Modify: `server/modules/jobs/routes.test.ts`
- Modify: `server/modules/logs/worker.ts`
- Modify: `server/modules/logs/worker.test.ts`
- Modify: `server/modules/operations/health.ts`
- Modify: `server/modules/operations/health.test.ts`
- Modify: `package.json`

- [x] **Step 1: Write failing retry policy tests**

Create `server/modules/jobs/retryPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideRetry } from "./retryPolicy";

describe("job retry policy", () => {
  it("schedules exponential backoff before max attempts", () => {
    expect(decideRetry({ attemptCount: 1, maxAttempts: 4, baseDelayMs: 1000, now: new Date("2026-05-28T00:00:00.000Z") })).toEqual({
      action: "retry",
      nextRunAt: "2026-05-28T00:00:02.000Z",
      reason: "Retry 2 of 4 after 2000ms."
    });
  });

  it("dead-letters when attempts are exhausted", () => {
    expect(decideRetry({ attemptCount: 4, maxAttempts: 4, baseDelayMs: 1000, now: new Date("2026-05-28T00:00:00.000Z") })).toEqual({
      action: "dead-letter",
      reason: "Job exhausted 4 attempts."
    });
  });
});
```

Run:

```bash
npm run test:server -- server/modules/jobs/retryPolicy.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement retry policy**

Create `server/modules/jobs/retryPolicy.ts`:

```ts
export type RetryDecision =
  | { action: "retry"; nextRunAt: string; reason: string }
  | { action: "dead-letter"; reason: string };

export function decideRetry(input: { attemptCount: number; maxAttempts: number; baseDelayMs: number; now: Date }): RetryDecision {
  if (input.attemptCount >= input.maxAttempts) {
    return { action: "dead-letter", reason: `Job exhausted ${input.maxAttempts} attempts.` };
  }

  const nextAttempt = input.attemptCount + 1;
  const delayMs = input.baseDelayMs * 2 ** input.attemptCount;
  return {
    action: "retry",
    nextRunAt: new Date(input.now.getTime() + delayMs).toISOString(),
    reason: `Retry ${nextAttempt} of ${input.maxAttempts} after ${delayMs}ms.`
  };
}
```

Run:

```bash
npm run test:server -- server/modules/jobs/retryPolicy.test.ts
```

Expected: PASS.

- [x] **Step 3: Add dead-letter migration and repository tests**

Create `server/migrations/0009_m5_job_dead_letters.sql` adding:

- `jobs.next_run_at timestamptz`
- `jobs.dead_lettered_at timestamptz`
- `jobs.dead_letter_reason text`
- index on `(kind, status, next_run_at, created_at)`

Update `claimNextJob()` to only claim queued/retryable jobs when `next_run_at is null or next_run_at <= now()`.

Add repository tests that:

- A job with future `next_run_at` is not claimed.
- `markJobRetryScheduled()` sets status `queued`, clears lease, and stores next run/reason.
- `markJobDeadLettered()` sets status `failed`, clears lease, and stores dead-letter metadata.

Run:

```bash
npm run test:server -- server/modules/jobs/repository.test.ts server/shared/database/migrationInvariant.test.ts
```

Expected: PASS.

- [x] **Step 4: Apply retry/dead-letter in log worker**

Update `server/modules/logs/worker.ts` so catch blocks use `decideRetry()`:

- Transient object-store/analyzer/parser failures schedule retry until max attempts.
- Exhausted attempts mark job and run failed with dead-letter reason.
- Lease-lost still returns `idle`.

Add worker tests for:

- First failure schedules retry and does not mark run permanently failed.
- Final failure marks dead-letter and run failed.
- Concurrent worker lease protection remains intact.

Run:

```bash
npm run test:server -- server/modules/logs/worker.test.ts server/modules/jobs/repository.test.ts
```

Expected: PASS.

- [x] **Step 5: Add worker health and routes**

Create `server/modules/jobs/workerHealth.ts` with:

```ts
export type WorkerQueueHealth = {
  ok: boolean;
  status: "ready" | "degraded" | "failed";
  queued: number;
  processing: number;
  deadLettered: number;
  oldestQueuedAgeMs: number | null;
  message?: string;
};
```

Expose an authorized route such as `GET /api/v1/jobs/worker-health` or include this in operations readiness if the project prefers no new route. Add route manifest and OpenAPI registry entries when a new route is added.

Run:

```bash
npm run test:server -- server/modules/jobs/workerHealth.test.ts server/modules/jobs/routes.test.ts server/modules/operations/health.test.ts
npm run contract:check
```

Expected: PASS.

- [x] **Step 6: Add dedicated worker runner and npm script**

Create `server/modules/logs/workerRunner.ts` that starts `startLogWorkerLoop()` from env-configured database/object-store settings. Add package script:

```json
"worker:logs": "tsx server/modules/logs/workerRunner.ts"
```

Add tests that the runner refuses to start without required production worker configuration.

Run:

```bash
npm run test:server -- server/modules/logs/workerRunner.test.ts
npm run test:server -- server/modules/jobs/retryPolicy.test.ts server/modules/jobs/workerHealth.test.ts server/modules/logs/worker.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit worker hardening**

Run:

```bash
npm run test:server -- server/modules/jobs/retryPolicy.test.ts server/modules/jobs/repository.test.ts server/modules/logs/worker.test.ts server/modules/jobs/workerHealth.test.ts
git diff --check
```

Commit:

```bash
git add server/modules/jobs server/modules/logs server/modules/operations server/migrations package.json docs/generated/db-schema.md
git commit -m "feat: harden log worker retries and dead letters"
```

---

### Task 4: Object Storage Production Adapter

**Files:**
- Create: `server/modules/logs/s3ObjectStore.ts`
- Create: `server/modules/logs/s3ObjectStore.test.ts`
- Modify: `server/modules/logs/objectStore.ts`
- Modify: `server/modules/logs/objectStore.test.ts`
- Modify: `server/config/env.ts`
- Modify: `server/config/env.test.ts`
- Modify: `server/modules/operations/health.ts`
- Modify: `server/modules/operations/health.test.ts`
- Modify: `server/index.ts`
- Modify: `README.md`
- Modify: `docs/RELIABILITY.md`
- Modify: `docs/design-docs/deployment-operations.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`

- [x] **Step 1: Write failing adapter tests**

Create `server/modules/logs/s3ObjectStore.test.ts` using a fake transport:

```ts
import { describe, expect, it, vi } from "vitest";
import { createS3ObjectStore } from "./s3ObjectStore";

describe("s3 object store adapter", () => {
  it("stores objects under organization-scoped keys with checksum metadata", async () => {
    const put = vi.fn(async () => ({ ok: true }));
    const store = createS3ObjectStore({
      bucket: "wiseeff-pilot",
      endpoint: "https://storage.example.com",
      accessKeyId: "key",
      secretAccessKey: "secret",
      transport: { put, get: vi.fn(), head: vi.fn(async () => ({ ok: true })) }
    });

    const stored = await store.put({
      organizationId: "org-1",
      fileName: "fault.log",
      contentType: "text/plain",
      bytes: Buffer.from("fault", "utf8")
    });

    expect(stored.storageKey).toMatch(/^org-1\/[a-f0-9]{64}-fault\.log$/);
    expect(stored.checksumSha256).toHaveLength(64);
    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      bucket: "wiseeff-pilot",
      key: stored.storageKey,
      contentType: "text/plain",
      metadata: expect.objectContaining({
        checksumSha256: stored.checksumSha256,
        retentionClass: "pilot-default"
      })
    }));
  });

  it("reports failed readiness with actionable messages", async () => {
    const store = createS3ObjectStore({
      bucket: "wiseeff-pilot",
      endpoint: "https://storage.example.com",
      accessKeyId: "key",
      secretAccessKey: "secret",
      transport: { put: vi.fn(), get: vi.fn(), head: vi.fn(async () => ({ ok: false, error: "bucket missing" })) }
    });

    await expect(store.checkHealth()).resolves.toEqual({
      ok: false,
      status: "failed",
      message: "bucket missing"
    });
  });
});
```

Run:

```bash
npm run test:server -- server/modules/logs/s3ObjectStore.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement S3/OSS-compatible object store seam**

Create `server/modules/logs/s3ObjectStore.ts` with:

- Same `ObjectStore & ObjectStoreHealthCheck` interface as local storage.
- Constructor config for `endpoint`, `bucket`, `accessKeyId`, `secretAccessKey`, optional `region`, optional fake `transport`.
- Key sanitization using the same path-safety rules as local storage.
- Metadata: checksum, file size, content type, retention class, encryption mode.
- Health check that calls `transport.head({ bucket })`.

Do not add a heavy cloud SDK unless the implementation needs real network calls now; keep the seam testable with fake transport.

Run:

```bash
npm run test:server -- server/modules/logs/s3ObjectStore.test.ts server/modules/logs/objectStore.test.ts
```

Expected: PASS.

- [x] **Step 3: Add environment mode and readiness gates**

Update `server/config/env.ts`:

```ts
OBJECT_STORE_MODE: z.enum(["local", "s3"]).default("local"),
OBJECT_STORAGE_ENDPOINT: z.string().optional(),
OBJECT_STORAGE_BUCKET: z.string().optional(),
OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional(),
OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional()
```

Production gates:

- `NODE_ENV=production` requires `OBJECT_STORE_MODE=s3`.
- S3 mode requires endpoint, bucket, access key id, and secret.
- Local mode remains allowed for development/test.

Update `server/index.ts` to instantiate local or S3 object store based on env.

Run:

```bash
npm run test:server -- server/config/env.test.ts server/modules/operations/health.test.ts server/app.test.ts
```

Expected: PASS.

- [x] **Step 4: Document storage operations and close/update debt**

Update docs:

- `README.md`: local and staging object store setup.
- `docs/RELIABILITY.md`: readiness, retention, checksum, and restore expectations.
- `docs/design-docs/deployment-operations.md`: production object storage variables and smoke.
- `docs/exec-plans/tech-debt-tracker.md`: mark TD-006 complete if S3 seam and readiness are implemented; leave cloud-provider provisioning as post-M5 debt if credentials are not provisioned.

Run:

```bash
npm run test:server -- server/modules/logs/s3ObjectStore.test.ts server/modules/operations/health.test.ts
git diff --check
```

Commit:

```bash
git add server/modules/logs server/config/env.ts server/config/env.test.ts server/index.ts README.md docs/RELIABILITY.md docs/design-docs/deployment-operations.md docs/exec-plans/tech-debt-tracker.md
git commit -m "feat: add production object storage adapter"
```

---

### Task 5: Device Gateway Production Hardening

**Files:**
- Create: `server/modules/debugging/hdcGateway.ts`
- Create: `server/modules/debugging/hdcGateway.test.ts`
- Modify: `server/modules/debugging/gateway.ts`
- Modify: `server/modules/debugging/service.ts`
- Modify: `server/modules/debugging/service.test.ts`
- Modify: `server/modules/debugging/simulator.ts`
- Modify: `server/config/env.ts`
- Modify: `server/config/env.test.ts`
- Modify: `server/index.ts`
- Modify: `e2e/debugging.api.spec.ts`
- Modify: `docs/SECURITY.md`
- Modify: `docs/RELIABILITY.md`
- Modify: `docs/design-docs/deployment-operations.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`

- [x] **Step 1: Write failing HDC adapter tests**

Create `server/modules/debugging/hdcGateway.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createHdcDebugDeviceGateway } from "./hdcGateway";

describe("HDC debug device gateway", () => {
  it("normalizes target detection output", async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: "device-a\ndevice-b\n", stderr: "", durationMs: 12 }));
    const gateway = createHdcDebugDeviceGateway({ runCommand: run, timeoutMs: 1000 });

    await expect(gateway.detectTargets({ projectId: "aurora" })).resolves.toMatchObject({
      ok: true,
      targets: [
        { id: "device-a", deviceId: "device-a", targetRef: "device-a", online: true },
        { id: "device-b", deviceId: "device-b", targetRef: "device-b", online: true }
      ]
    });
  });

  it("returns DEVICE_UNAVAILABLE style errors for stderr failures", async () => {
    const gateway = createHdcDebugDeviceGateway({
      runCommand: vi.fn(async () => ({ code: 1, stdout: "", stderr: "device offline", durationMs: 30 })),
      timeoutMs: 1000
    });

    await expect(gateway.readNode({ targetRef: "device-a", nodePath: "/sys/node" })).resolves.toMatchObject({
      ok: false,
      stderr: "device offline",
      error: "HDC command failed: device offline"
    });
  });

  it("reports read-back mismatch on writes", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "", durationMs: 10 })
      .mockResolvedValueOnce({ code: 0, stdout: "old", stderr: "", durationMs: 10 });
    const gateway = createHdcDebugDeviceGateway({ runCommand: run, timeoutMs: 1000 });

    await expect(gateway.writeNode({ targetRef: "device-a", nodePath: "/sys/node", value: "new", readBack: true })).resolves.toMatchObject({
      ok: false,
      verified: false,
      error: "Read-back mismatch after HDC write."
    });
  });
});
```

Run:

```bash
npm run test:server -- server/modules/debugging/hdcGateway.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement HDC gateway adapter**

Create `server/modules/debugging/hdcGateway.ts` implementing `DebugDeviceGateway`.

Rules:

- Use injected `runCommand()` for tests.
- Shell command construction must quote target, node path, and value.
- `detectTargets()` parses non-empty lines into `GatewayTarget[]`.
- `readNode()` returns `GatewayNodeResult` with `ok`, `stdout`, `stderr`, `value`, `durationMs`, and normalized `error`.
- `writeNode()` performs write, optional read-back, and returns mismatch when read value differs from requested value.
- Timeouts return `{ ok: false, error: "HDC command timed out after <n>ms." }`.

Run:

```bash
npm run test:server -- server/modules/debugging/hdcGateway.test.ts server/modules/debugging/simulator.test.ts
```

Expected: PASS.

- [x] **Step 3: Add gateway mode env gates and service integration**

Update `server/config/env.ts`:

```ts
DEBUG_DEVICE_GATEWAY_MODE: z.enum(["simulator", "hdc"]).default("simulator"),
HDC_TIMEOUT_MS: z.coerce.number().int().positive().default(5000)
```

Production gate:

- `NODE_ENV=production` requires `DEBUG_DEVICE_GATEWAY_MODE=hdc` unless `DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true` is explicitly set for a non-customer staging environment.

Update `server/index.ts` to instantiate simulator or HDC gateway.

Run:

```bash
npm run test:server -- server/config/env.test.ts server/modules/debugging/routes.test.ts server/modules/debugging/service.test.ts
```

Expected: PASS.

- [x] **Step 4: Add device smoke and docs**

Update `e2e/debugging.api.spec.ts` or add a tagged smoke case that can run against simulator by default and HDC when `DEBUG_DEVICE_GATEWAY_MODE=hdc`.

Document:

- Device-lab smoke command.
- Required approval, snapshot, read-back, timeout, offline, and stderr behavior.
- Rollback expectations after real-device write failure.

Run:

```bash
npm run test:server -- server/modules/debugging/hdcGateway.test.ts server/modules/debugging/service.test.ts
npm run test:e2e -- e2e/debugging.api.spec.ts
git diff --check
```

Commit:

```bash
git add server/modules/debugging server/config/env.ts server/config/env.test.ts server/index.ts e2e/debugging.api.spec.ts docs/SECURITY.md docs/RELIABILITY.md docs/design-docs/deployment-operations.md docs/exec-plans/tech-debt-tracker.md
git commit -m "feat: add production HDC gateway boundary"
```

---

### Task 6: Agent Provider Hardening

**Files:**
- Create: `server/modules/agent/providerRegistry.ts`
- Create: `server/modules/agent/providerRegistry.test.ts`
- Create: `server/modules/agent/liveProvider.ts`
- Create: `server/modules/agent/liveProvider.test.ts`
- Modify: `server/modules/agent/provider.ts`
- Modify: `server/modules/agent/orchestrator.ts`
- Modify: `server/modules/agent/orchestrator.test.ts`
- Modify: `server/modules/agent/repository.ts`
- Modify: `server/modules/agent/repository.test.ts`
- Modify: `server/migrations/0010_m5_agent_provider_traces.sql`
- Modify: `server/config/env.ts`
- Modify: `server/config/env.test.ts`
- Modify: `server/modules/operations/health.ts`
- Modify: `server/modules/operations/health.test.ts`
- Modify: `e2e/agent.api.spec.ts`
- Modify: `docs/SECURITY.md`
- Modify: `docs/RELIABILITY.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`

- [x] **Step 1: Write failing provider registry tests**

Create `server/modules/agent/providerRegistry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAgentProviderFromEnv } from "./providerRegistry";

describe("agent provider registry", () => {
  it("uses deterministic provider outside production by default", () => {
    const provider = createAgentProviderFromEnv({ NODE_ENV: "development", AGENT_PROVIDER: "deterministic" });

    expect(provider.metadata()).toEqual({
      provider: "deterministic",
      model: "wiseeff-rules-m4",
      promptVersion: "m4-agent-v1"
    });
  });

  it("requires live provider configuration in production", () => {
    expect(() => createAgentProviderFromEnv({ NODE_ENV: "production", AGENT_PROVIDER: "deterministic" })).toThrow(
      "AGENT_PROVIDER=live is required in production."
    );
  });

  it("creates live provider when credentials are configured", () => {
    const provider = createAgentProviderFromEnv({
      NODE_ENV: "production",
      AGENT_PROVIDER: "live",
      AGENT_MODEL: "pilot-model",
      AGENT_API_KEY: "secret",
      AGENT_PROMPT_VERSION: "m5-agent-v1"
    });

    expect(provider.metadata()).toMatchObject({
      provider: "live",
      model: "pilot-model",
      promptVersion: "m5-agent-v1"
    });
  });
});
```

Run:

```bash
npm run test:server -- server/modules/agent/providerRegistry.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement provider interface and registry**

Update `server/modules/agent/provider.ts` to expose a common provider interface:

```ts
export type AgentProvider = {
  metadata(): { provider: string; model: string; promptVersion: string };
  planTurn(input: AgentProviderInput): Promise<AgentProviderPlan> | AgentProviderPlan;
  checkHealth?(): Promise<{ ok: boolean; status: "ready" | "failed"; message?: string }>;
};
```

Create `providerRegistry.ts` selecting deterministic or live provider from env. Keep deterministic behavior for tests and local development.

Run:

```bash
npm run test:server -- server/modules/agent/providerRegistry.test.ts server/modules/agent/orchestrator.test.ts
```

Expected: PASS.

- [x] **Step 3: Write failing live provider tests**

Create `server/modules/agent/liveProvider.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createLiveAgentProvider } from "./liveProvider";

describe("live agent provider", () => {
  it("returns grounded plans with trace metadata", async () => {
    const transport = vi.fn(async () => ({
      content: "Review queue has 2 high-risk items.",
      toolRequests: [{ name: "parameter.summarizeReviewQueue", label: "Summarize review queue", payload: { projectId: "aurora" } }],
      citations: [{ type: "parameter", id: "p-1", label: "Charge limit" }],
      confidence: 0.7,
      usage: { inputTokens: 100, outputTokens: 40, estimatedCostUsd: 0.002 },
      latencyMs: 250
    }));
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport
    });

    await expect(provider.planTurn({ context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" }, message: "Summarize" })).resolves.toMatchObject({
      assistantDraft: { content: "Review queue has 2 high-risk items.", confidence: 0.7 },
      provider: "live",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      safety: { ok: true },
      usage: { estimatedCostUsd: 0.002 },
      latencyMs: 250
    });
  });

  it("blocks ungrounded write requests", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: vi.fn(async () => ({
        content: "I changed the device value.",
        toolRequests: [{ name: "debugging.writeNode", label: "Write node", payload: { projectId: "aurora" } }],
        citations: [],
        confidence: 0.95,
        usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
        latencyMs: 10
      }))
    });

    await expect(provider.planTurn({ context: { pageKey: "debugging", path: "/debugging", projectId: "aurora", roleId: "admin" }, message: "write it" })).rejects.toThrow(
      "Live Agent provider returned an unsafe ungrounded write request."
    );
  });
});
```

Run:

```bash
npm run test:server -- server/modules/agent/liveProvider.test.ts
```

Expected: FAIL.

- [x] **Step 4: Implement live provider seam**

Create `server/modules/agent/liveProvider.ts`:

- Accept injected `transport` for tests.
- Add system prompt version and page context.
- Parse provider output into existing `AgentProviderPlan`.
- Require citations for write-adjacent/high-confidence operational claims.
- Reject tool names not registered in the existing tool registry.
- Add `usage`, `latencyMs`, and `safety` metadata to provider plan.
- `checkHealth()` performs a cheap configured transport health call or returns failed with actionable message.

Run:

```bash
npm run test:server -- server/modules/agent/liveProvider.test.ts server/modules/agent/providerRegistry.test.ts
```

Expected: PASS.

- [x] **Step 5: Persist provider trace metadata**

Create migration `server/migrations/0010_m5_agent_provider_traces.sql` adding columns to Agent run traces:

- `latency_ms integer`
- `input_tokens integer`
- `output_tokens integer`
- `estimated_cost_usd numeric`
- `safety_status text`
- `safety_reasons jsonb`
- `fallback_reason text`

Update repository/orchestrator tests:

- `sendMessage()` stores live provider trace metadata.
- Provider outage produces a degraded assistant message and stores `fallback_reason`, without executing write tools.
- Approval flow still re-checks auth and tool state.

Run:

```bash
npm run test:server -- server/modules/agent/repository.test.ts server/modules/agent/orchestrator.test.ts server/shared/database/migrationInvariant.test.ts
```

Expected: PASS.

- [x] **Step 6: Add readiness and docs**

Update operations readiness to include Agent provider health when `AGENT_PROVIDER=live`.

Update docs:

- `docs/SECURITY.md`: prompt injection, tool boundaries, approval unchanged.
- `docs/RELIABILITY.md`: model latency/cost/outage, fallback behavior.
- `docs/exec-plans/tech-debt-tracker.md`: mark TD-017 addressed when live provider seam, safety tests, and trace metadata are done; leave prompt optimization/eval expansion as post-M5 debt if needed.

Run:

```bash
npm run test:server -- server/modules/agent/liveProvider.test.ts server/modules/agent/providerRegistry.test.ts server/modules/agent/orchestrator.test.ts server/modules/operations/health.test.ts
npm run test:e2e -- e2e/agent.api.spec.ts
git diff --check
```

Commit:

```bash
git add server/modules/agent server/modules/operations server/config/env.ts server/config/env.test.ts server/migrations e2e/agent.api.spec.ts docs/SECURITY.md docs/RELIABILITY.md docs/exec-plans/tech-debt-tracker.md
git commit -m "feat: harden live agent provider boundary"
```

---

### Task 7: Release Operations And M5 Acceptance Gate

**Files:**
- Create: `server/modules/operations/pilotReadiness.ts`
- Create: `server/modules/operations/pilotReadiness.test.ts`
- Create: `scripts/run-m5-smoke.ts`
- Create: `docs/runbooks/m5-commercial-pilot-readiness.md`
- Create: `docs/generated/m5-pilot-acceptance.md`
- Modify: `server/modules/operations/routes.ts`
- Modify: `server/modules/operations/routes.test.ts`
- Modify: `server/modules/contracts/routeManifest.ts`
- Modify: `server/modules/contracts/schemaRegistry.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/FRONTEND.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `docs/design-docs/deployment-operations.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`

- [x] **Step 1: Write failing pilot readiness tests**

Create `server/modules/operations/pilotReadiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPilotReadiness } from "./pilotReadiness";

describe("pilot readiness", () => {
  it("passes when all M5 gates are ready", () => {
    expect(
      buildPilotReadiness({
        contract: { ok: true, status: "ready" },
        auth: { ok: true, status: "ready" },
        database: { ok: true, status: "ready" },
        objectStore: { ok: true, status: "ready" },
        worker: { ok: true, status: "ready" },
        deviceGateway: { ok: true, status: "ready" },
        agentProvider: { ok: true, status: "ready" },
        backups: { ok: true, status: "ready" }
      })
    ).toMatchObject({ ok: true, status: "pilot_ready" });
  });

  it("fails with actionable blocked gates", () => {
    expect(
      buildPilotReadiness({
        contract: { ok: true, status: "ready" },
        auth: { ok: false, status: "failed", message: "AUTH_MODE is development." },
        database: { ok: true, status: "ready" },
        objectStore: { ok: true, status: "ready" },
        worker: { ok: true, status: "ready" },
        deviceGateway: { ok: true, status: "ready" },
        agentProvider: { ok: true, status: "ready" },
        backups: { ok: false, status: "missing", message: "Restore drill not recorded." }
      })
    ).toMatchObject({
      ok: false,
      status: "blocked",
      blockedBy: ["auth", "backups"]
    });
  });
});
```

Run:

```bash
npm run test:server -- server/modules/operations/pilotReadiness.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement pilot readiness model and route**

Create `server/modules/operations/pilotReadiness.ts` and add a route such as:

```http
GET /api/v1/operations/pilot-readiness
```

The route should require admin/operations access and aggregate:

- Contract check result.
- Auth mode.
- Database readiness.
- Object store readiness.
- Worker health.
- Device gateway readiness.
- Agent provider readiness.
- Backup/restore drill metadata, initially read from config or a repository-local acceptance artifact.

Update route manifest and schema registry.

Run:

```bash
npm run test:server -- server/modules/operations/pilotReadiness.test.ts server/modules/operations/routes.test.ts server/modules/contracts/openapi.test.ts
npm run contract:check
```

Expected: PASS.

- [x] **Step 3: Add M5 smoke script and npm quality gate**

Create `scripts/run-m5-smoke.ts` to run checks in this order:

1. `npm run contract:check`
2. `/health/live`
3. `/health/ready`
4. `/api/v1/operations/pilot-readiness`
5. API-mode E2E command list or a clear skip message when no API URL is configured.

Update `package.json`:

```json
"smoke:m5": "tsx scripts/run-m5-smoke.ts",
"test:m5": "npm run contract:check && npm run test:all && npm run build && npm run test:e2e -- e2e/parameter-management.api.spec.ts e2e/log-analysis.api.spec.ts e2e/debugging.api.spec.ts e2e/agent.api.spec.ts && npm run smoke:m5"
```

Run:

```bash
npm run test:server -- server/modules/operations/pilotReadiness.test.ts server/modules/operations/routes.test.ts
npm run contract:check
```

Expected: PASS.

- [x] **Step 4: Write runbook and acceptance report**

Create `docs/runbooks/m5-commercial-pilot-readiness.md` with:

- Required environment variables.
- Deploy order: database migration, API, worker, web, device gateway.
- Smoke commands.
- Monitoring signals and alert thresholds.
- Backup command, restore drill steps, RPO/RTO target.
- Rollback triggers and rollback sequence.
- Go/no-go checklist.

Create `docs/generated/m5-pilot-acceptance.md` with a checklist for:

- Contract artifact.
- Auth gate.
- Worker/dead-letter evidence.
- Object storage readiness.
- Device-lab smoke.
- Agent provider trace and safety eval.
- Backup/restore and rollback drill.

Update `README.md`, `ARCHITECTURE.md`, `docs/QUALITY_SCORE.md`, `docs/FRONTEND.md`, `docs/design-docs/testing-strategy.md`, and `docs/design-docs/deployment-operations.md` so M5 is visible in the normal reading path.

Run:

```bash
git diff --check
```

Expected: PASS.

- [x] **Step 5: Final M5 verification**

Run:

```bash
npm run test:m5
npm run test:all
npm run build
git diff --check
```

Expected: PASS.

If PostgreSQL, device HDC, live Agent provider, or object storage credentials are not available locally, record the exact skipped external checks in `docs/generated/m5-pilot-acceptance.md` and run the simulator/fake-transport tests instead. Do not claim commercial pilot readiness until staging evidence is attached.

- [x] **Step 6: Commit release operations gate**

Commit:

```bash
git add server/modules/operations server/modules/contracts scripts package.json README.md ARCHITECTURE.md docs
git commit -m "feat: add M5 pilot readiness gate"
```

---

## Final Verification Checklist

- [ ] `npm run contract:check`
- [ ] `npm run test:server -- server/modules/contracts/openapi.test.ts server/modules/auth/tokenVerifier.test.ts server/modules/jobs/retryPolicy.test.ts server/modules/logs/s3ObjectStore.test.ts server/modules/debugging/hdcGateway.test.ts server/modules/agent/liveProvider.test.ts server/modules/operations/pilotReadiness.test.ts`
- [ ] `npm run test:all`
- [ ] `npm run build`
- [ ] `npm run test:e2e -- e2e/parameter-management.api.spec.ts e2e/log-analysis.api.spec.ts e2e/debugging.api.spec.ts e2e/agent.api.spec.ts`
- [ ] `npm run smoke:m5`
- [ ] `npm run test:m5`
- [ ] `git diff --check`

## Post-M5 Residual Risks To Review

- Real OIDC/SSO federation may replace the HMAC pilot verifier.
- Cloud object storage SDK/provider-specific lifecycle policies may need provider credentials and infrastructure code outside this repository.
- Device-lab coverage depends on available hardware and should be recorded in the acceptance report, not inferred from simulator tests.
- Live LLM quality, cost, latency, prompt injection resistance, and provider outage behavior should keep expanding through evals after the first pilot.
- Multi-tenant scale, capacity planning, audit retention, and incident response drills need production evidence before broad enterprise rollout.
