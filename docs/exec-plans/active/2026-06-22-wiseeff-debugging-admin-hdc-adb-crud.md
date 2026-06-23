# WiseEff Debugging Admin HDC/ADB Catalog CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/debugging-admin` into an API-backed catalog management console that can create, edit, archive, restore, and protocol-bind shared debugging parameters for HDC and ADB.

**Architecture:** The runtime debugging API remains focused on executable enabled parameters for `/node-debugging`, while a new `/api/v1/debugging/admin/*` route family exposes full catalog governance. Backend service/repository methods manage `debugging_parameters` archive state and `debugging_parameter_node_bindings` independently per protocol; the frontend adds an API-mode admin client and keeps mock/config-draft behavior only for local demos. Runtime reads continue to resolve selected protocol bindings from the backend catalog.

**Tech Stack:** TypeScript, PostgreSQL migrations, Zod, WiseEff modular API router, React/Vite, Vitest, Testing Library, Playwright acceptance, repository documentation governance.

---

## Source Spec

- `docs/superpowers/specs/2026-06-22-debugging-admin-hdc-adb-crud-design.md`
- `docs/zh-CN/superpowers/specs/2026-06-22-debugging-admin-hdc-adb-crud-design.md`

## Scope Notes

- `debugging:admin` already exists in `server/modules/auth/types.ts`, `server/modules/auth/tokenVerifier.ts`, and `server/modules/debugging/policy.ts`.
- HDC/ADB runtime protocol support and `debugging_parameter_node_bindings` already exist. This plan does not rebuild gateway routing.
- The admin catalog path saves directly to the database. There is no draft, review, or publish workflow in this implementation.
- Parameter archive uses explicit database fields and must not remove history references.
- The existing `work/` directory and local `.env` files are not part of this plan.
- The current desktop environment may expose `.git` as read-only. Commit steps are still included because a normal execution environment should allow them.

## File Structure

Create:

- `server/migrations/0019_debugging_admin_catalog_archive.sql`: add archive/enable fields to `debugging_parameters` and runtime/admin indexes.
- `src/infrastructure/http/debuggingAdminDtos.ts`: frontend DTO mapper for admin parameter and binding payloads.
- `src/infrastructure/http/debuggingAdminClient.ts`: API-mode `/api/v1/debugging/admin/*` client.
- `src/infrastructure/http/debuggingAdminClient.test.ts`: HTTP contract tests for the admin client.
- `e2e/acceptance/debugging-admin.acceptance.spec.ts`: API-mode browser acceptance for admin CRUD.

Modify:

- `server/modules/debugging/types.ts`: add archive fields to `DebugParameterRecord`; add admin input/output types if colocated.
- `server/modules/debugging/repository.ts`: map archive fields, filter runtime lists by enabled/archive state, and add admin create/update/archive/restore/binding upsert helpers.
- `server/modules/debugging/repository.test.ts`: cover admin CRUD SQL contracts, archive mapping, runtime filtering, and binding upsert.
- `server/modules/debugging/schemas.ts`: add admin list/body/params schemas.
- `server/modules/debugging/schemas.test.ts`: cover admin schemas.
- `server/modules/debugging/service.ts`: add admin catalog service methods and audit writes; keep runtime list semantics separate.
- `server/modules/debugging/service.test.ts`: cover permission checks, catalog mutations, audit metadata, and runtime filtering.
- `server/modules/debugging/routes.ts`: register `/api/v1/debugging/admin/*` routes.
- `server/modules/debugging/routes.test.ts`: cover route parsing, status codes, and permission boundary.
- `src/domain/debugging/types.ts`: add frontend archive state and admin draft types if needed by UI/client.
- `src/application/ports/DebuggingGateway.ts`: add optional `DebuggingAdminGateway` port or admin-specific types without changing runtime read/write contracts.
- `src/infrastructure/http/debuggingDtos.ts`: include `enabled`/archive fields if runtime DTOs surface them for compatibility.
- `src/infrastructure/http/debuggingDtos.test.ts`: protect mapping behavior for enabled and archived rows.
- `src/App.tsx`: replace API-mode read-only `/debugging-admin` with API-backed admin loading/saving while preserving mock-mode config behavior.
- `src/DebuggingPage.test.tsx`: replace API-mode read-only assertion with API-backed admin tests.
- `src/App.test.tsx`: update mock-mode admin tests and add API-mode save/archive expectations where appropriate.
- `src/styles.css`: add binding coverage labels, protocol panels, error states, and responsive admin layout updates.
- `src/workspaceHeaderIntegration.test.tsx`: update topbar metrics if admin counts change.
- `e2e/acceptance/operationMatrix.ts`: add `DEBUG-ADMIN-001`.
- `docs/developer/browser-acceptance-coverage-map.md`: add `DEBUG-ADMIN-001`.
- `docs/zh-CN/developer/browser-acceptance-coverage-map.md`: add Chinese coverage note or confirm generated companion policy.
- `docs/developer/user-operation-coverage-matrix.md`: regenerate or update generated matrix after operation matrix changes.
- `docs/zh-CN/developer/user-operation-coverage-matrix.md`: regenerate or update generated matrix after operation matrix changes.
- `docs/design-docs/api-contract.md`: document admin catalog routes.
- `docs/zh-CN/design-docs/api-contract.md`: Chinese companion update.
- `docs/design-docs/domain-model.md`: document archive semantics and admin/runtime catalog split.
- `docs/zh-CN/design-docs/domain-model.md`: Chinese companion update.
- `docs/FRONTEND.md`: document API-mode debugging admin client and mock-mode fallback.
- `docs/zh-CN/frontend.md`: Chinese companion update.
- `docs/SECURITY.md`: document `debugging:admin` catalog governance boundary.
- `docs/zh-CN/SECURITY.md`: Chinese companion update.
- `docs/design-docs/testing-strategy.md`: add debugging admin browser acceptance coverage.
- `docs/zh-CN/design-docs/testing-strategy.md`: Chinese companion update.
- `docs/generated/db-schema.md`: align with migration `0019`.

Review:

- `docs/developer/environment-variables.md` and `docs/zh-CN/developer/environment-variables.md`: record unchanged if no new env vars are introduced.
- `docs/runbooks/adb-device-lab.md` and `docs/zh-CN/runbooks/adb-device-lab.md`: record unchanged if default smoke binding governance docs remain sufficient.
- `docs/exec-plans/tech-debt-tracker.md`: add follow-up only if implementation intentionally defers hard-delete support or active device node detection.

## Acceptance Coverage Impact

- New requirement ID: `DEBUG-ADMIN-001`.
- New operation ID: `DEBUG-ADMIN-001`.
- Affected spec: `e2e/acceptance/debugging-admin.acceptance.spec.ts`.
- Operation evidence impact: `npm run acceptance:evidence` must include `DEBUG-ADMIN-001` after evidence is generated. The evidence should summarize API calls, DB state, and UI state without exposing raw node paths beyond shape assertions.
- Existing related requirement IDs: `DEBUG-SIM-001`, `ADB-LAB-001`, `HDC-LAB-001`.
- Existing runtime specs must still pass because admin changes feed the same catalog consumed by `/node-debugging`.

## Task 1: Migration And Type Contract For Archived Debug Parameters

**Files:**
- Create: `server/migrations/0019_debugging_admin_catalog_archive.sql`
- Modify: `server/modules/debugging/types.ts`
- Modify: `server/modules/debugging/repository.ts`
- Modify: `server/modules/debugging/repository.test.ts`
- Modify: `docs/generated/db-schema.md`

- [ ] **Step 1: Write failing repository tests for archive fields and runtime filtering**

Add tests to `server/modules/debugging/repository.test.ts` near the existing `listDebugParameters` tests:

```ts
it("maps debugging parameter archive fields", async () => {
  const { db } = createFakeDb([
    [
      {
        id: "param-archived",
        organization_id: "org-1",
        project_id: null,
        name: "Archived parameter",
        key: "debug.archived",
        description: "Archived catalog row.",
        module: "Diagnostics",
        node_path: "/sys/archived",
        access_mode: "RO",
        unit: "",
        range_label: "",
        min_value: null,
        max_value: null,
        risk: "Low",
        current_value: "",
        target_value: "",
        sort_order: 99,
        enabled: false,
        archived_at: "2026-06-22T12:00:00.000Z",
        archived_by: "user-1",
        archive_reason: "No longer supported."
      }
    ]
  ]);

  const parameters = await listDebugParameters(db, {
    organizationId: "org-1",
    includeArchived: true
  });

  expect(parameters[0]).toMatchObject({
    id: "param-archived",
    projectId: null,
    enabled: false,
    archivedAt: "2026-06-22T12:00:00.000Z",
    archivedBy: "user-1",
    archiveReason: "No longer supported."
  });
});

it("excludes archived debugging parameters from runtime lists by default", async () => {
  const { db, calls } = createFakeDb([[]]);

  await listDebugParameters(db, { organizationId: "org-1", projectId: "aurora" });

  expect(calls[0].text).toContain("enabled = true");
  expect(calls[0].text).toContain("archived_at is null");
});

it("includes archived debugging parameters for admin lists when requested", async () => {
  const { db, calls } = createFakeDb([[]]);

  await listDebugParameters(db, {
    organizationId: "org-1",
    projectId: "aurora",
    includeArchived: true
  });

  expect(calls[0].text).not.toContain("enabled = true");
  expect(calls[0].text).not.toContain("archived_at is null");
});
```

- [ ] **Step 2: Run repository tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/repository.test.ts
```

Expected: FAIL because `includeArchived` and archive fields do not exist.

- [ ] **Step 3: Create migration `0019_debugging_admin_catalog_archive.sql`**

Create `server/migrations/0019_debugging_admin_catalog_archive.sql`:

```sql
alter table debugging_parameters
  add column if not exists enabled boolean not null default true;

alter table debugging_parameters
  add column if not exists archived_at timestamptz;

alter table debugging_parameters
  add column if not exists archived_by text references users(id);

alter table debugging_parameters
  add column if not exists archive_reason text;

