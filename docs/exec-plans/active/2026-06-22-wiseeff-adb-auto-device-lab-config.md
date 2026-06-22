# WiseEff ADB Auto Device-Lab Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the ADB device-lab acceptance flow auto-configure from one connected ADB device, one ADB device inventory row, and one shared default ADB smoke binding, while making debugging parameters a shared organization catalog instead of a project-scoped catalog.

**Architecture:** Parameter management remains project-scoped in the M1 parameter-management tables. Parameter debugging moves to an organization-scoped catalog: `debugging_parameters` and `debugging_parameter_node_bindings` allow `project_id = null`, while sessions, targets, operations, snapshots, events, audit, and device leases keep project context for authorization and evidence. The ADB lab resolver discovers the ready ADB target, reads the existing catalog/default binding, validates optional overrides, and drives the same WiseEff debugging APIs without creating or repairing device or binding data.

**Tech Stack:** TypeScript, PostgreSQL migrations, WiseEff modular API router, Vitest, Playwright acceptance tests, React/Vite debugging frontend, repository documentation governance.

---

## Source Spec

- `docs/superpowers/specs/2026-06-22-adb-auto-device-lab-config-design.md`
- `docs/zh-CN/superpowers/specs/2026-06-22-adb-auto-device-lab-config-design.md`

## Scope Notes

- Parameter management is not changed. Files under `server/modules/parameters/` and M1 tables stay project-scoped.
- Runtime debugging records remain project-contextual: `debugging_sessions`, `debugging_targets`, `debug_device_leases`, `node_operations`, `debugging_snapshots`, `debugging_events`, and `audit_events`.
- The ADB lab may read device inventory rows, parameters, and bindings. It must not create, update, or repair ADB inventory rows, parameters, or bindings during the lab run.
- `ADB_SMOKE_PROJECT_ID` remains required as operation context. `ADB_SMOKE_DEVICE_ID`, `ADB_SMOKE_TARGET_REF`, `ADB_SMOKE_PARAMETER_ID`, and `ADB_SMOKE_NODE_PATH` become optional validation overrides.
- Shared catalog rows use `project_id = null`. Legacy project-scoped catalog rows remain readable only for their owning project during migration.
- A default ADB smoke binding uses `debugging_parameter_node_bindings.is_smoke_default = true`.

## File Structure

Create:

- `server/migrations/0018_shared_debugging_catalog_adb_smoke_default.sql`: make debugging catalog project ids nullable, add smoke-default marker, and add partial uniqueness/indexes.

Modify:

- `server/modules/debugging/types.ts`: make debugging parameter and binding `projectId` nullable; add `isSmokeDefault`.
- `server/modules/debugging/repository.ts`: include shared catalog rows in list queries, map nullable project ids, map `is_smoke_default`, and add default ADB smoke binding query helpers.
- `server/modules/debugging/repository.test.ts`: cover shared catalog queries and default binding lookup contracts.
- `server/modules/debugging/service.ts`: allow shared parameters across project contexts while keeping legacy project rows project-limited; list shared bindings for selected protocol.
- `server/modules/debugging/service.test.ts`: prove shared parameter read/write/list behavior and preserved session project authorization.
- `server/modules/debugging/routes.test.ts`: update DTO fixture expectations for nullable catalog project ids and smoke-default binding fields if routes expose them.
- `src/domain/debugging/types.ts`: make debugging parameter project id optional/null for shared catalog rows; add binding default metadata if surfaced.
- `src/infrastructure/http/debuggingDtos.ts`: map nullable `projectId` and binding `isSmokeDefault`.
- `src/infrastructure/http/debuggingDtos.test.ts`: cover shared debugging parameters returned for a selected project context.
- `src/application/ports/DebuggingGateway.ts`: allow shared parameter project ids in API-mode snapshots if needed by existing compile errors.
- `src/application/debugging/debuggingRuntime.ts`: keep `projectId` as the refresh/session context, not a catalog filter assumption.
- `src/application/debugging/debuggingRuntime.test.ts`: prove refresh passes project context and accepts shared rows.
- `e2e/acceptance/adb-device-lab.acceptance.spec.ts`: replace manual smoke config with auto discovery and default-binding resolution.
- `docs/runbooks/adb-device-lab.md`: document minimal ADB lab env and default binding requirements.
- `docs/zh-CN/runbooks/adb-device-lab.md`: Chinese companion update.
- `docs/developer/environment-variables.md`: document changed `ADB_SMOKE_*` requirements.
- `docs/zh-CN/developer/environment-variables.md`: Chinese companion update.
- `docs/design-docs/domain-model.md`: document shared debugging catalog and project-contextual operations.
- `docs/zh-CN/design-docs/domain-model.md`: Chinese companion update.
- `docs/design-docs/api-contract.md`: document debugging parameter list semantics and binding resolution.
- `docs/zh-CN/design-docs/api-contract.md`: Chinese companion update.
- `docs/generated/db-schema.md`: manually align schema summary with migration `0018`.

Review:

- `docs/developer/browser-acceptance-coverage-map.md`: confirm `ADB-LAB-001` still points to `e2e/acceptance/adb-device-lab.acceptance.spec.ts`.
- `docs/developer/user-operation-coverage-matrix.md`: confirm `ADB-LAB-001` remains conditional and describes auto configuration.
- `docs/zh-CN/developer/browser-acceptance-coverage-map.md`: Chinese coverage companion review.
- `docs/zh-CN/developer/user-operation-coverage-matrix.md`: Chinese operation matrix companion review.
- `e2e/acceptance/operationMatrix.ts`: confirm no new operation id is needed because `ADB-LAB-001` already exists.

## Acceptance Coverage Impact

- Existing affected requirement ID: `ADB-LAB-001`.
- Existing affected operation ID: `ADB-LAB-001`.
- Affected spec: `e2e/acceptance/adb-device-lab.acceptance.spec.ts`.
- Operation evidence impact: `npm run acceptance:evidence` must still find `ADB-LAB-001`; generated evidence must show auto-configuration through shape summaries and must not include raw serials, node paths, values, operation ids, session ids, snapshot ids, audit ids, or request ids.

## Task 1: Shared Debugging Catalog Migration Contract

**Files:**
- Create: `server/migrations/0018_shared_debugging_catalog_adb_smoke_default.sql`
- Modify: `docs/generated/db-schema.md`

- [ ] **Step 1: Create the migration**

Create `server/migrations/0018_shared_debugging_catalog_adb_smoke_default.sql` with this content:

```sql
alter table debugging_parameters
  alter column project_id drop not null;

alter table debugging_parameter_node_bindings
  alter column project_id drop not null;

alter table debugging_parameter_node_bindings
  add column if not exists is_smoke_default boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'debugging_parameter_node_bindings_smoke_default_protocol_check'
  ) then
    alter table debugging_parameter_node_bindings
      add constraint debugging_parameter_node_bindings_smoke_default_protocol_check
      check (is_smoke_default = false or protocol = 'adb');
  end if;
end;
$$;

create unique index if not exists debugging_parameters_shared_key_idx
  on debugging_parameters(organization_id, key)
  where project_id is null;

create unique index if not exists debugging_parameters_shared_node_path_idx
  on debugging_parameters(organization_id, node_path)
  where project_id is null;

create index if not exists debugging_parameters_shared_filter_idx
  on debugging_parameters(organization_id, module, risk, sort_order)
  where project_id is null;

create index if not exists debugging_parameter_node_bindings_shared_protocol_idx
  on debugging_parameter_node_bindings(organization_id, protocol, enabled)
  where project_id is null;

create unique index if not exists debugging_parameter_node_bindings_default_adb_smoke_idx
  on debugging_parameter_node_bindings(organization_id)
  where protocol = 'adb'
    and is_smoke_default = true;
```

- [ ] **Step 2: Verify migration applies to an empty/current database**

Run:

```bash
npm run db:migrate
```