create index if not exists debugging_parameters_runtime_enabled_idx
  on debugging_parameters(organization_id, project_id, module, risk, sort_order)
  where enabled = true
    and archived_at is null;

create index if not exists debugging_parameters_shared_runtime_enabled_idx
  on debugging_parameters(organization_id, module, risk, sort_order)
  where project_id is null
    and enabled = true
    and archived_at is null;

create index if not exists debugging_parameters_admin_archive_idx
  on debugging_parameters(organization_id, project_id, enabled, archived_at, sort_order);
```

- [ ] **Step 4: Extend backend types**

In `server/modules/debugging/types.ts`, extend `DebugParameterRecord`:

```ts
export type DebugParameterRecord = {
  id: string;
  organizationId: string;
  projectId: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath: string;
  accessMode: DebugAccessMode;
  unit: string;
  range: string;
  minValue: number | null;
  maxValue: number | null;
  risk: DebugRiskLevel;
  currentValue: string;
  targetValue: string;
  sortOrder: number;
  enabled: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
};
```

- [ ] **Step 5: Map archive fields and runtime filtering**

Update `server/modules/debugging/repository.ts`:

```ts
type DebugParameterRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  node_path: string;
  access_mode: DebugAccessMode;
  unit: string;
  range_label: string;
  min_value: number | string | null;
  max_value: number | string | null;
  risk: DebugRiskLevel;
  current_value: string;
  target_value: string;
  sort_order: number | string;
  enabled: boolean;
  archived_at: string | Date | null;
  archived_by: string | null;
  archive_reason: string | null;
};
```

Extend `toDebugParameterRecord`:

```ts
enabled: row.enabled,
archivedAt: dateTimeToIso(row.archived_at),
archivedBy: row.archived_by,
archiveReason: row.archive_reason,
```

Extend `debugParameterColumns`:

```ts
  sort_order,
  enabled,
  archived_at,
  archived_by,
  archive_reason
```

Update `listDebugParameters` signature:

```ts
input: {
  organizationId: string;
  projectId?: string;
  projectIds?: string[];
  module?: string;
  risk?: string[];
  includeArchived?: boolean;
}
```

Add this condition after project filtering:

```ts
if (!input.includeArchived) {
  where.push("enabled = true");
  where.push("archived_at is null");
}
```

- [ ] **Step 6: Update test fixtures that create `DebugParameterRecord`**

Search:

```bash
rg -n "DebugParameterRecord|parameterRecord\\(|enabled: false|archivedAt" server/modules/debugging -g '*.ts'
```

For each local fixture returning `DebugParameterRecord`, add:

```ts
enabled: true,
archivedAt: null,
archivedBy: null,
archiveReason: null,
```

- [ ] **Step 7: Update generated schema docs**

In `docs/generated/db-schema.md`, update the `debugging_parameters` section to include:

```md
Archive/runtime columns:
- `enabled boolean not null default true`
- `archived_at timestamptz`
- `archived_by text references users(id)`
- `archive_reason text`

Runtime list queries use enabled rows where `archived_at is null`. Admin list queries may include archived rows.

Indexes:
- `debugging_parameters_runtime_enabled_idx`
- `debugging_parameters_shared_runtime_enabled_idx`
- `debugging_parameters_admin_archive_idx`
```

- [ ] **Step 8: Verify task**

Run:

```bash
npm run test:server -- server/modules/debugging/repository.test.ts
node --import tsx scripts/check-doc-governance.ts
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit**

Run:

```bash
git add server/migrations/0019_debugging_admin_catalog_archive.sql server/modules/debugging/types.ts server/modules/debugging/repository.ts server/modules/debugging/repository.test.ts docs/generated/db-schema.md
git commit -m "feat: add debugging catalog archive fields"
```

Expected: commit succeeds and excludes `work/`.

## Task 2: Backend Admin Schemas And Repository Mutations

**Files:**
- Modify: `server/modules/debugging/schemas.ts`
- Modify: `server/modules/debugging/schemas.test.ts`
- Modify: `server/modules/debugging/repository.ts`
- Modify: `server/modules/debugging/repository.test.ts`

- [ ] **Step 1: Write failing admin schema tests**

Add to `server/modules/debugging/schemas.test.ts`:

```ts
import {
  archiveDebugParameterBodySchema,
  debugAdminBindingParamsSchema,
  debugAdminParameterParamsSchema,
  listDebuggingAdminParametersQuerySchema,
  upsertDebugParameterNodeBindingBodySchema,
  writeDebugParameterAdminBodySchema
} from "./schemas";

describe("debugging admin schemas", () => {
  it("parses admin list filters", () => {
    expect(listDebuggingAdminParametersQuerySchema.parse({
      projectId: "aurora",
      includeArchived: "true",
      protocol: "adb",
      coverage: "missing-adb"
    })).toEqual({
      projectId: "aurora",
      includeArchived: true,
      protocol: "adb",
      coverage: "missing-adb"
    });
  });

  it("validates parameter metadata and optional bindings", () => {
    expect(writeDebugParameterAdminBodySchema.parse({
      projectId: null,
      name: "Fast charge current",
      key: "debug.fast_charge.current",
      description: "Fast charge current limit.",
      module: "Charging",
      risk: "High",
      unit: "mA",
      range: "0-5000",
      minValue: 0,
      maxValue: 5000,
      currentValue: "3000",
      targetValue: "3000",
      sortOrder: 10,
      enabled: true,
      bindings: [
        {
          protocol: "hdc",
          nodePath: "/sys/class/power_supply/battery/input_current_limit",
          accessMode: "RW",
          enabled: true,
          notes: "HDC path"
        }
      ]
    })).toMatchObject({
      projectId: null,
      name: "Fast charge current",
      enabled: true,
      bindings: [expect.objectContaining({ protocol: "hdc", enabled: true })]
    });
  });

  it("rejects enabled bindings without absolute node paths", () => {
    expect(() => upsertDebugParameterNodeBindingBodySchema.parse({
      nodePath: "relative",
      accessMode: "RW",
      enabled: true
    })).toThrow();
  });

  it("parses route params and archive reasons", () => {
    expect(debugAdminParameterParamsSchema.parse({ parameterId: "param-1" })).toEqual({ parameterId: "param-1" });
    expect(debugAdminBindingParamsSchema.parse({ parameterId: "param-1", protocol: "adb" })).toEqual({
      parameterId: "param-1",
      protocol: "adb"
    });
    expect(archiveDebugParameterBodySchema.parse({ reason: "Deprecated" })).toEqual({ reason: "Deprecated" });
  });
});
```

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/schemas.test.ts
```

Expected: FAIL because admin schema exports do not exist.

- [ ] **Step 3: Add admin schemas**

In `server/modules/debugging/schemas.ts`, add:

```ts
const optionalTrimmedString = z.string().trim().optional();
const nullableProjectIdSchema = z.union([nonEmptyString, z.null()]).optional();
const booleanQuerySchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .optional()
  .transform((value) => value === true || value === "true");

export const debugAdminCoverageFilters = [
  "dual-protocol",
  "hdc-configured",
  "adb-configured",
  "missing-hdc",
  "missing-adb",
  "archived"
] as const;

export const listDebuggingAdminParametersQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  module: nonEmptyString.optional(),
  risk: z.union([nonEmptyString, z.array(nonEmptyString)]).optional(),
  protocol: z.enum(debugConnectionProtocols).optional(),
  coverage: z.enum(debugAdminCoverageFilters).optional(),
  includeArchived: booleanQuerySchema
});

export const debugAdminParameterParamsSchema = z.object({
  parameterId: nonEmptyString
});

export const debugAdminBindingParamsSchema = z.object({
  parameterId: nonEmptyString,
  protocol: z.enum(debugConnectionProtocols)
});

export const upsertDebugParameterNodeBindingBodySchema = z.object({
  nodePath: nodePathSchema,
  accessMode: z.enum(debugAccessModes),
  enabled: z.boolean().default(true),
  notes: optionalTrimmedString
});

export const writeDebugParameterAdminBodySchema = z.object({
  projectId: nullableProjectIdSchema,
  name: nonEmptyString,
  key: nonEmptyString,
  description: z.string().trim().default(""),
  module: nonEmptyString,
  risk: z.enum(["Low", "Medium", "High"]),
  unit: z.string().trim().default(""),
  range: z.string().trim().default(""),
  minValue: z.number().nullable().optional(),
  maxValue: z.number().nullable().optional(),
  currentValue: z.string().trim().default(""),
  targetValue: z.string().trim().default(""),
  sortOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  bindings: z.array(debugParameterNodeBindingSchema).default([])
});

export const patchDebugParameterAdminBodySchema = writeDebugParameterAdminBodySchema.partial().extend({
  bindings: z.array(debugParameterNodeBindingSchema).optional()
});

export const archiveDebugParameterBodySchema = z.object({
  reason: z.string().trim().max(500).optional()
});
```

- [ ] **Step 4: Write failing repository mutation tests**

Add to `server/modules/debugging/repository.test.ts`:

```ts
it("creates debugging parameters for admin catalog writes", async () => {
  const { db, calls } = createFakeDb([[debugParameterRow({ id: "param-created", project_id: null })]]);

  const created = await createDebugParameter(db, {
    organizationId: "org-1",
    projectId: null,
    name: "Created",
    key: "debug.created",
    description: "",
    module: "Diagnostics",
    nodePath: "/sys/created",
    accessMode: "RO",
    unit: "",
    range: "",
    minValue: null,
    maxValue: null,
    risk: "Low",
    currentValue: "",
    targetValue: "",
    sortOrder: 1,
    enabled: true
  });

  expect(calls[0].text).toContain("insert into debugging_parameters");
  expect(created).toMatchObject({ id: "param-created", projectId: null, enabled: true });
});

it("archives and restores debugging parameters without deleting rows", async () => {
  const { db, calls } = createFakeDb([
    [debugParameterRow({ id: "param-1", enabled: true, archived_at: "2026-06-22T12:00:00.000Z" })],
    [debugParameterRow({ id: "param-1", enabled: true, archived_at: null })]
  ]);

  await archiveDebugParameter(db, {
    organizationId: "org-1",
    parameterId: "param-1",
    actorUserId: "user-1",
    reason: "Deprecated"
  });
  await restoreDebugParameter(db, { organizationId: "org-1", parameterId: "param-1" });

  expect(calls[0].text).toContain("update debugging_parameters");
  expect(calls[0].text).not.toContain("enabled = false");
  expect(calls[1].text).not.toContain("enabled = true");
  expect(calls[1].text).toContain("archived_at = null");
});

it("upserts and archives protocol bindings", async () => {
  const { db, calls } = createFakeDb([
    [debugParameterNodeBindingRow({ protocol: "adb", enabled: true })],
    [debugParameterNodeBindingRow({ protocol: "adb", enabled: false })]
  ]);

  await upsertDebugParameterNodeBinding(db, {
    organizationId: "org-1",
    projectId: null,
    parameterId: "param-1",
    protocol: "adb",
    nodePath: "/sys/adb/path",
    accessMode: "RO",
    enabled: true,
    notes: "ADB read"
  });
  await archiveDebugParameterNodeBinding(db, {
    organizationId: "org-1",
    parameterId: "param-1",
    protocol: "adb"
  });

  expect(calls[0].text).toContain("insert into debugging_parameter_node_bindings");
  expect(calls[0].text).toContain("on conflict (parameter_id, protocol) do update");
  expect(calls[1].text).toContain("enabled = false");
});
```

If `debugParameterRow` or `debugParameterNodeBindingRow` helper functions do not exist yet, add local helpers in the test file:

```ts
function debugParameterRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "param-1",
    organization_id: "org-1",
    project_id: null,
    name: "Fast charge current",
    key: "debug.fast_charge.current",
    description: "Parameter",
    module: "Charging",
    node_path: "/sys/current",
    access_mode: "RW",
    unit: "mA",
    range_label: "0-5000",
    min_value: 0,
    max_value: 5000,
    risk: "Medium",
    current_value: "3000",
    target_value: "3000",
    sort_order: 10,
    enabled: true,
    archived_at: null,
    archived_by: null,
    archive_reason: null,
    ...overrides
  };
}

function debugParameterNodeBindingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "binding-1",
    organization_id: "org-1",
    project_id: null,
    parameter_id: "param-1",
    protocol: "hdc",
    node_path: "/sys/current",
    access_mode: "RW",
    enabled: true,
    is_smoke_default: false,
    notes: null,
    created_at: "2026-06-22T12:00:00.000Z",
    updated_at: "2026-06-22T12:00:00.000Z",
    ...overrides
  };
}
```

- [ ] **Step 5: Run repository tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/repository.test.ts
```

Expected: FAIL because mutation helpers do not exist.

- [ ] **Step 6: Add repository mutation helpers**

Add exported input types and helpers to `server/modules/debugging/repository.ts`:

```ts
export type WriteDebugParameterInput = {
  organizationId: string;
  projectId: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath: string;
  accessMode: DebugAccessMode;
  unit: string;
  range: string;
  minValue: number | null;
  maxValue: number | null;
  risk: DebugRiskLevel;
  currentValue: string;
  targetValue: string;
  sortOrder: number;
  enabled: boolean;
};

export async function createDebugParameter(db: Queryable, input: WriteDebugParameterInput): Promise<DebugParameterRecord> {
  const result = await db.query<DebugParameterRow>(
    `
    insert into debugging_parameters (
      id, organization_id, project_id, name, key, description, module,
      node_path, access_mode, unit, range_label, min_value, max_value,
      risk, current_value, target_value, sort_order, enabled
    )
    values (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17, $18
    )
    returning ${debugParameterColumns}
    `,
    [
      randomUUID(),
      input.organizationId,
      input.projectId,
      input.name,
      input.key,
      input.description,
      input.module,
      input.nodePath,
      input.accessMode,
      input.unit,
      input.range,
      input.minValue,
      input.maxValue,
      input.risk,
      input.currentValue,
      input.targetValue,
      input.sortOrder,
      input.enabled
    ]
  );

  return toDebugParameterRecord(result.rows[0]);
}
```

Add `updateDebugParameter`, `archiveDebugParameter`, `restoreDebugParameter`, `upsertDebugParameterNodeBinding`, and `archiveDebugParameterNodeBinding` in the same style. `archiveDebugParameter` must update `archived_at=now()`, `archived_by=$actorUserId`, and `archive_reason=$reason` while preserving the existing `enabled` state. `restoreDebugParameter` must clear `archived_at`, `archived_by`, and `archive_reason` while preserving the existing `enabled` state. Binding archive must update `enabled=false` and `updated_at=now()`.

- [ ] **Step 7: Verify task**

Run:

```bash
npm run test:server -- server/modules/debugging/schemas.test.ts server/modules/debugging/repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add server/modules/debugging/schemas.ts server/modules/debugging/schemas.test.ts server/modules/debugging/repository.ts server/modules/debugging/repository.test.ts
git commit -m "feat: add debugging admin catalog repository APIs"
```

Expected: commit succeeds.

## Task 3: Backend Admin Service And Routes

**Files:**
- Modify: `server/modules/debugging/service.ts`
- Modify: `server/modules/debugging/service.test.ts`
- Modify: `server/modules/debugging/routes.ts`
- Modify: `server/modules/debugging/routes.test.ts`

- [ ] **Step 1: Write failing service tests for admin permission and list behavior**

Add to `server/modules/debugging/service.test.ts`:

```ts
const adminAuth = makeAuth(
  ["debugging:view", "debugging:read", "debugging:write", "debugging:admin"],
  [{ projectId: null, roleId: "admin" }]
);

it("listAdminParameters requires debugging:admin and includes archived rows", async () => {
  const { db, calls } = createDbMock([
    [debugParameterRow({ id: "param-1", enabled: false, archived_at: "2026-06-22T12:00:00.000Z" })],
    [debugParameterNodeBindingRow({ parameter_id: "param-1", protocol: "hdc" })]
  ]);
  const service = createDebuggingService({ db, gateway: makeGateway() });

  await expect(service.listAdminParameters(readAuth, { includeArchived: true })).rejects.toMatchObject({
    code: "FORBIDDEN"
  });

  const items = await service.listAdminParameters(adminAuth, { includeArchived: true });

  expect(calls[0].text).not.toContain("enabled = true");
  expect(items[0]).toMatchObject({
    id: "param-1",
    enabled: false,
    bindings: [expect.objectContaining({ protocol: "hdc" })]
  });
});

it("archives a debug parameter and writes audit metadata", async () => {
  const { db, txCalls } = createTransactionalDbMock([
    [debugParameterRow({ id: "param-1" })],
    [debugParameterRow({ id: "param-1", enabled: true, archived_at: "2026-06-22T12:00:00.000Z" })],
    []
  ]);
  const createAuditEvent = vi.fn().mockResolvedValue(undefined);
  const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent });

  const item = await service.archiveAdminParameter(adminAuth, {
    parameterId: "param-1",
    reason: "Deprecated"
  }, { requestId: "request-1" });

  expect(item).toMatchObject({ id: "param-1", enabled: true });
  expect(txCalls.some((call) => call.text.includes("update debugging_parameters"))).toBe(true);
  expect(createAuditEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      requestId: "request-1"
    })
  );
});
```

Use existing helper naming from `server/modules/debugging/service.test.ts`. If helper names differ, add local helpers that return the same row shapes used in repository tests.

- [ ] **Step 2: Run service tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/service.test.ts
```

Expected: FAIL because admin service methods do not exist.

- [ ] **Step 3: Add service methods**

In `server/modules/debugging/service.ts`, import:

```ts
  archiveDebugParameter,
  archiveDebugParameterNodeBinding,
  createDebugParameter,
  restoreDebugParameter,
  updateDebugParameter,
  upsertDebugParameterNodeBinding
```

Import `requireDebugAdmin`.

Add service methods:

```ts
async listAdminParameters(auth: AuthContext, query: ParameterListQuery & { includeArchived?: boolean; coverage?: string } = {}) {
  requireDebugAdmin(auth);
  const scopedQuery = scopedProjectQuery(auth, query);
  const organizationId = organizationIdFor(auth);
  const parameters = await listDebugParameters(db, {
    organizationId,
    ...scopedQuery,
    includeArchived: query.includeArchived
  });
  const bindings = await listDebugParameterNodeBindings(db, {
    organizationId,
    projectId: scopedQuery.projectId,
    parameterIds: parameters.map((parameter) => parameter.id),
    protocol: query.protocol
  });
  return attachParameterBindings(parameters, bindings, query.protocol);
}
```

Add:

- `createAdminParameter(auth, input, context)`
- `updateAdminParameter(auth, input, context)`
- `archiveAdminParameter(auth, input, context)`
- `restoreAdminParameter(auth, input, context)`
- `upsertAdminParameterBinding(auth, input, context)`
- `archiveAdminParameterBinding(auth, input, context)`

Each mutation must call `requireDebugAdmin(auth)`, run in `db.transaction`, call the repository helper, and call `createAuditEvent` with `app: "debugging"`, `action` such as `debug-parameter-admin-update`, `targetType: "debug-parameter"`, and metadata containing `parameterId`, optional `protocol`, `projectId`, and shape summaries rather than raw node path values.

- [ ] **Step 4: Write failing route tests**

Add to `server/modules/debugging/routes.test.ts`:

```ts
it("GET /api/v1/debugging/admin/parameters returns admin catalog items", async () => {
  serviceMocks.listAdminParameters = vi.fn().mockResolvedValue([
    {
      ...parameterRecord({ projectId: null, enabled: true, archivedAt: null, archivedBy: null, archiveReason: null }),
      bindings: []
    }
  ]);
  const response = await requestJson(makeServer({
    db: makeDb(),
    gateway: makeGateway(),
    auth: makeAuth({ permissions: ["debugging:view", "debugging:admin"] })
  }), "GET", "/api/v1/debugging/admin/parameters?includeArchived=true");

  expect(response.status).toBe(200);
  expect(response.body.items[0]).toMatchObject({ id: "param-1", projectId: null, bindings: [] });
  expect(serviceMocks.listAdminParameters).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ includeArchived: true }));
});