Expected: the command exits 0. If the local database is already migrated through `0018_shared_debugging_catalog_adb_smoke_default.sql`, the output may report zero migrations applied.

- [ ] **Step 3: Update generated schema summary**

Update `docs/generated/db-schema.md` manually because `docs/exec-plans/tech-debt-tracker.md` records that database schema docs are manually derived. The debugging section must state:

```md
### `debugging_parameters`

Stores the shared organization-level debugging parameter catalog. `project_id` is nullable; `project_id = null` means the parameter belongs to the shared debugging catalog. Legacy non-null `project_id` rows remain readable for their owning project during migration.

Key columns:
- `id`, `organization_id`, nullable `project_id`
- `key`, `name`, `module`, `node_path`, `access_mode`
- `risk`, `current_value`, `target_value`, `sort_order`

Indexes and constraints:
- legacy unique constraints on `project_id, key` and `project_id, node_path`
- `debugging_parameters_shared_key_idx` on `organization_id, key` where `project_id is null`
- `debugging_parameters_shared_node_path_idx` on `organization_id, node_path` where `project_id is null`
- `debugging_parameters_shared_filter_idx` for shared catalog filtering

### `debugging_parameter_node_bindings`

Stores protocol-specific node bindings for shared or legacy debugging parameters. `project_id` is nullable; shared bindings use `project_id = null`.

Key columns:
- `id`, `organization_id`, nullable `project_id`, `parameter_id`
- `protocol`, `node_path`, `access_mode`, `enabled`
- `is_smoke_default`
- `notes`, `metadata`, timestamps

Indexes and constraints:
- unique `(parameter_id, protocol)`
- `debugging_parameter_node_bindings_project_idx` for legacy project-scoped lookup
- `debugging_parameter_node_bindings_shared_protocol_idx`
- `debugging_parameter_node_bindings_default_adb_smoke_idx`, allowing at most one default ADB smoke binding per organization
- `debugging_parameter_node_bindings_smoke_default_protocol_check`
```

- [ ] **Step 4: Verify schema docs mention the new migration**

Run:

```bash
rg -n "0018_shared_debugging_catalog_adb_smoke_default|is_smoke_default|debugging_parameter_node_bindings_default_adb_smoke_idx|debugging_parameters_shared_key_idx" docs/generated/db-schema.md server/migrations/0018_shared_debugging_catalog_adb_smoke_default.sql
```

Expected: each token appears in either the migration or `docs/generated/db-schema.md`; no search exits with code 1.

- [ ] **Step 5: Commit**

Run:

```bash
git add server/migrations/0018_shared_debugging_catalog_adb_smoke_default.sql docs/generated/db-schema.md
git commit -m "feat: add shared debugging catalog migration"
```

Expected: commit succeeds and does not stage `.playwright-cli/` or `work/`.

## Task 2: Repository Shared-Catalog Queries And Default Binding Lookup

**Files:**
- Modify: `server/modules/debugging/types.ts`
- Modify: `server/modules/debugging/repository.ts`
- Modify: `server/modules/debugging/repository.test.ts`

- [ ] **Step 1: Write repository tests for nullable project ids and shared reads**

Add these tests inside `describe("debugging repository", () => { ... })` in `server/modules/debugging/repository.test.ts`:

```ts
it("lists shared debugging parameters for a project context", async () => {
  const { db, calls } = createFakeDb([
    [
      {
        id: "shared-param-1",
        organization_id: "org-1",
        project_id: null,
        name: "ADB smoke readable",
        key: "adb_smoke_readable",
        description: "Shared smoke parameter.",
        module: "Diagnostics",
        node_path: "/sys/adb/smoke",
        access_mode: "RO",
        unit: "",
        range_label: "",
        min_value: null,
        max_value: null,
        risk: "Low",
        current_value: "",
        target_value: "",
        sort_order: 1
      }
    ]
  ]);

  const parameters = await listDebugParameters(db, { organizationId: "org-1", projectId: "aurora" });

  expect(calls[0].text).toContain("(project_id is null or project_id = $2)");
  expect(calls[0].values).toEqual(["org-1", "aurora"]);
  expect(parameters).toEqual([
    expect.objectContaining({
      id: "shared-param-1",
      projectId: null,
      key: "adb_smoke_readable"
    })
  ]);
});

it("lists shared debugging parameters for multiple allowed project contexts", async () => {
  const { db, calls } = createFakeDb([[]]);

  await listDebugParameters(db, { organizationId: "org-1", projectIds: ["aurora", "zephyr"] });

  expect(calls[0].text).toContain("(project_id is null or project_id = any($2::text[]))");
  expect(calls[0].values).toEqual(["org-1", ["aurora", "zephyr"]]);
});

it("lists shared protocol bindings for selected parameters", async () => {
  const { db, calls } = createFakeDb([
    [
      {
        id: "binding-shared-adb",
        organization_id: "org-1",
        project_id: null,
        parameter_id: "shared-param-1",
        protocol: "adb",
        node_path: "/sys/adb/smoke",
        access_mode: "RO",
        enabled: true,
        is_smoke_default: true,
        notes: "Default ADB smoke binding.",
        created_at: timestamp,
        updated_at: timestamp
      }
    ]
  ]);

  const bindings = await listDebugParameterNodeBindings(db, {
    organizationId: "org-1",
    projectId: "aurora",
    parameterIds: ["shared-param-1"],
    protocol: "adb"
  });

  expect(calls[0].text).toContain("(project_id is null or project_id = $2)");
  expect(bindings).toEqual([
    expect.objectContaining({
      projectId: null,
      parameterId: "shared-param-1",
      protocol: "adb",
      isSmokeDefault: true
    })
  ]);
});

it("returns the enabled default ADB smoke binding for an organization", async () => {
  const { db, calls } = createFakeDb([
    [
      {
        id: "binding-shared-adb",
        organization_id: "org-1",
        project_id: null,
        parameter_id: "shared-param-1",
        protocol: "adb",
        node_path: "/sys/adb/smoke",
        access_mode: "RO",
        enabled: true,
        is_smoke_default: true,
        notes: "Default ADB smoke binding.",
        created_at: timestamp,
        updated_at: timestamp
      }
    ]
  ]);

  const binding = await getDefaultAdbSmokeParameterNodeBinding(db, { organizationId: "org-1" });

  expect(calls[0].text).toContain("is_smoke_default = true");
  expect(calls[0].text).toContain("protocol = 'adb'");
  expect(calls[0].text).toContain("project_id is null");
  expect(binding).toMatchObject({
    projectId: null,
    parameterId: "shared-param-1",
    protocol: "adb",
    accessMode: "RO",
    enabled: true,
    isSmokeDefault: true
  });
});
```

- [ ] **Step 2: Run repository tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/repository.test.ts
```

Expected: FAIL because `projectId` types are still `string`, queries do not include `project_id is null`, and `getDefaultAdbSmokeParameterNodeBinding` is not exported.

- [ ] **Step 3: Update backend debugging types**

In `server/modules/debugging/types.ts`, change the catalog record types:

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
};

export type DebugParameterNodeBindingRecord = {
  id: string;
  organizationId: string;
  projectId: string | null;
  parameterId: string;
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugAccessMode;
  enabled: boolean;
  isSmokeDefault: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 4: Update repository row mapping**

In `server/modules/debugging/repository.ts`, update row types and mappers:

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
};

type DebugParameterNodeBindingRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  parameter_id: string;
  protocol: DebugConnectionProtocol;
  node_path: string;
  access_mode: DebugAccessMode;
  enabled: boolean;
  is_smoke_default: boolean;
  notes: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function toDebugParameterNodeBindingRecord(row: DebugParameterNodeBindingRow): DebugParameterNodeBindingRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    parameterId: row.parameter_id,
    protocol: row.protocol,
    nodePath: row.node_path,
    accessMode: row.access_mode,
    enabled: row.enabled,
    isSmokeDefault: row.is_smoke_default,
    notes: row.notes,
    createdAt: dateTimeToIso(row.created_at) ?? "",
    updatedAt: dateTimeToIso(row.updated_at) ?? ""
  };
}
```