it("PUT /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol upserts a binding", async () => {
  serviceMocks.upsertAdminParameterBinding = vi.fn().mockResolvedValue({
    protocol: "adb",
    nodePath: "/sys/adb/path",
    accessMode: "RO",
    enabled: true
  });
  const response = await requestJson(makeServer({
    db: makeDb(),
    gateway: makeGateway(),
    auth: makeAuth({ permissions: ["debugging:view", "debugging:admin"] })
  }), "PUT", "/api/v1/debugging/admin/parameters/param-1/bindings/adb", {
    nodePath: "/sys/adb/path",
    accessMode: "RO",
    enabled: true
  });

  expect(response.status).toBe(200);
  expect(response.body.item).toMatchObject({ protocol: "adb", enabled: true });
});
```

Update `serviceMocks` hoist shape to include the new admin service methods.

- [ ] **Step 5: Run route tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/routes.test.ts
```

Expected: FAIL because routes are not registered.

- [ ] **Step 6: Register admin routes**

In `server/modules/debugging/routes.ts`, import admin schemas from Task 2 and add routes before runtime session routes:

```ts
router.get("/api/v1/debugging/admin/parameters", async (request) => {
  const { service } = serviceFrom(options);
  const auth = await options.getCurrentAuthContext(request);
  const query = parseWithSchema(listDebuggingAdminParametersQuerySchema, request.query);
  const items = await service.listAdminParameters(auth, {
    ...query,
    risk: normalizeArray(query.risk)
  });
  return { status: 200, body: { items } };
});
```

Add routes for:

- `POST /api/v1/debugging/admin/parameters`
- `PATCH /api/v1/debugging/admin/parameters/:parameterId`
- `POST /api/v1/debugging/admin/parameters/:parameterId/archive`
- `POST /api/v1/debugging/admin/parameters/:parameterId/restore`
- `PUT /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol`
- `PATCH /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol`
- `POST /api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol/archive`

Return `201` for create and `200` for all update/archive/restore calls. Route bodies use `{ item }` or `{ items }` envelopes consistently.

- [ ] **Step 7: Verify task**

Run:

```bash
npm run test:server -- server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add server/modules/debugging/service.ts server/modules/debugging/service.test.ts server/modules/debugging/routes.ts server/modules/debugging/routes.test.ts
git commit -m "feat: add debugging admin catalog routes"
```

Expected: commit succeeds.

## Task 4: Frontend Admin API Client And DTO Mapping

**Files:**
- Create: `src/infrastructure/http/debuggingAdminDtos.ts`
- Create: `src/infrastructure/http/debuggingAdminClient.ts`
- Create: `src/infrastructure/http/debuggingAdminClient.test.ts`
- Modify: `src/domain/debugging/types.ts`
- Modify: `src/infrastructure/http/debuggingDtos.ts`
- Modify: `src/infrastructure/http/debuggingDtos.test.ts`

- [ ] **Step 1: Add frontend admin domain types**

In `src/domain/debugging/types.ts`, extend `DebugParameter`:

```ts
  enabled?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
```

Add:

```ts
export type DebugParameterArchiveState = "active" | "archived";

export type DebugAdminParameterDraft = {
  id?: string;
  projectId?: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  currentValue: string;
  targetValue: string;
  unit: string;
  range: string;
  minValue?: number | null;
  maxValue?: number | null;
  risk: RiskLevel;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  sortOrder: number;
  enabled: boolean;
  bindings: DebugParameterNodeBinding[];
};
```

- [ ] **Step 2: Write failing client tests**

Create `src/infrastructure/http/debuggingAdminClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createDebuggingAdminClient } from "./debuggingAdminClient";

function createApiClientMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn()
  };
}

describe("debugging admin client", () => {
  it("lists admin parameters with includeArchived and maps bindings", async () => {
    const apiClient = createApiClientMock();
    apiClient.get.mockResolvedValue({
      items: [
        {
          id: "param-1",
          projectId: null,
          name: "Fast charge current",
          key: "debug.fast_charge.current",
          description: "Parameter",
          module: "Charging",
          nodePath: "/sys/current",
          accessMode: "RW",
          unit: "mA",
          range: "0-5000",
          risk: "High",
          currentValue: "3000",
          targetValue: "3000",
          sortOrder: 10,
          enabled: true,
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
          bindings: [{ protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: true }]
        }
      ]
    });
    const client = createDebuggingAdminClient(apiClient as never);

    const items = await client.listParameters({ includeArchived: true, coverage: "missing-hdc" });

    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/parameters?coverage=missing-hdc&includeArchived=true");
    expect(items[0]).toMatchObject({
      id: "param-1",
      enabled: true,
      archivedAt: null,
      bindings: [expect.objectContaining({ protocol: "adb" })]
    });
  });

  it("creates parameters and archives bindings through admin routes", async () => {
    const apiClient = createApiClientMock();
    apiClient.post.mockResolvedValueOnce({ item: { id: "param-created", bindings: [] } });
    apiClient.post.mockResolvedValueOnce({ item: { id: "param-created", enabled: false } });
    apiClient.put.mockResolvedValue({ item: { protocol: "hdc", enabled: true } });
    const client = createDebuggingAdminClient(apiClient as never);

    await client.createParameter({
      projectId: null,
      name: "Created",
      key: "debug.created",
      description: "",
      module: "Diagnostics",
      currentValue: "",
      targetValue: "",
      unit: "",
      range: "",
      risk: "Low",
      nodePath: "/sys/created",
      accessMode: "RO",
      sortOrder: 1,
      enabled: true,
      bindings: []
    });
    await client.upsertBinding("param-created", "hdc", {
      nodePath: "/sys/created",
      accessMode: "RO",
      enabled: true
    });
    await client.archiveParameter("param-created", "Deprecated");

    expect(apiClient.post).toHaveBeenNthCalledWith(1, "/api/v1/debugging/admin/parameters", expect.objectContaining({ key: "debug.created" }));
    expect(apiClient.put).toHaveBeenCalledWith("/api/v1/debugging/admin/parameters/param-created/bindings/hdc", expect.objectContaining({ accessMode: "RO" }));
    expect(apiClient.post).toHaveBeenNthCalledWith(2, "/api/v1/debugging/admin/parameters/param-created/archive", { reason: "Deprecated" });
  });
});
```

- [ ] **Step 3: Run client tests and verify failure**

Run:

```bash
npm test -- src/infrastructure/http/debuggingAdminClient.test.ts
```

Expected: FAIL because client files do not exist.

- [ ] **Step 4: Add DTO mapper**

Create `src/infrastructure/http/debuggingAdminDtos.ts`:

```ts
import type {
  DebugAdminParameterDraft,
  DebugConnectionProtocol,
  DebugParameter,
  DebugParameterAccessMode,
  DebugParameterNodeBinding
} from "@/domain/debugging/types";

export type DebugAdminParameterDto = {
  id: string;
  projectId: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath?: string;
  accessMode?: DebugParameterAccessMode;
  unit: string;
  range: string;
  minValue?: number | null;
  maxValue?: number | null;
  risk: "Low" | "Medium" | "High";
  currentValue: string;
  targetValue: string;
  sortOrder: number;
  enabled: boolean;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
  bindings: DebugAdminBindingDto[];
};

export type DebugAdminBindingDto = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  isSmokeDefault?: boolean;
  notes?: string | null;
};

export type DebugAdminParameterWriteDto = Omit<DebugAdminParameterDto, "id" | "archivedAt" | "archivedBy" | "archiveReason">;
export type DebugAdminBindingWriteDto = Pick<DebugAdminBindingDto, "nodePath" | "accessMode" | "enabled" | "notes">;

export function debugAdminParameterFromDto(dto: DebugAdminParameterDto): DebugParameter {
  return {
    id: dto.id,
    projectId: dto.projectId,
    name: dto.name,
    key: dto.key,
    description: dto.description,
    module: dto.module,
    currentValue: dto.currentValue,
    targetValue: dto.targetValue,
    unit: dto.unit,
    range: dto.range,
    risk: dto.risk,
    status: "已同步",
    nodePath: dto.nodePath ?? dto.bindings[0]?.nodePath ?? "",
    accessMode: dto.accessMode ?? dto.bindings[0]?.accessMode ?? "RO",
    bindings: dto.bindings.map(debugAdminBindingFromDto),
    enabled: dto.enabled,
    archivedAt: dto.archivedAt,
    archivedBy: dto.archivedBy,
    archiveReason: dto.archiveReason
  };
}

export function debugAdminBindingFromDto(dto: DebugAdminBindingDto): DebugParameterNodeBinding {
  return {
    protocol: dto.protocol,
    nodePath: dto.nodePath,
    accessMode: dto.accessMode,
    enabled: dto.enabled,
    isSmokeDefault: dto.isSmokeDefault,
    notes: dto.notes ?? undefined
  };
}

export function debugAdminParameterToDto(draft: DebugAdminParameterDraft): DebugAdminParameterWriteDto {
  return {
    projectId: draft.projectId ?? null,
    name: draft.name,
    key: draft.key,
    description: draft.description,
    module: draft.module,
    nodePath: draft.nodePath,
    accessMode: draft.accessMode,
    unit: draft.unit,
    range: draft.range,
    minValue: draft.minValue ?? null,
    maxValue: draft.maxValue ?? null,
    risk: draft.risk,
    currentValue: draft.currentValue,
    targetValue: draft.targetValue,
    sortOrder: draft.sortOrder,
    enabled: draft.enabled,
    bindings: draft.bindings.map((binding) => ({
      protocol: binding.protocol,
      nodePath: binding.nodePath,
      accessMode: binding.accessMode,
      enabled: binding.enabled,
      isSmokeDefault: binding.isSmokeDefault,
      notes: binding.notes
    }))
  };
}
```

- [ ] **Step 5: Add admin client**

Create `src/infrastructure/http/debuggingAdminClient.ts`:

```ts
import type { DebugAdminParameterDraft, DebugConnectionProtocol, DebugParameter, DebugParameterAccessMode } from "@/domain/debugging/types";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import {
  debugAdminBindingFromDto,
  debugAdminParameterFromDto,
  debugAdminParameterToDto,
  type DebugAdminBindingDto,
  type DebugAdminParameterDto
} from "./debuggingAdminDtos";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };

export type DebugAdminCoverageFilter =
  | "dual-protocol"
  | "hdc-configured"
  | "adb-configured"
  | "missing-hdc"
  | "missing-adb"
  | "archived";

export type DebugAdminListQuery = {
  projectId?: string;
  module?: string;
  risk?: string[];
  protocol?: DebugConnectionProtocol;
  coverage?: DebugAdminCoverageFilter;
  includeArchived?: boolean;
};

function appendQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function adminParametersPath(query?: DebugAdminListQuery) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  if (query?.module) params.set("module", query.module);
  query?.risk?.forEach((risk) => params.append("risk", risk));
  if (query?.protocol) params.set("protocol", query.protocol);
  if (query?.coverage) params.set("coverage", query.coverage);
  if (query?.includeArchived) params.set("includeArchived", "true");
  return appendQuery("/api/v1/debugging/admin/parameters", params);
}

function adminParameterPath(parameterId: string) {
  return `/api/v1/debugging/admin/parameters/${encodeURIComponent(parameterId)}`;
}

function adminBindingPath(parameterId: string, protocol: DebugConnectionProtocol) {
  return `${adminParameterPath(parameterId)}/bindings/${protocol}`;
}

export function createDebuggingAdminClient(apiClient: ApiClient = createDefaultApiClient()) {
  return {
    async listParameters(query?: DebugAdminListQuery): Promise<DebugParameter[]> {
      const response = await apiClient.get<ItemsEnvelope<DebugAdminParameterDto>>(adminParametersPath(query));
      return response.items.map(debugAdminParameterFromDto);
    },
    async createParameter(draft: DebugAdminParameterDraft): Promise<DebugParameter> {
      const response = await apiClient.post<ItemEnvelope<DebugAdminParameterDto>>(
        "/api/v1/debugging/admin/parameters",
        debugAdminParameterToDto(draft)
      );
      return debugAdminParameterFromDto(response.item);
    },
    async updateParameter(parameterId: string, draft: DebugAdminParameterDraft): Promise<DebugParameter> {
      const response = await apiClient.patch<ItemEnvelope<DebugAdminParameterDto>>(adminParameterPath(parameterId), debugAdminParameterToDto(draft));
      return debugAdminParameterFromDto(response.item);
    },
    async archiveParameter(parameterId: string, reason?: string): Promise<DebugParameter> {
      const response = await apiClient.post<ItemEnvelope<DebugAdminParameterDto>>(`${adminParameterPath(parameterId)}/archive`, { reason });
      return debugAdminParameterFromDto(response.item);
    },
    async restoreParameter(parameterId: string): Promise<DebugParameter> {
      const response = await apiClient.post<ItemEnvelope<DebugAdminParameterDto>>(`${adminParameterPath(parameterId)}/restore`, {});
      return debugAdminParameterFromDto(response.item);
    },
    async upsertBinding(
      parameterId: string,
      protocol: DebugConnectionProtocol,
      binding: { nodePath: string; accessMode: DebugParameterAccessMode; enabled: boolean; notes?: string }
    ) {
      const response = await apiClient.put<ItemEnvelope<DebugAdminBindingDto>>(adminBindingPath(parameterId, protocol), binding);
      return debugAdminBindingFromDto(response.item);
    },
    async archiveBinding(parameterId: string, protocol: DebugConnectionProtocol) {
      const response = await apiClient.post<ItemEnvelope<DebugAdminBindingDto>>(`${adminBindingPath(parameterId, protocol)}/archive`, {});
      return debugAdminBindingFromDto(response.item);
    }
  };
}
```

- [ ] **Step 6: Extend runtime DTO compatibility**

In `src/infrastructure/http/debuggingDtos.ts`, add optional fields to `DebugParameterDto`:

```ts
  enabled?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
  sortOrder?: number;
```

Map these fields in `debugParameterFromDto`:

```ts
enabled: dto.enabled,
archivedAt: dto.archivedAt,
archivedBy: dto.archivedBy,
archiveReason: dto.archiveReason,
```

Add a mapper test in `src/infrastructure/http/debuggingDtos.test.ts` that asserts archived fields survive mapping.

- [ ] **Step 7: Verify task**

Run:

```bash
npm test -- src/infrastructure/http/debuggingAdminClient.test.ts src/infrastructure/http/debuggingDtos.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/domain/debugging/types.ts src/infrastructure/http/debuggingAdminDtos.ts src/infrastructure/http/debuggingAdminClient.ts src/infrastructure/http/debuggingAdminClient.test.ts src/infrastructure/http/debuggingDtos.ts src/infrastructure/http/debuggingDtos.test.ts
git commit -m "feat: add debugging admin frontend client"
```

Expected: commit succeeds.

## Task 5: API-Mode Debugging Admin UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/DebuggingPage.test.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/workspaceHeaderIntegration.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing API-mode admin UI tests**

Replace the read-only API-mode test in `src/DebuggingPage.test.tsx` with:

```ts
describe("/debugging-admin API mode", () => {
  it("loads and edits the backend debugging catalog in API mode", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = {
      get: vi.fn().mockResolvedValue({
        items: [
          {
            id: "param-1",
            projectId: null,
            name: "Fast charge current",
            key: "debug.fast_charge.current",
            description: "Parameter",
            module: "Charging",
            nodePath: "/sys/current",
            accessMode: "RW",
            unit: "mA",
            range: "0-5000",
            risk: "High",
            currentValue: "3000",
            targetValue: "3000",
            sortOrder: 10,
            enabled: true,
            archivedAt: null,
            archivedBy: null,
            archiveReason: null,
            bindings: [
              { protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true },
              { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: true }
            ]
          }
        ]
      }),
      post: vi.fn(),
      patch: vi.fn().mockResolvedValue({
        item: {
          id: "param-1",
          projectId: null,
          name: "Fast charge current edited",
          key: "debug.fast_charge.current",
          description: "Parameter",
          module: "Charging",
          nodePath: "/sys/current",
          accessMode: "RW",
          unit: "mA",
          range: "0-5000",
          risk: "High",
          currentValue: "3000",
          targetValue: "3000",
          sortOrder: 10,
          enabled: true,
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
          bindings: []
        }
      }),
      put: vi.fn()
    };

    render(
      <App
        authClient={createResolvedAdminAuthClient({ permissions: ["debugging:view", "debugging:admin", "admin:access"] })}
        initialAppState={adminState}
        runtimeMode="api"
        debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
      />
    );

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();
    expect(screen.getByText("双协议")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("参数名称"), { target: { value: "Fast charge current edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存参数" }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    expect(apiClient.patch.mock.calls[0][0]).toBe("/api/v1/debugging/admin/parameters/param-1");
  });

  it("archives parameters instead of hard deleting in API mode", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = createDebuggingAdminApiMock();
    apiClient.post.mockResolvedValue({
      item: {
        ...apiClient.seedParameter,
        enabled: false,
        archivedAt: "2026-06-22T12:00:00.000Z",
        archivedBy: "admin-api",
        archiveReason: "No longer supported."
      }
    });

    render(<App authClient={createResolvedAdminAuthClient()} initialAppState={adminState} runtimeMode="api" debuggingAdminClient={createDebuggingAdminClient(apiClient as never)} />);

    await screen.findByText("Fast charge current");
    fireEvent.click(screen.getByRole("button", { name: /归档 Fast charge current/ }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/v1/debugging/admin/parameters/param-1/archive", expect.any(Object)));
  });
});
```

Define `createDebuggingAdminApiMock` in the test file if there is no shared helper:

```ts
function createDebuggingAdminApiMock() {
  const seedParameter = {
    id: "param-1",
    projectId: null,
    name: "Fast charge current",
    key: "debug.fast_charge.current",
    description: "Parameter",
    module: "Charging",
    nodePath: "/sys/current",
    accessMode: "RW",
    unit: "mA",
    range: "0-5000",
    risk: "High",
    currentValue: "3000",
    targetValue: "3000",
    sortOrder: 10,
    enabled: true,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    bindings: [
      { protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true },
      { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: true }
    ]
  };
  return {
    seedParameter,
    get: vi.fn().mockResolvedValue({ items: [seedParameter] }),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn()
  };
}
```

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
npm test -- src/DebuggingPage.test.tsx src/App.test.tsx
```

Expected: FAIL because `debuggingAdminClient` prop and API-mode admin UI do not exist.

- [ ] **Step 3: Add `debuggingAdminClient` App dependency**

In `src/App.tsx`, import:

```ts
import { createDebuggingAdminClient } from "@/infrastructure/http/debuggingAdminClient";
import type { DebugAdminParameterDraft, DebugConnectionProtocol, DebugParameter, DebugParameterNodeBinding } from "@/domain/debugging/types";
```

Extend `App` props with:

```ts
debuggingAdminClient?: ReturnType<typeof createDebuggingAdminClient>;
```

Create a default:

```ts
const defaultDebuggingAdminClient = createDebuggingAdminClient();
```

Pass `debuggingAdminClient ?? defaultDebuggingAdminClient` into `DebuggingAdminPage`.

- [ ] **Step 4: Add admin draft helpers in `src/App.tsx`**

Near `DebuggingAdminPage`, add:

```ts
function emptyDebugAdminDraft(index: number): DebugAdminParameterDraft {
  return {
    projectId: null,
    name: `new_debug_parameter_${index}`,
    key: `debug.new_parameter_${index}`,
    description: "",
    module: "Diagnostics",
    currentValue: "",
    targetValue: "",
    unit: "",
    range: "",
    minValue: null,
    maxValue: null,
    risk: "Low",
    nodePath: "",
    accessMode: "RO",
    sortOrder: index,
    enabled: true,
    bindings: []
  };
}