- [ ] **Step 5: Update binding columns**

In `server/modules/debugging/repository.ts`, add a shared column constant:

```ts
const debugParameterNodeBindingColumns = `
  id,
  organization_id,
  project_id,
  parameter_id,
  protocol,
  node_path,
  access_mode,
  enabled,
  is_smoke_default,
  notes,
  created_at,
  updated_at
`;
```

Replace binding `select id, organization_id, ...` fragments with `select ${debugParameterNodeBindingColumns}`.

- [ ] **Step 6: Update catalog filter helpers**

Add this helper near `addCondition`:

```ts
function addNullableProjectCondition(parts: string[], values: unknown[], projectId?: string, projectIds?: string[]) {
  if (projectId) {
    addCondition(parts, values, (placeholder) => `(project_id is null or project_id = ${placeholder})`, projectId);
  } else if (projectIds?.length) {
    addCondition(parts, values, (placeholder) => `(project_id is null or project_id = any(${placeholder}::text[]))`, projectIds);
  }
}
```

Use it in `listDebugParameters` and `listDebugParameterNodeBindings`. Keep `listDebugDevices` project-scoped and unchanged.

- [ ] **Step 7: Add default binding repository helper**

Export this function from `server/modules/debugging/repository.ts`:

```ts
export async function getDefaultAdbSmokeParameterNodeBinding(
  db: Queryable,
  input: { organizationId: string; includeDisabled?: boolean }
): Promise<DebugParameterNodeBindingRecord | null> {
  const result = await db.query<DebugParameterNodeBindingRow>(
    `
    select ${debugParameterNodeBindingColumns}
    from debugging_parameter_node_bindings
    where organization_id = $1
      and project_id is null
      and protocol = 'adb'
      and is_smoke_default = true
      ${input.includeDisabled ? "" : "and enabled = true"}
    order by id asc
    limit 1
    `,
    [input.organizationId]
  );

  return result.rows[0] ? toDebugParameterNodeBindingRecord(result.rows[0]) : null;
}
```

- [ ] **Step 8: Run repository tests and type check through the server suite**

Run:

```bash
npm run test:server -- server/modules/debugging/repository.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add server/modules/debugging/types.ts server/modules/debugging/repository.ts server/modules/debugging/repository.test.ts
git commit -m "feat: read shared debugging catalog"
```

Expected: commit succeeds.

## Task 3: Service And Route Semantics For Shared Debug Parameters

**Files:**
- Modify: `server/modules/debugging/service.ts`
- Modify: `server/modules/debugging/service.test.ts`
- Modify: `server/modules/debugging/routes.test.ts`

- [ ] **Step 1: Write service tests for shared catalog listing**

Add or replace tests in `server/modules/debugging/service.test.ts`:

```ts
it("lists shared debugging parameters for any authorized project context", async () => {
  const { db, calls } = createFakeDb([[parameterRow({ project_id: null })]]);
  const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

  await expect(service.listParameters(readAuth, { projectId: "aurora" })).resolves.toEqual([
    expect.objectContaining({ id: "param-1", projectId: null })
  ]);

  expect(calls[0].text).toContain("(project_id is null or project_id = $2)");
  expect(calls[0].values).toEqual(["org-1", "aurora"]);
});

it("lists selected-protocol shared parameter bindings without filtering them out by project", async () => {
  const { db, calls } = createFakeDb([
    [parameterRow({ project_id: null })],
    [bindingRow({ project_id: null, protocol: "adb", node_path: "/sys/adb/current", is_smoke_default: true })]
  ]);
  const service = createDebuggingService({ db, gateway: makeGateway(), createAuditEvent: createAuditSpy().createAuditEvent });

  await expect(service.listParameters(readAuth, { projectId: "aurora", protocol: "adb" })).resolves.toEqual([
    expect.objectContaining({
      id: "param-1",
      projectId: null,
      selectedBinding: expect.objectContaining({
        projectId: null,
        protocol: "adb",
        nodePath: "/sys/adb/current",
        isSmokeDefault: true
      })
    })
  ]);

  expect(calls[1].text).toContain("(project_id is null or project_id = $2)");
  expect(calls[1].values).toEqual(["org-1", "aurora", ["param-1"]]);
});
```

- [ ] **Step 2: Write service tests for shared parameter read/write**

Add these tests:

```ts
it("reads a shared parameter through the project-scoped session protocol binding", async () => {
  const adbGateway = makeGateway();
  const { db } = createFakeDb([
    [sessionRow({ project_id: "aurora", protocol: "adb" })],
    [parameterRow({ project_id: null })],
    [bindingRow({ project_id: null, protocol: "adb", node_path: "/sys/adb/current", access_mode: "RO" })],
    [targetRow({ project_id: "aurora", protocol: "adb", target_ref: "emulator-5554" })],
    (call) => [operationRow(call, { project_id: "aurora", protocol: "adb", node_path: "/sys/adb/current" })]
  ]);
  const service = createDebuggingService({
    db,
    gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: adbGateway }),
    createAuditEvent: createAuditSpy().createAuditEvent
  });

  await service.readNode(readAuth, { sessionId: "session-1", parameterId: "param-1" });

  expect(adbGateway.readNode).toHaveBeenCalledWith({ targetRef: "emulator-5554", nodePath: "/sys/adb/current" });
});

it("writes a shared writable parameter while operation and audit stay in the session project", async () => {
  const { db, txCalls } = createFakeDb([
    [sessionRow({ project_id: "aurora", protocol: "adb" })],
    [parameterRow({ project_id: null, risk: "Medium", min_value: "0", max_value: "5000" })],
    [bindingRow({ project_id: null, protocol: "adb", node_path: "/sys/adb/current", access_mode: "RW" })],
    [targetRow({ project_id: "aurora", protocol: "adb", target_ref: "emulator-5554" })],
    (call) => [snapshotRow({ id: call.values[0], project_id: call.values[2], risk: call.values[4] })],
    (call) => [operationRow(call, { project_id: "aurora", protocol: "adb", node_path: "/sys/adb/current" })],
    []
  ]);
  const audit = createAuditSpy();
  const service = createDebuggingService({
    db,
    gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: makeGateway() }),
    createAuditEvent: audit.createAuditEvent
  });

  await service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" });

  const operationInsert = txCalls.find((call) => call.text.includes("insert into node_operations"));
  expect(operationInsert?.values[2]).toBe("aurora");
  expect(audit.events.at(-1)).toMatchObject({
    projectId: "aurora",
    targetId: "param-1"
  });
});
```

- [ ] **Step 3: Replace cross-project catalog rejection tests**

Find the test named `writeNode rejects parameters from a different project before gateway call`. Replace it with:

```ts
it("still rejects legacy project-scoped parameters from a different project before gateway call", async () => {
  const { db } = createFakeDb([[sessionRow({ project_id: "aurora" })], [parameterRow({ project_id: "other-project" })], [bindingRow()]]);
  const gateway = makeGateway();
  const service = createDebuggingService({ db, gateway, createAuditEvent: createAuditSpy().createAuditEvent });

  await expect(service.writeNode(writeAuth, { sessionId: "session-1", parameterId: "param-1", value: "3200" })).rejects.toMatchObject(
    new ApiError("VALIDATION_FAILED", "Legacy project-scoped parameter does not belong to the session project.", 400)
  );
  expect(gateway.writeNode).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run service tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/service.test.ts
```

Expected: FAIL because `ensureReadable` and `ensureWritable` still require `parameter.projectId === session.projectId`.

- [ ] **Step 5: Update service catalog-scope validation**

In `server/modules/debugging/service.ts`, replace `ensureReadable` and `ensureWritable` project checks with this helper:

```ts
function ensureParameterAllowedForSession(parameter: DebugParameterRecord, session: DebugSessionRecord) {
  if (parameter.projectId !== null && parameter.projectId !== session.projectId) {
    throw new ApiError("VALIDATION_FAILED", "Legacy project-scoped parameter does not belong to the session project.", 400, {
      projectId: session.projectId
    });
  }
}
```

Then update `ensureReadable`:

```ts
function ensureReadable(parameter: DebugParameterRecord | null, session: DebugSessionRecord, accessMode: DebugAccessMode) {
  if (!parameter) {
    throw new ApiError("NOT_FOUND", "Debug parameter was not found.", 404);
  }
  ensureParameterAllowedForSession(parameter, session);
  if (accessMode !== "RO" && accessMode !== "RW") {
    throw new ApiError("VALIDATION_FAILED", "Parameter is not readable.", 400);
  }
}
```

Update `ensureWritable` in the same way before range validation:

```ts
if (!parameter) {
  throw new ApiError("NOT_FOUND", "Debug parameter was not found.", 404);
}
ensureParameterAllowedForSession(parameter, session);
if (accessMode !== "WO" && accessMode !== "RW") {
  throw new ApiError("VALIDATION_FAILED", "Parameter is read-only.", 400);
}
```

- [ ] **Step 6: Update binding list service call**

In `listParameters`, keep the project context for legacy rows but allow shared bindings:

```ts
const bindings = await listDebugParameterNodeBindings(db, {
  organizationId,
  projectId: scopedQuery.projectId,
  parameterIds: parameters.map((parameter) => parameter.id),
  protocol: query.protocol
});
```

This explicit `protocol` preserves the selected binding behavior and keeps the query smaller.

- [ ] **Step 7: Update route tests for nullable catalog fields**

In `server/modules/debugging/routes.test.ts`, update parameter fixtures that assert a concrete catalog `projectId` to accept `projectId: null` where the test represents shared catalog rows:

```ts
const parameter = parameterRecord({
  projectId: null,
  selectedBinding: {
    id: "binding-param-1-adb",
    organizationId: "org-1",
    projectId: null,
    parameterId: "param-1",
    protocol: "adb" as const,
    nodePath: "/sys/adb/current",
    accessMode: "RW",
    enabled: true,
    isSmokeDefault: true,
    notes: null,
    createdAt: timestamp,
    updatedAt: timestamp
  }
});
```

- [ ] **Step 8: Run service and route tests**

Run:

```bash
npm run test:server -- server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add server/modules/debugging/service.ts server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts
git commit -m "feat: allow shared debug parameters in sessions"
```

Expected: commit succeeds.

## Task 4: Frontend DTO And Runtime Tolerance For Shared Debug Parameters

**Files:**
- Modify: `src/domain/debugging/types.ts`
- Modify: `src/infrastructure/http/debuggingDtos.ts`
- Modify: `src/infrastructure/http/debuggingDtos.test.ts`
- Modify: `src/application/ports/DebuggingGateway.ts`
- Modify: `src/application/debugging/debuggingRuntime.ts`
- Modify: `src/application/debugging/debuggingRuntime.test.ts`

- [ ] **Step 1: Write DTO tests for shared rows**

Add to `src/infrastructure/http/debuggingDtos.test.ts`:

```ts
it("maps shared debugging parameters without a project id", () => {
  const parameter = debugParameterFromDto({
    id: "shared-param-1",
    projectId: null,
    name: "ADB smoke readable",
    key: "adb_smoke_readable",
    description: "Shared smoke parameter.",
    module: "Diagnostics",
    nodePath: "/sys/adb/smoke",
    accessMode: "RO",
    unit: "",
    range: "",
    risk: "Low",
    currentValue: "",
    targetValue: "",
    selectedBinding: {
      protocol: "adb",
      nodePath: "/sys/adb/smoke",
      accessMode: "RO",
      enabled: true,
      isSmokeDefault: true,
      notes: "Default ADB smoke binding."
    },
    bindings: [
      {
        protocol: "adb",
        nodePath: "/sys/adb/smoke",
        accessMode: "RO",
        enabled: true,
        isSmokeDefault: true,
        notes: "Default ADB smoke binding."
      }
    ]
  });

  expect(parameter.projectId).toBeNull();
  expect(parameter.bindingStatus).toBe("configured");
  expect(parameter.bindings?.[0]).toMatchObject({
    protocol: "adb",
    isSmokeDefault: true
  });
});
```

- [ ] **Step 2: Write runtime refresh test**

Add to `src/application/debugging/debuggingRuntime.test.ts`:

```ts
it("refreshes shared debug parameters using project only as operation context", async () => {
  const gateway = {
    listDevices: vi.fn(async () => []),
    listParameters: vi.fn(async () => [
      {
        id: "shared-param-1",
        projectId: null,
        name: "ADB smoke readable",
        key: "adb_smoke_readable",
        description: "Shared smoke parameter.",
        module: "Diagnostics",
        currentValue: "",
        targetValue: "",
        unit: "",
        range: "",
        risk: "Low",
        status: "已同步",
        nodePath: "/sys/adb/smoke",
        accessMode: "RO",
        selectedProtocol: "adb",
        bindingStatus: "configured"
      }
    ]),
    detectTargets: vi.fn(),
    readNode: vi.fn(),
    writeNode: vi.fn()
  } satisfies DebuggingGateway;
  const dispatch = vi.fn();
  const actions = createDebuggingRuntimeActions({
    mode: "api",
    gateway,
    dispatch,
    getState: () => ({ ...mockState, activeProjectId: "aurora" })
  });

  await actions.refresh({ projectId: "aurora", protocol: "adb" });

  expect(gateway.listParameters).toHaveBeenCalledWith({ projectId: "aurora", protocol: "adb" });
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
    type: "HYDRATE_DEBUG_RUNTIME",
    debugParameters: [expect.objectContaining({ projectId: null, selectedProtocol: "adb" })]
  }));
});
```

- [ ] **Step 3: Run frontend tests and verify failure**

Run:

```bash
npm test -- src/infrastructure/http/debuggingDtos.test.ts src/application/debugging/debuggingRuntime.test.ts
```

Expected: FAIL because frontend debug parameter types require `projectId: string` and bindings do not map `isSmokeDefault`.

- [ ] **Step 4: Update frontend domain types**

In `src/domain/debugging/types.ts`, add nullable project metadata and default marker:

```ts
export type DebugParameterNodeBinding = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  isSmokeDefault?: boolean;
  notes?: string;
};

export type DebugParameter = {
  id: string;
  projectId?: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  currentValue: string;
  targetValue: string;
  unit: string;
  range: string;
  risk: RiskLevel;
  status: "已同步" | "待下发" | "下发成功";
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  selectedProtocol?: DebugConnectionProtocol;
  bindingStatus?: DebugParameterBindingStatus;
  bindingDisabledReason?: string;
  bindings?: DebugParameterNodeBinding[];
};
```

- [ ] **Step 5: Update DTO types and mapping**

In `src/infrastructure/http/debuggingDtos.ts`, update:

```ts
export type DebugParameterNodeBindingDto = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  isSmokeDefault?: boolean;
  notes?: string | null;
  disabledReason?: string | null;
};

export type DebugParameterDto = {
  id: string;
  projectId: string | null;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath?: string;
  accessMode?: "RO" | "WO" | "RW";
  unit: string;
  range: string;
  risk: "Low" | "Medium" | "High";
  currentValue: string;
  targetValue: string;
  selectedBinding?: DebugParameterNodeBindingDto | null;
  bindings?: DebugParameterNodeBindingDto[];
};
```

Then include `projectId` and `isSmokeDefault` in mappers:

```ts
return {
  id: dto.id,
  projectId: dto.projectId,
  name: dto.name,
  key: dto.key,
  ...
};
```