function draftFromDebugParameter(parameter: DebugParameter): DebugAdminParameterDraft {
  return {
    id: parameter.id,
    projectId: parameter.projectId ?? null,
    name: parameter.name,
    key: parameter.key,
    description: parameter.description,
    module: parameter.module,
    currentValue: parameter.currentValue,
    targetValue: parameter.targetValue,
    unit: parameter.unit,
    range: parameter.range,
    risk: parameter.risk,
    nodePath: parameter.nodePath,
    accessMode: parameter.accessMode,
    sortOrder: 0,
    enabled: parameter.enabled ?? true,
    bindings: parameter.bindings ?? []
  };
}

function bindingForProtocol(bindings: DebugParameterNodeBinding[], protocol: DebugConnectionProtocol): DebugParameterNodeBinding {
  return bindings.find((binding) => binding.protocol === protocol) ?? {
    protocol,
    nodePath: "",
    accessMode: "RO",
    enabled: false,
    notes: ""
  };
}

function coverageLabel(parameter: DebugParameter) {
  if (parameter.archivedAt) return "已归档";
  if (parameter.enabled === false) return "已停用";
  const bindings = parameter.bindings ?? [];
  const hdc = bindings.some((binding) => binding.protocol === "hdc" && binding.enabled);
  const adb = bindings.some((binding) => binding.protocol === "adb" && binding.enabled);
  if (hdc && adb) return "双协议";
  if (hdc) return "HDC 已配置";
  if (adb) return "ADB 已配置";
  return "缺 HDC / ADB";
}
```

- [ ] **Step 5: Replace API-mode branch in `DebuggingAdminPage`**

Keep mock-mode rendering for `runtimeMode !== "api"`. For API mode:

- Load `debuggingAdminClient.listParameters({ includeArchived: true })` in `useEffect`.
- Store `adminParameters`, `adminDraft`, `adminLoading`, `adminError`, and `saveStatus`.
- Render the existing list/editor structure with API data.
- Enable inputs in API mode when auth includes `debugging:admin`.
- The `+ 新增` button creates `emptyDebugAdminDraft(adminParameters.length + 1)`.
- `保存参数` calls `createParameter` when `draft.id` is absent and `updateParameter` when present.
- `归档` calls `archiveParameter(parameter.id, "Archived from debugging admin.")`.
- `恢复` calls `restoreParameter(parameter.id)`.
- HDC/ADB panels edit one binding each with `nodePath`, `accessMode`, `enabled`, and `notes`.
- Saving a draft sends all bindings through parameter create/update; binding-specific buttons may call `upsertBinding` and `archiveBinding` for existing parameters.

Use visible labels:

```text
保存参数
归档 Fast charge current
恢复参数
HDC 节点路径
ADB 节点路径
HDC 访问模式
ADB 访问模式
```

- [ ] **Step 6: Preserve mock-mode config tests**

Keep the existing local config behavior for non-API mode:

- `+ 新增` still dispatches `ADD_DEBUG_PARAMETER`.
- `配置源预览` still serializes `state.configDraft`.
- `保存到 JSON 文件` remains hidden or disabled in API mode.

Update tests in `src/App.test.tsx` that assert API mode is read-only. They should assert backend save/archive controls instead.

- [ ] **Step 7: Add styles**

In `src/styles.css`, add or update classes:

```css
.debug-admin-coverage-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-muted);
  background: var(--surface-muted);
}

.debug-admin-binding-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.debug-admin-binding-panel {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface);
}

@media (max-width: 860px) {
  .debug-admin-binding-grid {
    grid-template-columns: 1fr;
  }
}
```

Use existing design tokens where names differ in `src/styles.css`.

- [ ] **Step 8: Verify task**

Run:

```bash
npm test -- src/DebuggingPage.test.tsx src/App.test.tsx src/workspaceHeaderIntegration.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/App.tsx src/DebuggingPage.test.tsx src/App.test.tsx src/workspaceHeaderIntegration.test.tsx src/styles.css
git commit -m "feat: enable api debugging admin catalog ui"
```

Expected: commit succeeds.

## Task 6: Acceptance Coverage And Browser Verification

**Files:**
- Create: `e2e/acceptance/debugging-admin.acceptance.spec.ts`
- Modify: `e2e/acceptance/operationMatrix.ts`
- Modify: `docs/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/zh-CN/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/developer/user-operation-coverage-matrix.md`
- Modify: `docs/zh-CN/developer/user-operation-coverage-matrix.md`

- [ ] **Step 1: Add operation matrix entry**

In `e2e/acceptance/operationMatrix.ts`, add after `DEBUG-PERM-001`:

```ts
{
  id: "DEBUG-ADMIN-001",
  priority: "P1",
  area: "debugging",
  route: "/debugging-admin",
  roles: ["Admin"],
  action: "Create, edit, archive, restore, and protocol-bind a debugging catalog parameter.",
  coverage: "automated",
  acceptanceIds: ["DEBUG-ADMIN-001"],
  specFiles: ["e2e/acceptance/debugging-admin.acceptance.spec.ts"],
  assertions: ["ui", "api", "db", "audit"]
},
```

- [ ] **Step 2: Update acceptance coverage map**

In `docs/developer/browser-acceptance-coverage-map.md`, add:

```md
| `DEBUG-ADMIN-001` | E | Yes | Debugging admin can create, edit, archive, restore, and protocol-bind catalog parameters in API mode. | `e2e/acceptance/debugging-admin.acceptance.spec.ts` |
```

In `docs/zh-CN/developer/browser-acceptance-coverage-map.md`, add a Chinese summary section if the file remains a companion summary:

```md
## 本次计划新增覆盖

- `DEBUG-ADMIN-001`：API mode 下调试管理后台可新增、编辑、归档、恢复，并维护 HDC/ADB binding。
```

- [ ] **Step 3: Write acceptance spec**

Create `e2e/acceptance/debugging-admin.acceptance.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// @acceptance DEBUG-ADMIN-001
// @operation DEBUG-ADMIN-001
test("debugging admin manages an API-backed HDC/ADB catalog parameter", async ({ page, request }) => {
  await page.goto("/debugging-admin");
  await expect(page.getByRole("listbox", { name: "可调参数目录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 新增" })).toBeEnabled();

  const suffix = Date.now().toString(36);
  await page.getByRole("button", { name: "+ 新增" }).click();
  await page.getByLabel("参数名称").fill(`Acceptance debug parameter ${suffix}`);
  await page.getByLabel("参数 key").fill(`debug.acceptance.${suffix}`);
  await page.getByLabel("HDC 节点路径").fill(`/tmp/wiseeff/acceptance/${suffix}/hdc`);
  await page.getByLabel("ADB 节点路径").fill(`/tmp/wiseeff/acceptance/${suffix}/adb`);
  await page.getByRole("button", { name: "保存参数" }).click();

  await expect(page.getByText("已保存")).toBeVisible();
  await expect(page.getByText("双协议")).toBeVisible();

  const listResponse = await request.get("/api/v1/debugging/admin/parameters?includeArchived=true");
  expect(listResponse.ok()).toBeTruthy();
  const listBody = await listResponse.json();
  const created = listBody.items.find((item: { key?: string }) => item.key === `debug.acceptance.${suffix}`);
  expect(created).toBeTruthy();
  expect(created.bindings.some((binding: { protocol: string; enabled: boolean }) => binding.protocol === "hdc" && binding.enabled)).toBeTruthy();
  expect(created.bindings.some((binding: { protocol: string; enabled: boolean }) => binding.protocol === "adb" && binding.enabled)).toBeTruthy();

  await page.getByRole("button", { name: new RegExp(`归档 Acceptance debug parameter ${suffix}`) }).click();
  await expect(page.getByText("已归档")).toBeVisible();
  await page.getByRole("button", { name: "恢复参数" }).click();
  await expect(page.getByText("双协议")).toBeVisible();
});
```

If the acceptance fixture requires explicit login/setup helpers, import and reuse the helpers already used by `e2e/acceptance/debugging-simulator.acceptance.spec.ts`.

- [ ] **Step 4: Regenerate operation matrices**

Run:

```bash
npm run acceptance:operations
```

Expected: exits 0 and updates generated operation matrix docs if the script writes them. If it only checks, update `docs/developer/user-operation-coverage-matrix.md` and `docs/zh-CN/developer/user-operation-coverage-matrix.md` manually with `DEBUG-ADMIN-001`.

- [ ] **Step 5: Run acceptance coverage checks**

Run:

```bash
npm run acceptance:coverage
npm run acceptance:operations
```

Expected: both commands exit 0.

- [ ] **Step 6: Run browser acceptance spec**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/debugging-admin.acceptance.spec.ts
```

Expected: PASS in API mode with seeded DB. If local DB is not running, record the exact missing dependency and run the frontend Playwright CLI smoke in Task 8 before completion.

- [ ] **Step 7: Commit**

Run:

```bash
git add e2e/acceptance/debugging-admin.acceptance.spec.ts e2e/acceptance/operationMatrix.ts docs/developer/browser-acceptance-coverage-map.md docs/zh-CN/developer/browser-acceptance-coverage-map.md docs/developer/user-operation-coverage-matrix.md docs/zh-CN/developer/user-operation-coverage-matrix.md
git commit -m "test: add debugging admin acceptance coverage"
```

Expected: commit succeeds.

## Task 7: Documentation Updates

**Files:**
- Modify: `docs/design-docs/api-contract.md`
- Modify: `docs/zh-CN/design-docs/api-contract.md`
- Modify: `docs/design-docs/domain-model.md`
- Modify: `docs/zh-CN/design-docs/domain-model.md`
- Modify: `docs/FRONTEND.md`
- Modify: `docs/zh-CN/frontend.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/zh-CN/SECURITY.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `docs/zh-CN/design-docs/testing-strategy.md`
- Review: `docs/developer/environment-variables.md`
- Review: `docs/zh-CN/developer/environment-variables.md`
- Review: `docs/runbooks/adb-device-lab.md`
- Review: `docs/zh-CN/runbooks/adb-device-lab.md`

- [x] **Step 1: Update API contract docs**

Add to `docs/design-docs/api-contract.md` under debugging APIs:

```md
### Debugging Admin Catalog