```ts
function debugParameterBindingFromDto(dto: DebugParameterNodeBindingDto): DebugParameterNodeBinding {
  return {
    protocol: dto.protocol,
    nodePath: dto.nodePath,
    accessMode: dto.accessMode,
    enabled: dto.enabled,
    isSmokeDefault: dto.isSmokeDefault,
    notes: dto.notes ?? undefined
  };
}
```

- [ ] **Step 6: Update port/runtime compile points**

If TypeScript compile errors appear in `src/application/ports/DebuggingGateway.ts` or runtime tests, make the snapshot parameter type use the domain `DebugParameter` directly and avoid assuming a non-null catalog project id.

- [ ] **Step 7: Run frontend tests**

Run:

```bash
npm test -- src/infrastructure/http/debuggingDtos.test.ts src/application/debugging/debuggingRuntime.test.ts src/infrastructure/http/debuggingClient.test.ts src/NodeDebuggingPage.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/domain/debugging/types.ts src/infrastructure/http/debuggingDtos.ts src/infrastructure/http/debuggingDtos.test.ts src/application/ports/DebuggingGateway.ts src/application/debugging/debuggingRuntime.ts src/application/debugging/debuggingRuntime.test.ts
git commit -m "feat: accept shared debug parameters in frontend"
```

Expected: commit succeeds.

## Task 5: ADB Lab Auto-Configuration Resolver

**Files:**
- Modify: `e2e/acceptance/adb-device-lab.acceptance.spec.ts`

- [ ] **Step 1: Write resolver unit tests in the acceptance spec**

Add these tests under `test.describe("ADB device-lab preflight validation", () => { ... })`:

```ts
test("discovers the only ready ADB target without requiring a target override", () => {
  const targetRef = discoverSingleReadyAdbTarget([
    { serial: "adb-target-1", state: "device" },
    { serial: "adb-target-2", state: "offline" }
  ]);

  expect(targetRef).toBe("adb-target-1");
});

test("rejects multiple ready ADB targets before configuration", () => {
  expect(() =>
    discoverSingleReadyAdbTarget([
      { serial: "adb-target-1", state: "device" },
      { serial: "adb-target-2", state: "device" }
    ])
  ).toThrow(/exactly one ready ADB device.*serial=set:length=12:device/s);
});

test("validates optional smoke overrides against discovered configuration", () => {
  expect(() =>
    validateAdbSmokeOverrides(
      {
        projectId: "aurora",
        deviceId: "device-1",
        targetRef: "target-1",
        parameterId: "param-1",
        nodePath: "/safe/node"
      },
      {
        ADB_SMOKE_TARGET_REF: "other-target"
      }
    )
  ).toThrow(/ADB_SMOKE_TARGET_REF.*discovered=set:length=8.*override=set:length=12/s);
});

test("resolves write confirmation requirements after auto configuration", () => {
  expect(() =>
    finalizeAdbSmokeConfig(
      {
        projectId: "aurora",
        deviceId: "device-1",
        targetRef: "target-1",
        parameterId: "param-1",
        nodePath: "/safe/node"
      },
      {
        ADB_SMOKE_ENABLE_WRITE: "true",
        ADB_SMOKE_WRITE_VALUE: "new-value"
      }
    )
  ).toThrow(/ADB_SMOKE_CONFIRM_WRITE.*ADB_SMOKE_CONFIRM_ROLLBACK/s);
});
```

- [ ] **Step 2: Write DB resolver tests with fake query client**

Add a helper fake client type in the spec and these tests:

```ts
test("resolves one ADB inventory row and one shared default smoke binding from the database", async () => {
  const client = createAdbSmokeConfigClient([
    [{ id: "device-1", transport: "adb", status: "online" }],
    [
      {
        parameter_id: "param-1",
        node_path: "/safe/node",
        access_mode: "RO",
        enabled: true,
        is_smoke_default: true,
        binding_project_id: null,
        parameter_project_id: null
      }
    ]
  ]);

  await expect(resolveAdbSmokeCatalogConfig(client, { projectId: "aurora", targetRef: "target-1" })).resolves.toMatchObject({
    projectId: "aurora",
    deviceId: "device-1",
    targetRef: "target-1",
    parameterId: "param-1",
    nodePath: "/safe/node"
  });
});

test("rejects missing ADB inventory rows with redacted diagnostics", async () => {
  const client = createAdbSmokeConfigClient([[], []]);

  await expect(resolveAdbSmokeCatalogConfig(client, { projectId: "aurora", targetRef: "target-1" })).rejects.toThrow(
    /exactly one ADB debugging device inventory row.*count=0/
  );
});

test("rejects non-readable default smoke bindings", async () => {
  const client = createAdbSmokeConfigClient([
    [{ id: "device-1", transport: "adb", status: "online" }],
    [
      {
        parameter_id: "param-1",
        node_path: "/safe/node",
        access_mode: "WO",
        enabled: true,
        is_smoke_default: true,
        binding_project_id: null,
        parameter_project_id: null
      }
    ]
  ]);

  await expect(resolveAdbSmokeCatalogConfig(client, { projectId: "aurora", targetRef: "target-1" })).rejects.toThrow(
    /default ADB smoke binding must be readable.*accessMode=WO/
  );
});
```

- [ ] **Step 3: Run the acceptance spec unit tests and verify failure**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts --grep "ADB device-lab preflight validation"
```

Expected: FAIL because resolver helpers are not implemented.

- [ ] **Step 4: Implement target discovery helpers**

Replace `validateSingleReadyAdbTarget`/`requireSingleReadyAdbTarget` with these helpers:

```ts
function discoverSingleReadyAdbTarget(devices: ParsedAdbDevice[]) {
  const observed = observedAdbDevices(devices);
  const readyDevices = devices.filter((item) => item.state === "device");
  if (readyDevices.length !== 1) {
    throw new Error(`ADB device-lab acceptance requires exactly one ready ADB device. Observed: ${observed}`);
  }
  return readyDevices[0].serial;
}

function requireSingleReadyAdbTarget() {
  const available = adbCommandAvailable();
  if (!available.ok) {
    throw new Error(
      [
        "ADB device-lab acceptance requires adb on PATH.",
        available.stderr || available.stdout,
        available.error ? available.error.message : ""
      ].filter(Boolean).join("\n")
    );
  }

  const result = spawnSync("adb", ["devices"], { encoding: "utf8", env: process.env });
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (result.status !== 0) {
    throw new Error(`adb devices failed with exit code ${result.status ?? "unknown"}: ${stderr || stdout.trim()}`);
  }

  return discoverSingleReadyAdbTarget(parseAdbDevices(stdout));
}
```

- [ ] **Step 5: Implement smoke env helpers**

Add:

```ts
type MinimalAdbSmokeConfig = Pick<AdbSmokeConfig, "projectId" | "deviceId" | "targetRef" | "parameterId" | "nodePath">;
type AdbSmokeEnv = Partial<Record<"ADB_SMOKE_DEVICE_ID" | "ADB_SMOKE_TARGET_REF" | "ADB_SMOKE_PARAMETER_ID" | "ADB_SMOKE_NODE_PATH" | "ADB_SMOKE_ENABLE_WRITE" | "ADB_SMOKE_WRITE_VALUE" | "ADB_SMOKE_CONFIRM_WRITE" | "ADB_SMOKE_CONFIRM_ROLLBACK" | "ADB_SMOKE_EXPECT_READ_PATTERN" | "ADB_SMOKE_USER_ID", string>>;

function requireAdbSmokeProjectId(env: NodeJS.ProcessEnv = process.env) {
  const projectId = env.ADB_SMOKE_PROJECT_ID?.trim();
  if (!projectId) {
    throw new Error("ADB device-lab acceptance requires ADB_SMOKE_PROJECT_ID as the operation project context.");
  }
  return projectId;
}

function validateOverride(name: keyof AdbSmokeEnv, discovered: string, override: string | undefined) {
  const trimmed = override?.trim();
  if (trimmed && trimmed !== discovered) {
    throw new Error(`${name} does not match auto-discovered ADB smoke config: discovered=${identifierShape(discovered)} override=${identifierShape(trimmed)}.`);
  }
}

function validateAdbSmokeOverrides(config: MinimalAdbSmokeConfig, env: AdbSmokeEnv = process.env) {
  validateOverride("ADB_SMOKE_DEVICE_ID", config.deviceId, env.ADB_SMOKE_DEVICE_ID);
  validateOverride("ADB_SMOKE_TARGET_REF", config.targetRef, env.ADB_SMOKE_TARGET_REF);
  validateOverride("ADB_SMOKE_PARAMETER_ID", config.parameterId, env.ADB_SMOKE_PARAMETER_ID);
  validateOverride("ADB_SMOKE_NODE_PATH", config.nodePath, env.ADB_SMOKE_NODE_PATH);
}

function finalizeAdbSmokeConfig(config: MinimalAdbSmokeConfig, env: AdbSmokeEnv = process.env): AdbSmokeConfig {
  validateAdbSmokeOverrides(config, env);
  const writeEnabled = env.ADB_SMOKE_ENABLE_WRITE === "true";
  const missingWriteInputs = [
    ["ADB_SMOKE_WRITE_VALUE", env.ADB_SMOKE_WRITE_VALUE],
    ["ADB_SMOKE_CONFIRM_WRITE", env.ADB_SMOKE_CONFIRM_WRITE],
    ["ADB_SMOKE_CONFIRM_ROLLBACK", env.ADB_SMOKE_CONFIRM_ROLLBACK]
  ]
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (writeEnabled && missingWriteInputs.length > 0) {
    throw new Error(`${missingWriteInputs.join(", ")} required when ADB_SMOKE_ENABLE_WRITE=true.`);
  }

  return {
    ...config,
    readValuePattern: env.ADB_SMOKE_EXPECT_READ_PATTERN?.trim() ? new RegExp(env.ADB_SMOKE_EXPECT_READ_PATTERN.trim()) : undefined,
    userId: env.ADB_SMOKE_USER_ID?.trim() || "u-xu-yun",
    writeEnabled,
    writeValue: env.ADB_SMOKE_WRITE_VALUE?.trim(),
    confirmWrite: env.ADB_SMOKE_CONFIRM_WRITE?.trim() ?? "",
    confirmRollback: env.ADB_SMOKE_CONFIRM_ROLLBACK?.trim() ?? ""
  };
}
```

- [ ] **Step 6: Implement DB catalog resolver**

Add:

```ts
const acceptanceOrganizationId = "org-chargelab";

type AdbSmokeQueryClient = Pick<Client, "query">;

type AdbSmokeDeviceRow = {
  id: string;
  transport: string;
  status: string;
};

type AdbSmokeBindingRow = {
  parameter_id: string;
  node_path: string;
  access_mode: string;
  enabled: boolean;
  is_smoke_default: boolean;
  binding_project_id: string | null;
  parameter_project_id: string | null;
};

function candidateShapes(rows: Array<{ id?: string; parameter_id?: string; status?: string; access_mode?: string; enabled?: boolean }>) {
  return rows
    .map((row) => {
      const id = row.id ?? row.parameter_id;
      return [
        `id=${identifierShape(id)}`,
        row.status ? `status=${row.status}` : null,
        row.access_mode ? `accessMode=${row.access_mode}` : null,
        typeof row.enabled === "boolean" ? `enabled=${row.enabled}` : null
      ].filter(Boolean).join(":");
    })
    .join(", ") || "(none)";
}

async function resolveAdbSmokeCatalogConfig(
  client: AdbSmokeQueryClient,
  input: { projectId: string; targetRef: string }
): Promise<MinimalAdbSmokeConfig> {
  const devices = await client.query<AdbSmokeDeviceRow>(
    `
    select id, transport, status
    from debugging_devices
    where organization_id = $1
      and transport = 'adb'
    order by id asc
    `,
    [acceptanceOrganizationId]
  );
  if (devices.rows.length !== 1) {
    throw new Error(
      `ADB device-lab acceptance requires exactly one ADB debugging device inventory row; count=${devices.rows.length}; candidates=${candidateShapes(devices.rows)}.`
    );
  }

  const bindings = await client.query<AdbSmokeBindingRow>(
    `
    select
      bindings.parameter_id,
      bindings.node_path,
      bindings.access_mode,
      bindings.enabled,
      bindings.is_smoke_default,
      bindings.project_id as binding_project_id,
      parameters.project_id as parameter_project_id
    from debugging_parameter_node_bindings bindings
    join debugging_parameters parameters
      on parameters.organization_id = bindings.organization_id
      and parameters.id = bindings.parameter_id
    where bindings.organization_id = $1
      and bindings.protocol = 'adb'
      and bindings.is_smoke_default = true
    order by bindings.id asc
    `,
    [acceptanceOrganizationId]
  );
  if (bindings.rows.length !== 1) {
    throw new Error(
      `ADB device-lab acceptance requires exactly one default ADB smoke binding; count=${bindings.rows.length}; candidates=${candidateShapes(bindings.rows)}.`
    );
  }

  const binding = bindings.rows[0];
  if (binding.binding_project_id !== null || binding.parameter_project_id !== null) {
    throw new Error("Default ADB smoke binding must be shared; bindingProject=present or parameterProject=present.");
  }
  if (!binding.enabled) {
    throw new Error("Default ADB smoke binding must be enabled; enabled=false.");
  }
  if (binding.access_mode !== "RO" && binding.access_mode !== "RW") {
    throw new Error(`Default ADB smoke binding must be readable; accessMode=${binding.access_mode}.`);
  }

  return {
    projectId: input.projectId,
    deviceId: devices.rows[0].id,
    targetRef: input.targetRef,
    parameterId: binding.parameter_id,
    nodePath: binding.node_path
  };
}

function createAdbSmokeConfigClient(results: unknown[][]): AdbSmokeQueryClient {
  return {
    query: async () => {
      const rows = results.shift() ?? [];
      return { rows, rowCount: rows.length } as Awaited<ReturnType<Client["query"]>>;
    }
  };
}
```

- [ ] **Step 7: Replace manual config function with async resolver**

Replace `requireAdbSmokeConfig` with:

```ts
async function resolveAdbSmokeConfig(input: { projectId: string; targetRef: string }): Promise<AdbSmokeConfig> {
  return withPgClient(async (client) => {
    const config = await resolveAdbSmokeCatalogConfig(client, input);
    return finalizeAdbSmokeConfig(config);
  });
}
```

- [ ] **Step 8: Update hardware test setup order**

In the full-chain test, replace:

```ts
const config = requireAdbSmokeConfig();
requireSingleReadyAdbTarget(config.targetRef);
await prepareAdbAcceptanceState(config.projectId);
```

with:

```ts
const projectId = requireAdbSmokeProjectId();
const targetRef = requireSingleReadyAdbTarget();
await prepareAdbAcceptanceState(projectId);
const config = await resolveAdbSmokeConfig({ projectId, targetRef });
```

- [ ] **Step 9: Update evidence and reproduction text**

In the runtime evidence summary, replace manual env assumptions with auto-config summary:

```ts
envSummary: {
  DEBUG_DEVICE_GATEWAY_MODE: process.env.DEBUG_DEVICE_GATEWAY_MODE?.trim() || "unset",
  ADB_DEVICE_LAB_AVAILABLE: process.env.ADB_DEVICE_LAB_AVAILABLE?.trim() || "unset",
  ADB_SMOKE_ENABLE_WRITE: config.writeEnabled ? "true" : "false",
  ADB_SMOKE_WRITE_VALUE: config.writeValue ? "set" : "unset",
  ADB_SMOKE_PROJECT_ID: identifierShape(config.projectId),
  ADB_SMOKE_DEVICE_ID: process.env.ADB_SMOKE_DEVICE_ID?.trim() ? "override-validated" : "auto",
  ADB_SMOKE_TARGET_REF: process.env.ADB_SMOKE_TARGET_REF?.trim() ? "override-validated" : "auto",
  ADB_SMOKE_PARAMETER_ID: process.env.ADB_SMOKE_PARAMETER_ID?.trim() ? "override-validated" : "auto",
  ADB_SMOKE_NODE_PATH: process.env.ADB_SMOKE_NODE_PATH?.trim() ? "override-validated" : "auto",
  ADB_SMOKE_AUTO_CONFIG: "true"
}
```

Replace reproduction step 2:

```ts
"Set ADB_SMOKE_PROJECT_ID as the operation project context; device, target, parameter, and node path are auto-discovered from one ready ADB device and the shared default ADB smoke binding.",
```

- [ ] **Step 10: Run ADB acceptance preflight tests**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts --grep "ADB device-lab preflight validation|ADB device-lab evidence redaction"
```