`/api/v1/debugging/admin/*` is reserved for Admin catalog governance and requires `debugging:admin`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/debugging/admin/parameters` | List full debugging catalog, including disabled or archived rows when `includeArchived=true`. |
| `POST` | `/api/v1/debugging/admin/parameters` | Create a debugging parameter and optional HDC/ADB bindings. |
| `PATCH` | `/api/v1/debugging/admin/parameters/:parameterId` | Update debugging parameter metadata. |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/archive` | Archive a parameter without deleting historical references. |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/restore` | Restore an archived parameter. |
| `PUT` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol` | Upsert the HDC or ADB node binding. |
| `PATCH` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol` | Update the HDC or ADB node binding. |
| `POST` | `/api/v1/debugging/admin/parameters/:parameterId/bindings/:protocol/archive` | Disable one protocol binding. |

Runtime `/api/v1/debugging/parameters?protocol=...` filters out archived parameters and disabled selected-protocol bindings. Admin list APIs can return missing bindings so the management page can show coverage labels.
```

Add equivalent Chinese content to `docs/zh-CN/design-docs/api-contract.md`.

- [x] **Step 2: Update domain model docs**

Add to `docs/design-docs/domain-model.md`:

```md
Debugging catalog governance is split from runtime execution. `debugging_parameters.enabled=false` or non-null `archived_at` removes a parameter from runtime lists but keeps audit, snapshot, and operation history understandable. HDC and ADB node bindings remain separate rows in `debugging_parameter_node_bindings`; disabling one binding only affects that protocol.
```

Add equivalent Chinese content to `docs/zh-CN/design-docs/domain-model.md`.

- [x] **Step 3: Update frontend docs**

Add to `docs/FRONTEND.md`:

```md
`/debugging-admin` uses API-backed catalog management in API mode. It calls `src/infrastructure/http/debuggingAdminClient.ts` to list, create, update, archive, restore, and bind debug parameters. Mock mode keeps the local `configDraft` path for demos and component tests.
```

Add equivalent Chinese content to `docs/zh-CN/frontend.md`.

- [x] **Step 4: Update security docs**

Add to `docs/SECURITY.md`:

```md
Debugging catalog administration requires `debugging:admin`. This permission governs metadata and node-binding changes only; device node writes still require the runtime debugging write path and its confirmation/approval checks. Audit metadata for binding changes should avoid publishing raw node paths unless the deployment policy explicitly allows them.
```

Add equivalent Chinese content to `docs/zh-CN/SECURITY.md`.

- [x] **Step 5: Update testing strategy docs**

Add to `docs/design-docs/testing-strategy.md`:

```md
Debugging admin catalog changes are covered by `DEBUG-ADMIN-001` in `e2e/acceptance/debugging-admin.acceptance.spec.ts`. The acceptance flow exercises Admin UI, API, DB persistence, and audit evidence for parameter create/edit/archive/restore plus HDC/ADB binding management.
```

Add equivalent Chinese content to `docs/zh-CN/design-docs/testing-strategy.md`.

- [x] **Step 6: Record no-change reviews**

If no environment variable or ADB lab runbook behavior changes, add a short note to this plan's Documentation Update Gate evidence section after implementation:

```md
- `docs/developer/environment-variables.md` and `docs/zh-CN/developer/environment-variables.md`: reviewed; no new env vars introduced.
- `docs/runbooks/adb-device-lab.md` and `docs/zh-CN/runbooks/adb-device-lab.md`: reviewed; default smoke binding requirements are unchanged.
```

- [x] **Step 7: Verify docs**

Run:

```bash
node --import tsx scripts/check-doc-governance.ts
```

Expected: PASS. If running `npm run docs:check` in the desktop sandbox fails with `tsx` IPC `EPERM`, record the failure and the successful `node --import tsx` equivalent.

- [ ] **Step 8: Commit**

Run:

```bash
git add docs/design-docs/api-contract.md docs/zh-CN/design-docs/api-contract.md docs/design-docs/domain-model.md docs/zh-CN/design-docs/domain-model.md docs/FRONTEND.md docs/zh-CN/frontend.md docs/SECURITY.md docs/zh-CN/SECURITY.md docs/design-docs/testing-strategy.md docs/zh-CN/design-docs/testing-strategy.md
git commit -m "docs: document debugging admin catalog governance"
```

Expected: commit succeeds.

## Task 8: Final Verification And Plan Completion

**Files:**
- Modify: `docs/exec-plans/active/2026-06-22-wiseeff-debugging-admin-hdc-adb-crud.md`
- Move after completion: `docs/exec-plans/completed/2026-06-22-wiseeff-debugging-admin-hdc-adb-crud.md`

- [x] **Step 1: Run narrow backend and frontend tests**

Run:

```bash
npm run test:server -- server/modules/debugging/schemas.test.ts server/modules/debugging/repository.test.ts server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts
npm test -- src/infrastructure/http/debuggingAdminClient.test.ts src/infrastructure/http/debuggingDtos.test.ts src/DebuggingPage.test.tsx src/App.test.tsx src/workspaceHeaderIntegration.test.tsx
```

Expected: all tests PASS.

Actual evidence:

- `./node_modules/.bin/vitest run --config vitest.server.config.ts server/modules/debugging/schemas.test.ts server/modules/debugging/repository.test.ts server/modules/debugging/service.test.ts` exited 0 with 3 files / 113 tests passed.
- `./node_modules/.bin/vitest run --config vitest.server.config.ts server/modules/contracts/routeManifest.test.ts server/modules/contracts/openapi.test.ts` exited 0 with 2 files / 12 tests passed.
- `VITE_WISEEFF_RUNTIME_MODE=mock ./node_modules/.bin/vitest run src/infrastructure/http/debuggingAdminClient.test.ts src/infrastructure/http/debuggingDtos.test.ts src/DebuggingPage.test.tsx src/App.test.tsx src/workspaceHeaderIntegration.test.tsx src/NodeDebuggingPage.test.tsx` exited 0 with 6 files / 208 tests passed.
- `VITE_WISEEFF_RUNTIME_MODE=mock ./node_modules/.bin/vitest run src/NodeDebuggingPage.test.tsx` exited 0 with 44 tests passed.
- `./node_modules/.bin/vitest run --config vitest.server.config.ts server/modules/debugging/routes.test.ts` is blocked in the desktop sandbox because `server/test/testClient.ts` calls `server.listen(0, "127.0.0.1")`; every route test fails with `listen EPERM: operation not permitted 127.0.0.1` and 5s timeout. This is an environment socket restriction, not an assertion failure.
- `npm test -- ...` is blocked in the desktop sandbox because the `tsx scripts/run-vitest.ts` wrapper tries to create an IPC pipe and fails with `listen EPERM .../tsx-501/*.pipe`; the same frontend tests pass through direct `./node_modules/.bin/vitest`.

- [x] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: TypeScript project build and Vite production build exit 0.

Actual evidence:

- `npm run build` exited 0. Vite emitted the existing chunk-size warning for the main bundle, but TypeScript and production build completed successfully.

- [x] **Step 3: Run documentation and acceptance checks**

Run:

```bash
node --import tsx scripts/check-doc-governance.ts
npm run acceptance:coverage
npm run acceptance:operations
```

Expected: all commands exit 0.

Actual evidence:

- `node --import tsx scripts/check-doc-governance.ts` exited 0 with `Documentation governance check passed.`
- `node --import tsx scripts/check-acceptance-coverage.ts` exited 0 with `DEBUG-ADMIN-001` covered and no missing required IDs.
- `node --import tsx scripts/check-acceptance-operation-matrix.ts` exited 0 with `DEBUG-ADMIN-001` covered and no operation matrix gaps.
- `node --import tsx scripts/check-openapi-contract.ts` exited 0 with `OpenAPI contract artifact is current.`
- `git diff --check` exited 0.
- `npm run docs:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` are blocked in the desktop sandbox because their `tsx` CLI wrapper tries to create an IPC pipe and fails with `listen EPERM .../tsx-501/*.pipe`; the direct `node --import tsx` equivalents above passed.
- `node --import tsx scripts/check-operation-evidence.ts` currently exits 1 because this workspace has no local acceptance operation evidence records available for any required operation, including `DEBUG-ADMIN-001`. The generated evidence index changes from that failed run are not intended implementation output.

- [ ] **Step 4: Run browser verification with playwright-cli**

Start the dev servers:

```bash
npm run dev:all
```

In another shell, run:

```bash
playwright-cli --version
playwright-cli -s=debug-admin open http://127.0.0.1:5173/debugging-admin
playwright-cli -s=debug-admin resize 1440 900
playwright-cli -s=debug-admin snapshot
playwright-cli -s=debug-admin screenshot --filename=work/ui-checks/debugging-admin-desktop.png
playwright-cli -s=debug-admin resize 768 1024
playwright-cli -s=debug-admin snapshot
playwright-cli -s=debug-admin screenshot --filename=work/ui-checks/debugging-admin-tablet.png
playwright-cli -s=debug-admin resize 390 844
playwright-cli -s=debug-admin snapshot
playwright-cli -s=debug-admin screenshot --filename=work/ui-checks/debugging-admin-mobile.png
playwright-cli -s=debug-admin console error
playwright-cli -s=debug-admin open http://127.0.0.1:5173/node-debugging?project=aurora
playwright-cli -s=debug-admin resize 1440 900
playwright-cli -s=debug-admin snapshot
playwright-cli -s=debug-admin screenshot --filename=work/ui-checks/node-debugging-after-admin-desktop.png
playwright-cli -s=debug-admin console error
playwright-cli -s=debug-admin close
```

Expected:

- `/debugging-admin` loads without console errors.
- Desktop/tablet/mobile layouts have no overlapping controls or clipped critical text.
- HDC and ADB binding panels are visible and editable for Admin.
- `/node-debugging?project=aurora` still loads and protocol switching remains available.
- Screenshot paths are recorded in the final response.

Actual evidence:

- `playwright-cli --version` exited 0 with `0.1.14`.
- Browser verification could not run in this desktop sandbox because any local listen operation is blocked:
  - `npm run dev -- --host 127.0.0.1 --port 5173` failed with `listen EPERM: operation not permitted 127.0.0.1:5173`.
  - `node -e "require('node:net').createServer().listen(0, '127.0.0.1')"` failed with `listen EPERM: operation not permitted 127.0.0.1`.
  - `node -e "...listen('/tmp/wiseeff-listen-probe-*.sock')"` failed with `listen EPERM` for the Unix socket path.
- No new `/debugging-admin` screenshots were generated in this sandbox. Existing `work/ui-checks/hdc-node-debugging-*.png` screenshots are from the earlier HDC node debugging work and are not part of this final admin browser verification.

- [ ] **Step 5: Run acceptance spec where dependencies are available**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/debugging-admin.acceptance.spec.ts
```

Expected: PASS when local API-mode acceptance dependencies are running. If a local database or seeded backend is unavailable, record the blocker, keep the spec committed, and do not claim acceptance completion.

Actual evidence:

- `npm run acceptance:e2e -- e2e/acceptance/debugging-admin.acceptance.spec.ts` is blocked in this desktop sandbox before tests start because Playwright's configured webServer invokes `tsx`, which fails with `listen EPERM .../tsx-501/*.pipe`.
- The acceptance spec is committed as executable coverage, but full browser/API/DB/audit acceptance remains to be run in an environment that permits local listening and has the seeded API-mode dependencies available.

- [x] **Step 6: Complete documentation update gate**

Update the section `Documentation Update Gate Evidence` in this plan with:

```md
- `docs/design-docs/api-contract.md` and `docs/zh-CN/design-docs/api-contract.md`: updated with admin catalog routes.
- `docs/design-docs/domain-model.md` and `docs/zh-CN/design-docs/domain-model.md`: updated with archive semantics.
- `docs/FRONTEND.md` and `docs/zh-CN/frontend.md`: updated with API-mode debugging admin client.
- `docs/SECURITY.md` and `docs/zh-CN/SECURITY.md`: updated with `debugging:admin` boundary.
- `docs/design-docs/testing-strategy.md` and `docs/zh-CN/design-docs/testing-strategy.md`: updated with `DEBUG-ADMIN-001`.
- `docs/generated/db-schema.md`: updated with `0019` archive fields and indexes.
- `docs/developer/environment-variables.md` and `docs/zh-CN/developer/environment-variables.md`: reviewed; no new env vars introduced.
- `docs/runbooks/adb-device-lab.md` and `docs/zh-CN/runbooks/adb-device-lab.md`: reviewed; no lab runbook change required.
- Verification: `node --import tsx scripts/check-doc-governance.ts` exited 0.
```

- [ ] **Step 7: Move completed plan**

Run:

```bash
mv docs/exec-plans/active/2026-06-22-wiseeff-debugging-admin-hdc-adb-crud.md docs/exec-plans/completed/2026-06-22-wiseeff-debugging-admin-hdc-adb-crud.md
```

Expected: the plan is moved only after implementation, verification, and documentation update gate are complete.

Actual status:

- Documentation update gate is complete for this implementation.
- The plan remains under `docs/exec-plans/active/` because browser verification, route HTTP tests, acceptance e2e, and operation evidence generation are blocked by the current desktop sandbox socket restrictions and still need to be run in a suitable environment.

- [ ] **Step 8: Final commit**

Run:

```bash
git add docs/exec-plans/completed/2026-06-22-wiseeff-debugging-admin-hdc-adb-crud.md
git commit -m "docs: complete debugging admin catalog plan"
```

Expected: commit succeeds.

Actual status:

- Commit and PR creation are blocked in the current desktop sandbox.
- `git add ...` fails with `fatal: Unable to create '/Users/tzrea1/Develop/WiseEff/.git/index.lock': Operation not permitted`, so this environment cannot stage or commit changes.
- `gh auth status` reports the active GitHub token for `tzrea1-Q` is invalid; PR creation requires re-authentication with `gh auth login -h github.com`.
- Keep `work/ui-checks/` screenshots out of the final commit unless they are intentionally needed as evidence artifacts.

## Documentation Impact Matrix

| Area | Status | Files | Required action |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`, `docs/zh-CN/README.md` | Review after implementation; update only if new admin module files need durable map entries. |
| Planning docs | Update | `docs/exec-plans/active/2026-06-22-wiseeff-debugging-admin-hdc-adb-crud.md` | Keep this plan updated during implementation, then move to completed. |
| Product specs | Review | `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md`, `docs/zh-CN/product-specs/prototype-functional-spec.md` | Review whether debugging admin behavior text is stale; record unchanged if prototype wording remains acceptable. |
| Architecture docs | Update | `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md`, `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md` | Document admin APIs, archive semantics, and runtime/admin catalog split. |
| Quality/testing docs | Update | `docs/design-docs/testing-strategy.md`, `docs/zh-CN/design-docs/testing-strategy.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/zh-CN/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/zh-CN/developer/user-operation-coverage-matrix.md` | Add `DEBUG-ADMIN-001` and acceptance guidance. |
| Reliability/runbooks | Review | `docs/runbooks/adb-device-lab.md`, `docs/zh-CN/runbooks/adb-device-lab.md`, `docs/runbooks/hdc-device-lab.md`, `docs/zh-CN/runbooks/hdc-device-lab.md` | Review because binding governance affects device lab setup; update only if operational steps change. |
| Security/governance docs | Update | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md` | Document `debugging:admin` catalog boundary and audit redaction expectations. |
| Frontend/design docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Document API-mode debugging admin client and mock fallback. |
| Generated artifacts | Update | `docs/generated/db-schema.md` | Add `0019` archive fields and indexes. |
| References | Review | `docs/references/`, `docs/zh-CN/` related indexes | Review after docs update; update only if index links become stale. |
| Environment variables | Review | `docs/developer/environment-variables.md`, `docs/zh-CN/developer/environment-variables.md`, `.env.example` | No new env vars expected; record unchanged after review. |

## Documentation Update Gate

This plan cannot move to `docs/exec-plans/completed/` until every `Update` and `Review` row in the matrix is resolved.

Blocking evidence required before completion:

- API contract docs updated in English and Chinese.
- Domain model docs updated in English and Chinese.
- Frontend docs updated in English and Chinese.
- Security docs updated in English and Chinese.
- Testing/acceptance docs updated in English and Chinese.
- Generated DB schema updated.
- Environment-variable docs reviewed and recorded as unchanged or updated.
- Device-lab runbooks reviewed and recorded as unchanged or updated.
- `node --import tsx scripts/check-doc-governance.ts` passes, or `npm run docs:check` passes in an environment where `tsx` CLI IPC is permitted.

## Documentation Update Gate Evidence

- `docs/design-docs/api-contract.md` and `docs/zh-CN/design-docs/api-contract.md`: updated with `/api/v1/debugging/admin/*` routes, `debugging:admin`, and runtime enabled/non-archived filtering.
- `docs/design-docs/domain-model.md` and `docs/zh-CN/design-docs/domain-model.md`: updated with archive semantics, admin/runtime catalog separation, and protocol-independent HDC/ADB bindings.
- `docs/FRONTEND.md` and `docs/zh-CN/frontend.md`: updated with API-mode `debuggingAdminClient` behavior and mock-mode `configDraft`/JSON behavior.
- `docs/SECURITY.md` and `docs/zh-CN/SECURITY.md`: updated with the `debugging:admin` catalog boundary, runtime device-write separation, and raw node path audit metadata constraint.
- `docs/design-docs/testing-strategy.md` and `docs/zh-CN/design-docs/testing-strategy.md`: updated with `DEBUG-ADMIN-001` Admin UI/API/DB/audit coverage.
- `docs/generated/db-schema.md`: updated with migration `0019` archive fields and runtime/admin indexes.
- `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`, and `docs/zh-CN/README.md`: reviewed; existing repository maps remain accurate and do not need new file-level entries for this scoped admin API/UI work.
- `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md`, and `docs/zh-CN/product-specs/prototype-functional-spec.md`: reviewed; existing debugging workflow/product wording remains accurate because catalog administration does not change the end-user runtime workflow.
- `docs/developer/environment-variables.md` and `docs/zh-CN/developer/environment-variables.md`: reviewed; no new env vars introduced.
- `.env.example`: reviewed; existing `DEBUG_DEVICE_GATEWAY_MODE=multi` and HDC/ADB timeout keys cover this work with no new env vars.
- `docs/runbooks/adb-device-lab.md` and `docs/zh-CN/runbooks/adb-device-lab.md`: reviewed; default smoke binding requirements are unchanged and no lab runbook change is required.
- `docs/runbooks/hdc-device-lab.md` and `docs/zh-CN/runbooks/hdc-device-lab.md`: reviewed; lab-only HDC binding setup remains unchanged by admin catalog CRUD.
- `docs/references/` and `docs/zh-CN/` related indexes: reviewed; no index links became stale from the new admin catalog docs.
- Verification: `node --import tsx scripts/check-doc-governance.ts` exited 0 with `Documentation governance check passed.`

## Final Verification Checklist

- [ ] `npm run test:server -- server/modules/debugging/schemas.test.ts server/modules/debugging/repository.test.ts server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts`
- [ ] `npm test -- src/infrastructure/http/debuggingAdminClient.test.ts src/infrastructure/http/debuggingDtos.test.ts src/DebuggingPage.test.tsx src/App.test.tsx src/workspaceHeaderIntegration.test.tsx`
- [ ] `npm run build`
- [ ] `node --import tsx scripts/check-doc-governance.ts`
- [ ] `npm run acceptance:coverage`
- [ ] `npm run acceptance:operations`
- [ ] `npm run acceptance:e2e -- e2e/acceptance/debugging-admin.acceptance.spec.ts`
- [ ] Playwright CLI desktop/tablet/mobile screenshots for `/debugging-admin`
- [ ] Playwright CLI smoke for `/node-debugging?project=aurora`