Expected: PASS without requiring `ADB_DEVICE_LAB_AVAILABLE=true`.

- [ ] **Step 11: Commit**

Run:

```bash
git add e2e/acceptance/adb-device-lab.acceptance.spec.ts
git commit -m "test: auto configure adb device lab"
```

Expected: commit succeeds.

## Task 6: Documentation And Coverage Updates

**Files:**
- Modify: `docs/runbooks/adb-device-lab.md`
- Modify: `docs/zh-CN/runbooks/adb-device-lab.md`
- Modify: `docs/developer/environment-variables.md`
- Modify: `docs/zh-CN/developer/environment-variables.md`
- Modify: `docs/design-docs/domain-model.md`
- Modify: `docs/zh-CN/design-docs/domain-model.md`
- Modify: `docs/design-docs/api-contract.md`
- Modify: `docs/zh-CN/design-docs/api-contract.md`
- Review: `docs/developer/browser-acceptance-coverage-map.md`
- Review: `docs/developer/user-operation-coverage-matrix.md`
- Review: `docs/zh-CN/developer/browser-acceptance-coverage-map.md`
- Review: `docs/zh-CN/developer/user-operation-coverage-matrix.md`
- Review: `e2e/acceptance/operationMatrix.ts`

- [ ] **Step 1: Update English ADB runbook**

In `docs/runbooks/adb-device-lab.md`, replace the manual configuration section with:

````md
## Minimal Read-Only Environment

The read-only ADB lab auto-configures when one ready ADB device is connected and the WiseEff database already contains one ADB device inventory row plus one shared default ADB smoke binding.

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
ADB_SMOKE_PROJECT_ID=aurora \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

`ADB_SMOKE_PROJECT_ID` is the operation context for permissions, session records, node operations, audit, and evidence. It is not a filter for the debugging parameter catalog.

The lab discovers:

- `targetRef` from `adb devices`, requiring exactly one ready device with state `device`.
- `deviceId` from exactly one WiseEff `debugging_devices` row with `transport = 'adb'`.
- `parameterId` and server-side `nodePath` from exactly one shared enabled ADB binding with `is_smoke_default = true`.

Optional validation overrides:

- `ADB_SMOKE_DEVICE_ID`
- `ADB_SMOKE_TARGET_REF`
- `ADB_SMOKE_PARAMETER_ID`
- `ADB_SMOKE_NODE_PATH`

When set, overrides must match the discovered values. The lab fails before reading hardware if any override differs.
````

- [ ] **Step 2: Update Chinese ADB runbook**

In `docs/zh-CN/runbooks/adb-device-lab.md`, add the matching Chinese section:

````md
## 最小只读环境

当本机只连接了一个 ready ADB 设备，并且 WiseEff 数据库中已经存在一个 `transport = 'adb'` 的设备 inventory 行和一个共享默认 ADB smoke binding 时，只读 ADB lab 会自动配置。

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
ADB_SMOKE_PROJECT_ID=aurora \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

`ADB_SMOKE_PROJECT_ID` 是权限、session、node operation、audit 和 evidence 的运行上下文，不再作为调试参数 catalog 的过滤条件。

Lab 自动发现：

- 从 `adb devices` 发现 `targetRef`，并要求恰好一个状态为 `device` 的 ready 设备。
- 从 WiseEff `debugging_devices` 中发现唯一 `transport = 'adb'` 的 `deviceId`。
- 从共享、enabled、`is_smoke_default = true` 的 ADB binding 中发现 `parameterId`，由后端解析 `nodePath`。

可选校验 override：

- `ADB_SMOKE_DEVICE_ID`
- `ADB_SMOKE_TARGET_REF`
- `ADB_SMOKE_PARAMETER_ID`
- `ADB_SMOKE_NODE_PATH`

如果设置了 override，它必须和自动发现结果一致；不一致时 lab 会在读取硬件前失败。
````

- [ ] **Step 3: Update environment-variable docs**

In `docs/developer/environment-variables.md` and `docs/zh-CN/developer/environment-variables.md`, update `ADB_SMOKE_*` entries so:

```md
| `ADB_SMOKE_PROJECT_ID` | none | ADB device-lab | Required when `DEBUG_DEVICE_GATEWAY_MODE=adb` and `ADB_DEVICE_LAB_AVAILABLE=true`; operation context only. |
| `ADB_SMOKE_DEVICE_ID` | auto | ADB device-lab | Optional validation override for the discovered WiseEff ADB device inventory id. |
| `ADB_SMOKE_TARGET_REF` | auto | ADB device-lab | Optional validation override for the single ready `adb devices` serial. |
| `ADB_SMOKE_PARAMETER_ID` | auto | ADB device-lab | Optional validation override for the shared default ADB smoke parameter id. |
| `ADB_SMOKE_NODE_PATH` | auto | ADB device-lab | Optional validation override for the server-side binding node path. |
```

Keep write-mode variables explicit:

```md
| `ADB_SMOKE_ENABLE_WRITE` | `false` | ADB device-lab | Enables optional write/readback/rollback; never inferred from auto-configuration. |
| `ADB_SMOKE_WRITE_VALUE` | none | ADB device-lab | Required only when `ADB_SMOKE_ENABLE_WRITE=true`. |
| `ADB_SMOKE_CONFIRM_WRITE` | none | ADB device-lab | Required only when `ADB_SMOKE_ENABLE_WRITE=true`. |
| `ADB_SMOKE_CONFIRM_ROLLBACK` | none | ADB device-lab | Required only when `ADB_SMOKE_ENABLE_WRITE=true`. |
```

- [ ] **Step 4: Update domain model docs**

In `docs/design-docs/domain-model.md` and `docs/zh-CN/design-docs/domain-model.md`, add:

```md
Debugging parameters are an organization-level debugging catalog. `debugging_parameters.project_id` and `debugging_parameter_node_bindings.project_id` are nullable; `null` means shared across projects. Parameter management remains project-scoped through the M1 parameter-management tables.

Debugging runtime records are still project-contextual. Sessions, targets, leases, node operations, snapshots, events, and audit rows keep `project_id` so permissions, operation history, and evidence stay tied to the selected project context.
```

- [ ] **Step 5: Update API contract docs**

In `docs/design-docs/api-contract.md` and `docs/zh-CN/design-docs/api-contract.md`, add:

```md
`GET /api/v1/debugging/parameters?projectId=:projectId&protocol=adb` returns shared debugging catalog rows plus legacy rows owned by the requested project. The `projectId` query parameter authorizes and contextualizes the request; it is not the ownership boundary for shared debugging catalog rows.

Read/write node APIs resolve protocol-specific `nodePath` from `debugging_parameter_node_bindings` when `parameterId` is provided. The request does not need to send a raw node path for catalog parameters.
```

- [ ] **Step 6: Review coverage maps**

Run:

```bash
rg -n "ADB-LAB-001|adb-device-lab.acceptance.spec.ts" docs/developer/browser-acceptance-coverage-map.md docs/developer/user-operation-coverage-matrix.md docs/zh-CN/developer/browser-acceptance-coverage-map.md docs/zh-CN/developer/user-operation-coverage-matrix.md e2e/acceptance/operationMatrix.ts
```

Expected: each file either contains `ADB-LAB-001` or, for files that only list requirement ids, still references `e2e/acceptance/adb-device-lab.acceptance.spec.ts`. If a row still says manual device/target/parameter env is required, update the row to say auto-configured single-device/default-binding ADB lab.

- [ ] **Step 7: Run documentation governance check**

Run:

```bash
npm run docs:check
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add docs/runbooks/adb-device-lab.md docs/zh-CN/runbooks/adb-device-lab.md docs/developer/environment-variables.md docs/zh-CN/developer/environment-variables.md docs/design-docs/domain-model.md docs/zh-CN/design-docs/domain-model.md docs/design-docs/api-contract.md docs/zh-CN/design-docs/api-contract.md docs/developer/browser-acceptance-coverage-map.md docs/developer/user-operation-coverage-matrix.md docs/zh-CN/developer/browser-acceptance-coverage-map.md docs/zh-CN/developer/user-operation-coverage-matrix.md e2e/acceptance/operationMatrix.ts
git commit -m "docs: explain shared debug catalog adb auto config"
```

Expected: commit succeeds. It is acceptable if reviewed coverage files are unchanged and therefore absent from the commit.

## Task 7: Final Verification And Hardware Gate

**Files:**
- Review all files changed by Tasks 1-6.
- Do not stage `.playwright-cli/` or `work/`.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
npm run test:server -- server/modules/debugging/repository.test.ts server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
npm test -- src/infrastructure/http/debuggingDtos.test.ts src/infrastructure/http/debuggingClient.test.ts src/application/debugging/debuggingRuntime.test.ts src/NodeDebuggingPage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run ADB lab preflight tests without hardware gate**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts --grep "ADB device-lab preflight validation|ADB device-lab evidence redaction"
```

Expected: PASS.

- [ ] **Step 4: Run documentation and whitespace checks**

Run:

```bash
npm run docs:check
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Run hardware-gated read-only ADB acceptance when a device is connected**

Only run this step when:

- `adb devices` shows exactly one ready device with state `device`;
- the local database has exactly one `debugging_devices` row with `transport = 'adb'`;
- the local database has exactly one shared enabled readable ADB binding with `is_smoke_default = true`;
- the operator accepts reading the configured smoke node.

Run:

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
ADB_SMOKE_PROJECT_ID=aurora \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts --grep "detects and reads a real ADB target"
```

Expected: PASS. Evidence for `ADB-LAB-001` records auto configuration with shape summaries. Read-only mode does not call write, rollback, or final restoration read.

- [ ] **Step 7: Run optional write ADB acceptance only with explicit confirmations**

Only run this step after the operator confirms the smoke node is safe to write and rollback.

Run:

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
ADB_SMOKE_PROJECT_ID=aurora \
ADB_SMOKE_ENABLE_WRITE=true \
ADB_SMOKE_WRITE_VALUE=<approved-safe-value> \
ADB_SMOKE_CONFIRM_WRITE=confirm-high-risk-write \
ADB_SMOKE_CONFIRM_ROLLBACK=confirm-rollback \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts --grep "detects and reads a real ADB target"
```

Expected: PASS. Evidence shows write/readback/rollback/final-restore summaries without raw values or raw ids.

- [ ] **Step 8: Confirm git status**

Run:

```bash
git status --short
```

Expected: only intentional source/doc changes are present. `.playwright-cli/` and `work/` may remain untracked and must not be staged.

- [ ] **Step 9: Commit final verification notes if docs changed during verification**

If final verification changes evidence docs, run:

```bash
git add <changed-evidence-or-doc-files>
git commit -m "test: verify adb auto device lab"
```

Expected: commit succeeds. If no files changed, record the command outputs in the implementation summary instead of creating an empty commit.

## Documentation Impact Matrix

| Area | Status | Files | Required action |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md` | No map change expected; record unchanged if no new top-level module is added. |
| Planning docs | Update | `docs/exec-plans/active/2026-06-22-wiseeff-adb-auto-device-lab-config.md` | Keep this plan current during implementation. |
| Product specs | Review | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Update only if product-facing behavior beyond lab/config semantics changes. |
| Architecture/domain docs | Update | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md` | Document shared debugging catalog and project-contextual runtime records. |
| API docs/contracts | Update | `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md` | Document shared parameter listing and server-side binding resolution. |
| Quality/testing docs | Review | `docs/design-docs/testing-strategy.md`, `docs/zh-CN/design-docs/testing-strategy.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/zh-CN/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/zh-CN/developer/user-operation-coverage-matrix.md` | Update rows only where current text still describes manual ADB smoke configuration. |
| Reliability/runbooks | Update | `docs/runbooks/adb-device-lab.md`, `docs/zh-CN/runbooks/adb-device-lab.md` | Document minimal env, auto discovery, default binding requirements, and failure modes. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`, `docs/security/README.md` | Update only if implementation changes approval or device-write safety boundaries. |
| Frontend/design docs | Review | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Update only if UI behavior changes beyond accepting shared parameter DTOs. |
| Developer environment docs | Update | `docs/developer/environment-variables.md`, `docs/zh-CN/developer/environment-variables.md` | Change required/optional `ADB_SMOKE_*` documentation. |
| Generated artifacts | Update | `docs/generated/db-schema.md` | Manually align with migration `0018_shared_debugging_catalog_adb_smoke_default.sql`. |
| References | Review | `docs/references/productization-api-contract-draft.md`, `docs/references/node-postgres-llms.txt` | Update only if new durable reference guidance is needed. |
| Technical debt | Review | `docs/exec-plans/tech-debt-tracker.md` | Add a row only if implementation leaves a known unresolved follow-up. |

## Documentation Update Gate

- [ ] `docs/runbooks/adb-device-lab.md` and `docs/zh-CN/runbooks/adb-device-lab.md` describe the minimal read-only env and optional validation overrides.
- [ ] `docs/developer/environment-variables.md` and `docs/zh-CN/developer/environment-variables.md` mark only `ADB_SMOKE_PROJECT_ID` as required for read-only auto configuration.
- [ ] `docs/design-docs/domain-model.md` and `docs/zh-CN/design-docs/domain-model.md` state that debugging catalog rows are shared while runtime records remain project-contextual.
- [ ] `docs/design-docs/api-contract.md` and `docs/zh-CN/design-docs/api-contract.md` state that `projectId` authorizes/contextualizes parameter listing and is not the shared catalog ownership boundary.
- [ ] `docs/generated/db-schema.md` includes nullable debugging catalog `project_id`, `is_smoke_default`, and the new partial indexes/constraint.
- [ ] Coverage maps and `e2e/acceptance/operationMatrix.ts` were reviewed for `ADB-LAB-001`; any stale manual-env text was updated.
- [ ] `npm run docs:check` passed after all documentation changes.

## Self-Review Checklist

- [ ] Spec coverage: Tasks 1-4 cover shared debugging catalog, nullable project ids, default binding metadata, and service/API/frontend tolerance. Task 5 covers single-device auto configuration, optional override validation, failure diagnostics, and evidence redaction. Task 6 covers required docs. Task 7 covers verification and optional hardware gates.
- [ ] Red-flag scan: search this plan for unfinished-marker phrases from the writing-plans skill and remove any matches.
- [ ] Type consistency: `projectId` is `string | null` only for debugging catalog records and DTOs; runtime records keep `projectId: string`.
- [ ] Safety consistency: write mode still requires `ADB_SMOKE_ENABLE_WRITE=true`, `ADB_SMOKE_WRITE_VALUE`, `ADB_SMOKE_CONFIRM_WRITE`, and `ADB_SMOKE_CONFIRM_ROLLBACK`; read-only auto configuration never writes.
- [ ] Evidence consistency: target serials, node paths, values, operation ids, session ids, snapshot ids, audit ids, and request ids remain shape-summarized.
