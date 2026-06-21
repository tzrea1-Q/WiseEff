# WiseEff ADB/HDC Debugging Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class backend ADB support beside HDC, let `/node-debugging` switch protocols per session, and manage ADB/HDC node bindings separately for each debug parameter.

**Architecture:** The backend debugging module becomes protocol-routed: sessions, targets, operations, and snapshots carry a `protocol`, while a gateway registry selects simulator, HDC, or ADB adapters. Debug parameters remain the business catalog; protocol-specific node paths and access modes move into `debugging_parameter_node_bindings`. The frontend selects the protocol before target detection and renders binding availability without exposing raw node paths to normal users.

**Tech Stack:** TypeScript, Node `spawn`, PostgreSQL migrations, Zod, WiseEff modular API router, React/Vite, Vitest, Testing Library, Playwright acceptance/device-lab gates.

---

## Source Spec

- `docs/superpowers/specs/2026-06-21-adb-hdc-debugging-protocol-design.md`
- `docs/zh-CN/superpowers/specs/2026-06-21-adb-hdc-debugging-protocol-design.md`

## Scope Notes

- This plan implements the backend API path. It does not add a local Vite `/api/adb/*` bridge.
- Existing local non-API HDC behavior may keep sending `nodePath`; API-mode read/write should resolve node paths from server-side bindings.
- ADB runs as `adb` from the backend server PATH. No frontend or Admin configurable binary path is introduced.
- Real ADB device validation is conditional and gated by environment variables, like the existing HDC device-lab smoke.
- The current environment may have `.git` as read-only. Commit steps are still listed because execution environments should normally allow them.

## File Structure

Create:

- `server/migrations/0017_adb_hdc_debugging_protocol.sql`: protocol columns, node-binding table, and HDC backfill.
- `server/modules/debugging/protocol.ts`: `DebugConnectionProtocol` constants, parser helpers, and user-facing labels.
- `server/modules/debugging/gatewayRegistry.ts`: protocol-to-gateway registry and unsupported-protocol errors.
- `server/modules/debugging/gatewayRegistry.test.ts`: registry selection tests.
- `server/modules/debugging/adbGateway.ts`: ADB command adapter.
- `server/modules/debugging/adbGateway.test.ts`: ADB command, parsing, timeout, and readback tests.
- `docs/runbooks/adb-device-lab.md`: ADB hardware evidence runbook.
- `docs/zh-CN/runbooks/adb-device-lab.md`: Chinese companion runbook.
- `e2e/acceptance/adb-device-lab.acceptance.spec.ts`: conditional ADB hardware smoke.

Modify:

- `server/modules/debugging/status.ts`: add protocol constants if not colocated in `protocol.ts`.
- `server/modules/debugging/types.ts`: add protocol to device/target/session/operation records and node-binding records.
- `server/modules/debugging/gateway.ts`: add protocol-aware gateway target conventions only if needed.
- `server/modules/debugging/repository.ts`: read/write protocol columns and CRUD node bindings.
- `server/modules/debugging/repository.test.ts`: migration-shaped binding and protocol persistence tests.
- `server/modules/debugging/schemas.ts`: protocol query/body fields and read/write requests without frontend nodePath dependency.
- `server/modules/debugging/schemas.test.ts`: protocol validation and binding-aware read/write schemas.
- `server/modules/debugging/service.ts`: use registry/session protocol/binding lookup for detect, session, read, write, rollback.
- `server/modules/debugging/service.test.ts`: ADB protocol flows, missing binding, disabled binding, and rollback protocol tests.
- `server/modules/debugging/routes.ts`: pass registry into service and parse protocol DTOs.
- `server/modules/debugging/routes.test.ts`: DTO routing and permission tests for protocol fields.
- `server/modules/debugging/hdcGateway.ts`: expose shared command-result helpers only if reused by ADB.
- `server/modules/debugging/hdcGateway.test.ts`: preserve HDC behavior.
- `server/modules/debugging/simulator.ts`: set protocol to `hdc` or simulator-safe default target behavior for existing tests.
- `server/config/env.ts`: allow `DEBUG_DEVICE_GATEWAY_MODE=simulator|hdc|adb|multi`, add optional `ADB_TIMEOUT_MS`.
- `server/config/env.test.ts`: environment validation for ADB/multi mode and production rules.
- `.env.example`, `ops/self-hosted/.env.example`: document `ADB_TIMEOUT_MS` and gateway mode choices.
- `server/index.ts`: build gateway registry from env and include ADB adapter.
- `server/app.ts`: accept a gateway registry or preserve single-gateway tests with adapter wrapping.
- `scripts/seed-m3-debugging.ts`: seed HDC bindings from current node metadata and sample disabled ADB bindings if useful.
- `server/modules/operations/health.ts`, `server/modules/operations/routes.ts`: include selected protocol/gateway readiness evidence if current readiness assumes one gateway.
- `src/domain/debugging/types.ts`: add protocol and node-binding frontend domain types.
- `src/application/ports/DebuggingGateway.ts`: add protocol fields, binding summaries, and API-mode read/write request shape.
- `src/application/debugging/debuggingRuntime.ts`: track selected protocol, pass protocol to detect/session creation, stop requiring `nodePath` for API reads/writes.
- `src/application/debugging/debuggingRuntime.test.ts`: protocol runtime tests.
- `src/infrastructure/http/debuggingDtos.ts`: protocol and binding DTO mappers.
- `src/infrastructure/http/debuggingDtos.test.ts`: mapper tests.
- `src/infrastructure/http/debuggingClient.ts`: protocol query/body support.
- `src/infrastructure/http/debuggingClient.test.ts`: HTTP contract tests.
- `src/NodeDebuggingPage.tsx`: protocol segmented control, session reset on protocol switch, binding disabled states.
- `src/NodeDebuggingPage.test.tsx`: UI protocol switch, disabled binding, and no-nodePath API calls.
- `src/App.tsx`: Admin binding editor and reducer actions for HDC/ADB bindings.
- `src/DebuggingPage.test.tsx`, `src/reducer.debugging.test.ts`: Admin binding and config persistence tests.
- `src/styles.css`: protocol selector and binding-state styles.
- `e2e/debugging.api.spec.ts`: preserve simulator/HDC API expectations and add protocol assertions.
- `e2e/acceptance/debugging-simulator.acceptance.spec.ts`: ensure default protocol path still works.
- `e2e/acceptance/hdc-device-lab.acceptance.spec.ts`: assert HDC protocol evidence.
- `e2e/acceptance/operationMatrix.ts`: add `ADB-LAB-001`.
- `docs/developer/browser-acceptance-coverage-map.md`, `docs/zh-CN/developer/browser-acceptance-coverage-map.md`: add `ADB-LAB-001`.
- `docs/developer/user-operation-coverage-matrix.md`, `docs/zh-CN/developer/user-operation-coverage-matrix.md`: regenerate/update after operation matrix changes.
- `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`: protocol switching and binding-aware node debugging.
- `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`: ADB/HDC backend safety boundary.
- `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md`: protocol and binding model.
- `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md`: protocol API fields.
- `docs/design-docs/testing-strategy.md`, `docs/zh-CN/design-docs/testing-strategy.md`: ADB conditional hardware test strategy.
- `docs/developer/environment-variables.md`, `docs/zh-CN/developer/environment-variables.md`: ADB timeout/env documentation.
- `docs/runbooks/README.md`, `docs/zh-CN/runbooks/README.md`: link ADB device-lab runbook.
- `docs/generated/db-schema.md`: regenerate after migration.

## Acceptance Coverage Impact

- Existing affected requirement IDs: `DEBUG-SIM-001`, `HDC-LAB-001`.
- New requirement ID: `ADB-LAB-001`.
- Existing affected operation IDs: `DEBUG-SIM-001`, `DEBUG-PERM-001`, `HDC-LAB-001`.
- New operation ID: `ADB-LAB-001`.
- Affected specs:
  - `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
  - `e2e/acceptance/hdc-device-lab.acceptance.spec.ts`
  - `e2e/acceptance/adb-device-lab.acceptance.spec.ts`
- Operation evidence impact: `npm run acceptance:evidence` must include the new conditional ADB operation row and preserve existing debugging evidence generation.

## Task 1: Protocol Types, DTO Schemas, And Migration Contract

**Files:**
- Create: `server/modules/debugging/protocol.ts`
- Modify: `server/modules/debugging/status.ts`
- Modify: `server/modules/debugging/types.ts`
- Modify: `server/modules/debugging/schemas.ts`
- Modify: `server/modules/debugging/schemas.test.ts`
- Create: `server/migrations/0017_adb_hdc_debugging_protocol.sql`

- [ ] **Step 1: Write protocol helper tests in `server/modules/debugging/schemas.test.ts`**

Add tests that pin accepted protocols, reject invalid protocols, make `nodePath` optional for API read/write, and parse binding admin payloads.

```ts
import { describe, expect, it } from "vitest";
import {
  createDebugSessionBodySchema,
  detectTargetsBodySchema,
  debugParameterNodeBindingSchema,
  listDebuggingParametersQuerySchema,
  readNodeBodySchema,
  writeNodeBodySchema
} from "./schemas";

describe("debugging protocol schemas", () => {
  it("accepts hdc and adb protocols for target detection and sessions", () => {
    expect(detectTargetsBodySchema.parse({ projectId: "aurora", deviceId: "device-1", protocol: "adb" })).toEqual({
      projectId: "aurora",
      deviceId: "device-1",
      protocol: "adb"
    });
    expect(createDebugSessionBodySchema.parse({
      projectId: "aurora",
      deviceId: "device-1",
      targetId: "adb:serial-1",
      protocol: "adb"
    }).protocol).toBe("adb");
  });

  it("rejects unsupported protocols at the API boundary", () => {
    expect(() => detectTargetsBodySchema.parse({ projectId: "aurora", protocol: "fastboot" })).toThrow();
    expect(() => listDebuggingParametersQuerySchema.parse({ protocol: "fastboot" })).toThrow();
  });

  it("lets API-mode read and write identify nodes by session and parameter", () => {
    expect(readNodeBodySchema.parse({ sessionId: "session-1", parameterId: "param-1" })).toEqual({
      sessionId: "session-1",
      parameterId: "param-1"
    });
    expect(writeNodeBodySchema.parse({ sessionId: "session-1", parameterId: "param-1", value: "42" })).toMatchObject({
      sessionId: "session-1",
      parameterId: "param-1",
      value: "42",
      readBack: true
    });
  });

  it("validates node bindings by protocol, path, access mode, and enabled state", () => {
    expect(debugParameterNodeBindingSchema.parse({
      protocol: "hdc",
      nodePath: "/sys/class/power_supply/battery/current_now",
      accessMode: "RW",
      enabled: true,
      notes: "lab path"
    })).toEqual({
      protocol: "hdc",
      nodePath: "/sys/class/power_supply/battery/current_now",
      accessMode: "RW",
      enabled: true,
      notes: "lab path"
    });
    expect(() => debugParameterNodeBindingSchema.parse({
      protocol: "adb",
      nodePath: "relative/path",
      accessMode: "RW",
      enabled: true
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/schemas.test.ts
```

Expected: FAIL because protocol/binding exports and optional `nodePath` behavior do not exist yet.

- [ ] **Step 3: Add protocol helpers**

Create `server/modules/debugging/protocol.ts`:

```ts
export const debugConnectionProtocols = ["hdc", "adb"] as const;
export type DebugConnectionProtocol = (typeof debugConnectionProtocols)[number];

export const defaultDebugConnectionProtocol: DebugConnectionProtocol = "hdc";

export function isDebugConnectionProtocol(value: unknown): value is DebugConnectionProtocol {
  return typeof value === "string" && debugConnectionProtocols.includes(value as DebugConnectionProtocol);
}

export function debugProtocolLabel(protocol: DebugConnectionProtocol) {
  return protocol.toUpperCase();
}
```

Update `server/modules/debugging/status.ts` to re-export the protocol constants if tests or consumers import statuses from one place:

```ts
export { debugConnectionProtocols, defaultDebugConnectionProtocol, type DebugConnectionProtocol } from "./protocol";
```

- [ ] **Step 4: Extend backend record types**

Update `server/modules/debugging/types.ts`:

```ts
import type { DebugConnectionProtocol } from "./protocol";

export type DebugDeviceRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  transport: "simulator" | "hdc" | "adb" | "multi";
  status: DebugDeviceStatus;
  firmware: string;
  lastSeenAt: string | null;
};

export type DebugTargetRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  deviceId: string;
  protocol: DebugConnectionProtocol;
  targetRef: string;
  label: string;
  status: DebugTargetStatus;
  detectedAt: string;
};

export type DebugParameterNodeBindingRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  parameterId: string;
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugAccessMode;
  enabled: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DebugSessionRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  deviceId: string;
  targetId: string;
  protocol: DebugConnectionProtocol;
  actorUserId: string;
  status: DebugSessionStatus;
  startedAt: string;
  endedAt: string | null;
};

export type DebugSnapshotEntry = {
  parameterId: string;
  protocol?: DebugConnectionProtocol;
  nodePath: string;
  previousValue: string;
  targetValue: string;
};

export type NodeOperationRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  sessionId: string;
  parameterId: string | null;
  protocol: DebugConnectionProtocol;
  nodePath: string;
  operationType: DebugOperationType;
  status: DebugOperationStatus;
  requestedValue: string | null;
  previousValue: string | null;
  readValue: string | null;
  readbackValue: string | null;
  verified: boolean;
  failureReason: string | null;
  durationMs: number;
  approvalId: string | null;
  snapshotId: string | null;
  createdAt: string;
};
```

Keep existing fields not shown here unchanged.

- [ ] **Step 5: Update schemas**

Update `server/modules/debugging/schemas.ts`:

```ts
import { z } from "zod";
import { debugAccessModes } from "./status";
import { debugConnectionProtocols, defaultDebugConnectionProtocol } from "./protocol";

const nonEmptyString = z.string().trim().min(1);
const protocolSchema = z.enum(debugConnectionProtocols).default(defaultDebugConnectionProtocol);
const nodePathSchema = z.string().trim().min(1).startsWith("/").refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
  message: "Node path must not contain control characters."
});

export const debugParameterNodeBindingSchema = z.object({
  protocol: z.enum(debugConnectionProtocols),
  nodePath: nodePathSchema,
  accessMode: z.enum(debugAccessModes),
  enabled: z.boolean().default(true),
  notes: z.string().trim().optional()
});

export const listDebuggingParametersQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  module: nonEmptyString.optional(),
  risk: z.union([nonEmptyString, z.array(nonEmptyString)]).optional(),
  protocol: z.enum(debugConnectionProtocols).optional()
});

export const detectTargetsBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString.optional(),
  protocol: protocolSchema
});

export const createDebugSessionBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString,
  targetId: nonEmptyString,
  protocol: protocolSchema
});

export const readNodeBodySchema = z.object({
  sessionId: nonEmptyString,
  parameterId: nonEmptyString.optional(),
  nodePath: nodePathSchema.optional()
}).refine((value) => Boolean(value.parameterId || value.nodePath), {
  message: "parameterId or nodePath is required."
});

export const writeNodeBodySchema = z.object({
  sessionId: nonEmptyString,
  parameterId: nonEmptyString,
  nodePath: nodePathSchema.optional(),
  value: nonEmptyString,
  readBack: z.boolean().default(true),
  approvalId: nonEmptyString.optional(),
  confirmationToken: nonEmptyString.optional(),
  expectedPreviousValue: nonEmptyString.optional()
});
```

Preserve `rollbackSnapshotBodySchema`.

- [ ] **Step 6: Add migration**

Create `server/migrations/0017_adb_hdc_debugging_protocol.sql`:

```sql
alter table debugging_devices
  alter column transport set default 'hdc';

alter table debugging_targets
  add column if not exists protocol text not null default 'hdc';

alter table debugging_sessions
  add column if not exists protocol text not null default 'hdc';

alter table node_operations
  add column if not exists protocol text not null default 'hdc';

create table if not exists debugging_parameter_node_bindings (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  parameter_id text not null references debugging_parameters(id),
  protocol text not null,
  node_path text not null,
  access_mode text not null,
  enabled boolean not null default true,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parameter_id, protocol)
);

insert into debugging_parameter_node_bindings (
  id,
  organization_id,
  project_id,
  parameter_id,
  protocol,
  node_path,
  access_mode,
  enabled,
  notes,
  metadata
)
select
  concat(id, ':hdc'),
  organization_id,
  project_id,
  id,
  'hdc',
  node_path,
  access_mode,
  true,
  'Backfilled from debugging_parameters.node_path/access_mode.',
  '{}'::jsonb
from debugging_parameters
where node_path is not null
  and length(trim(node_path)) > 0
on conflict (parameter_id, protocol) do update
set node_path = excluded.node_path,
  access_mode = excluded.access_mode,
  enabled = excluded.enabled,
  updated_at = now();

create index if not exists debugging_targets_protocol_idx on debugging_targets(project_id, protocol, status);
create index if not exists debugging_sessions_protocol_idx on debugging_sessions(project_id, protocol, started_at desc);
create index if not exists node_operations_protocol_idx on node_operations(session_id, protocol, created_at desc);
create index if not exists debugging_parameter_node_bindings_project_idx
  on debugging_parameter_node_bindings(project_id, protocol, enabled);
```

- [ ] **Step 7: Run schema tests**

Run:

```bash
npm run test:server -- server/modules/debugging/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add server/modules/debugging/protocol.ts server/modules/debugging/status.ts server/modules/debugging/types.ts server/modules/debugging/schemas.ts server/modules/debugging/schemas.test.ts server/migrations/0017_adb_hdc_debugging_protocol.sql
git commit -m "feat: add debugging protocol schema"
```

Expected: commit succeeds.

## Task 2: Repository Binding Persistence

**Files:**
- Modify: `server/modules/debugging/repository.ts`
- Modify: `server/modules/debugging/repository.test.ts`

- [ ] **Step 1: Write repository tests for protocol fields and bindings**

Add tests to `server/modules/debugging/repository.test.ts` that assert row mapping and SQL values. Use existing fake database helpers in that file. Add cases:

```ts
it("maps target, session, and operation protocol fields", async () => {
  const db = createFakeDb([
    [{ ...targetRow(), protocol: "adb" }],
    [{ ...sessionRow(), protocol: "adb" }],
    [operationRow({ text: "", values: [] }, { protocol: "adb" })]
  ]);

  await expect(getDebugTarget(db.db, { organizationId: "org-1", targetId: "target-1" })).resolves.toMatchObject({ protocol: "adb" });
  await expect(getDebugSession(db.db, { organizationId: "org-1", sessionId: "session-1" })).resolves.toMatchObject({ protocol: "adb" });
  await expect(listDebugSessionEvents(db.db, { organizationId: "org-1", sessionId: "session-1" })).resolves.toEqual([
    expect.objectContaining({ protocol: "adb" })
  ]);
});

it("returns enabled parameter node bindings by parameter and protocol", async () => {
  const db = createFakeDb([
    [{
      id: "binding-param-1-adb",
      organization_id: "org-1",
      project_id: "aurora",
      parameter_id: "param-1",
      protocol: "adb",
      node_path: "/sys/adb/current",
      access_mode: "RW",
      enabled: true,
      notes: "ADB lab node",
      created_at: timestamp,
      updated_at: timestamp
    }]
  ]);

  await expect(getDebugParameterNodeBinding(db.db, {
    organizationId: "org-1",
    parameterId: "param-1",
    protocol: "adb"
  })).resolves.toMatchObject({
    parameterId: "param-1",
    protocol: "adb",
    nodePath: "/sys/adb/current",
    accessMode: "RW",
    enabled: true
  });
});
```

Import the repository functions in the test. Adjust helper names to match the existing file.

- [ ] **Step 2: Run repository tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/repository.test.ts
```

Expected: FAIL because repository protocol columns and binding functions are not implemented.

- [ ] **Step 3: Update row types and mappers**

In `server/modules/debugging/repository.ts`, add `protocol` fields to `DebugTargetRow`, `DebugSessionRow`, and `NodeOperationRow`, defaulting to `defaultDebugConnectionProtocol` when old test rows omit the column:

```ts
import { defaultDebugConnectionProtocol, type DebugConnectionProtocol } from "./protocol";

type DebugTargetRow = {
  id: string;
  organization_id: string;
  project_id: string;
  device_id: string;
  protocol?: DebugConnectionProtocol;
  target_ref: string;
  label: string;
  status: DebugTargetStatus;
  detected_at: string | Date;
};

function toDebugTargetRecord(row: DebugTargetRow): DebugTargetRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    deviceId: row.device_id,
    protocol: row.protocol ?? defaultDebugConnectionProtocol,
    targetRef: row.target_ref,
    label: row.label,
    status: row.status,
    detectedAt: dateTimeToIso(row.detected_at) ?? ""
  };
}
```

Apply the same pattern to sessions and node operations.

- [ ] **Step 4: Add binding row mapper and query functions**

Add:

```ts
type DebugParameterNodeBindingRow = {
  id: string;
  organization_id: string;
  project_id: string;
  parameter_id: string;
  protocol: DebugConnectionProtocol;
  node_path: string;
  access_mode: DebugAccessMode;
  enabled: boolean;
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
    notes: row.notes,
    createdAt: dateTimeToIso(row.created_at) ?? "",
    updatedAt: dateTimeToIso(row.updated_at) ?? ""
  };
}

export async function getDebugParameterNodeBinding(
  db: Queryable,
  input: { organizationId: string; parameterId: string; protocol: DebugConnectionProtocol }
): Promise<DebugParameterNodeBindingRecord | null> {
  const result = await db.query<DebugParameterNodeBindingRow>(
    `
    select id, organization_id, project_id, parameter_id, protocol, node_path, access_mode, enabled, notes, created_at, updated_at
    from debugging_parameter_node_bindings
    where organization_id = $1
      and parameter_id = $2
      and protocol = $3
    limit 1
    `,
    [input.organizationId, input.parameterId, input.protocol]
  );

  return result.rows[0] ? toDebugParameterNodeBindingRecord(result.rows[0]) : null;
}

export async function listDebugParameterNodeBindings(
  db: Queryable,
  input: { organizationId: string; projectId?: string; parameterIds?: string[]; protocol?: DebugConnectionProtocol }
): Promise<DebugParameterNodeBindingRecord[]> {
  const values: unknown[] = [input.organizationId];
  const where = ["organization_id = $1"];
  if (input.projectId) addCondition(where, values, (placeholder) => `project_id = ${placeholder}`, input.projectId);
  if (input.parameterIds?.length) addCondition(where, values, (placeholder) => `parameter_id = any(${placeholder}::text[])`, input.parameterIds);
  if (input.protocol) addCondition(where, values, (placeholder) => `protocol = ${placeholder}`, input.protocol);

  const result = await db.query<DebugParameterNodeBindingRow>(
    `
    select id, organization_id, project_id, parameter_id, protocol, node_path, access_mode, enabled, notes, created_at, updated_at
    from debugging_parameter_node_bindings
    where ${where.join("\n      and ")}
    order by parameter_id asc, protocol asc
    `,
    values
  );

  return result.rows.map(toDebugParameterNodeBindingRecord);
}
```

- [ ] **Step 5: Update existing select/insert SQL**

Include `protocol` in:

- `getDebugTarget`
- `upsertDetectedTargets`
- `createDebugSession`
- `getDebugSession`
- `listDebugSessionEvents`
- `insertNodeOperation`

For `upsertDetectedTargets`, extend input targets with `protocol` and update the uniqueness strategy in SQL. Until a DB unique constraint changes, target refs can be prefixed by adapter (`adb:<serial>`, existing HDC target string) to avoid conflicts. Use values:

```ts
[input.organizationId, input.projectId, input.deviceId, target.id, target.protocol, target.targetRef, target.label, status]
```

For `insertNodeOperation`, add `protocol` as a required input and insert column before `node_path`.

- [ ] **Step 6: Run repository tests**

Run:

```bash
npm run test:server -- server/modules/debugging/repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add server/modules/debugging/repository.ts server/modules/debugging/repository.test.ts
git commit -m "feat: persist debugging protocol bindings"
```

Expected: commit succeeds.

## Task 3: Gateway Registry And ADB Adapter

**Files:**
- Create: `server/modules/debugging/gatewayRegistry.ts`
- Create: `server/modules/debugging/gatewayRegistry.test.ts`
- Create: `server/modules/debugging/adbGateway.ts`
- Create: `server/modules/debugging/adbGateway.test.ts`
- Modify: `server/modules/debugging/hdcGateway.ts`

- [ ] **Step 1: Write registry tests**

Create `server/modules/debugging/gatewayRegistry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { DebugDeviceGateway } from "./gateway";
import { createDebugDeviceGatewayRegistry } from "./gatewayRegistry";

function gateway(): DebugDeviceGateway {
  return {
    detectTargets: vi.fn(),
    readNode: vi.fn(),
    writeNode: vi.fn()
  };
}

describe("debug device gateway registry", () => {
  it("returns the gateway registered for a protocol", () => {
    const hdc = gateway();
    const adb = gateway();
    const registry = createDebugDeviceGatewayRegistry({ hdc, adb });

    expect(registry.requireGateway("hdc")).toBe(hdc);
    expect(registry.requireGateway("adb")).toBe(adb);
  });

  it("throws a typed error when protocol support is missing", () => {
    const registry = createDebugDeviceGatewayRegistry({ hdc: gateway() });

    expect(() => registry.requireGateway("adb")).toMatchObject({
      code: "PROTOCOL_UNSUPPORTED",
      message: "Debug protocol adb is not enabled."
    });
  });
});
```

- [ ] **Step 2: Write ADB gateway tests**

Create `server/modules/debugging/adbGateway.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createAdbDebugDeviceGateway, type AdbCommandRunner } from "./adbGateway";

function makeRunner(results: Awaited<ReturnType<AdbCommandRunner>>[]) {
  const calls: Array<{ command: string; args: string[]; timeoutMs: number }> = [];
  const runCommand: AdbCommandRunner = vi.fn(async (command, args, options) => {
    calls.push({ command, args, timeoutMs: options.timeoutMs });
    const result = results.shift();
    if (!result) throw new Error("Unexpected ADB command");
    return result;
  });
  return { calls, runCommand };
}

describe("ADB debug device gateway", () => {
  it("parses adb devices output into gateway targets", async () => {
    const { runCommand } = makeRunner([{ code: 0, stdout: "List of devices attached\nemulator-5554\tdevice\nunauth\tunauthorized\n\n", stderr: "", durationMs: 10 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    await expect(gateway.detectTargets({ projectId: "aurora", deviceId: "device-1" })).resolves.toEqual({
      ok: true,
      targets: [{
        id: "adb:emulator-5554",
        deviceId: "device-1",
        targetRef: "emulator-5554",
        label: "ADB target emulator-5554",
        online: true,
        protocol: "adb"
      }]
    });
  });

  it("constructs argv-safe ADB write commands", async () => {
    const value = "5; rm -rf / quoted";
    const nodePath = "/sys/node with spaces";
    const { calls, runCommand } = makeRunner([{ code: 0, stdout: "", stderr: "", durationMs: 7 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1500 });

    const result = await gateway.writeNode({ targetRef: "emulator-5554", nodePath, value, readBack: false });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([{
      command: "adb",
      args: ["-s", "emulator-5554", "shell", "sh", "-c", "printf '%s' \"$1\" > \"$2\"", "wiseeff-write-node", value, nodePath],
      timeoutMs: 1500
    }]);
  });

  it("reports readback mismatch after a successful ADB write", async () => {
    const { runCommand } = makeRunner([
      { code: 0, stdout: "", stderr: "", durationMs: 8 },
      { code: 0, stdout: "old\n", stderr: "", durationMs: 9 }
    ]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    await expect(gateway.writeNode({ targetRef: "emulator-5554", nodePath: "/sys/node", value: "new", readBack: true }))
      .resolves.toMatchObject({
        ok: false,
        value: "new",
        verified: false,
        error: "Read-back mismatch after ADB write."
      });
  });

  it("normalizes ADB timeout failures", async () => {
    const { runCommand } = makeRunner([{ code: null, stdout: "", stderr: "", timedOut: true, durationMs: 1007 }]);
    const gateway = createAdbDebugDeviceGateway({ runCommand, timeoutMs: 1000 });

    await expect(gateway.readNode({ targetRef: "emulator-5554", nodePath: "/sys/node" })).resolves.toMatchObject({
      ok: false,
      error: "ADB command timed out after 1000ms.",
      durationMs: 1007
    });
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/gatewayRegistry.test.ts server/modules/debugging/adbGateway.test.ts
```

Expected: FAIL because registry and ADB adapter do not exist.

- [ ] **Step 4: Implement registry**

Create `server/modules/debugging/gatewayRegistry.ts`:

```ts
import { ApiError } from "../../shared/http/errors";
import type { DebugConnectionProtocol } from "./protocol";
import type { DebugDeviceGateway } from "./gateway";

export type DebugDeviceGatewayRegistry = {
  requireGateway(protocol: DebugConnectionProtocol): DebugDeviceGateway;
  hasGateway(protocol: DebugConnectionProtocol): boolean;
};

export function createDebugDeviceGatewayRegistry(gateways: Partial<Record<DebugConnectionProtocol, DebugDeviceGateway>>): DebugDeviceGatewayRegistry {
  return {
    requireGateway(protocol) {
      const gateway = gateways[protocol];
      if (!gateway) {
        throw new ApiError("PROTOCOL_UNSUPPORTED", `Debug protocol ${protocol} is not enabled.`, 409, { protocol });
      }
      return gateway;
    },
    hasGateway(protocol) {
      return Boolean(gateways[protocol]);
    }
  };
}
```

- [ ] **Step 5: Implement ADB adapter**

Create `server/modules/debugging/adbGateway.ts` by following `hdcGateway.ts`, replacing command names and labels:

```ts
import { spawn } from "node:child_process";
import type { DebugDeviceGateway, GatewayNodeResult, GatewayReadInput, GatewayTarget, GatewayWriteInput, GatewayWriteResult } from "./gateway";

export type AdbCommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
};

export type AdbCommandRunner = (command: string, args: string[], options: { timeoutMs: number }) => Promise<AdbCommandResult>;

type AdbGatewayOptions = {
  command?: string;
  timeoutMs?: number;
  runCommand?: AdbCommandRunner;
};

const defaultTimeoutMs = 5000;

function durationSince(startedAt: number) {
  return Math.max(1, Date.now() - startedAt);
}

function normalizeFailure(result: AdbCommandResult, timeoutMs: number) {
  if (result.timedOut) return `ADB command timed out after ${timeoutMs}ms.`;
  const reason = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? "unknown"}`;
  return `ADB command failed: ${reason}`;
}

function nodeResultFromCommand(result: AdbCommandResult, timeoutMs: number, value?: string): GatewayNodeResult {
  if (result.timedOut || result.code !== 0) {
    return { ok: false, stdout: result.stdout, stderr: result.stderr, error: normalizeFailure(result, timeoutMs), durationMs: result.durationMs };
  }
  const stdoutValue = value ?? result.stdout.trim();
  return { ok: true, value: stdoutValue, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs };
}

export function createDefaultAdbCommandRunner(): AdbCommandRunner {
  return (command, args, options) => new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, { shell: false, windowsHide: true });
    const timeout = setTimeout(() => {
      settled = true;
      child.kill();
      resolve({ code: null, stdout, stderr, timedOut: true, durationMs: durationSince(startedAt) });
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, stdout, stderr, durationMs: durationSince(startedAt) });
    });
  });
}

function parseAdbDevices(stdout: string, deviceId: string): GatewayTarget[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("list of devices"))
    .map((line) => line.split(/\s+/))
    .filter(([serial, state]) => Boolean(serial) && state === "device")
    .map(([serial]) => ({
      id: `adb:${serial}`,
      deviceId,
      targetRef: serial,
      label: `ADB target ${serial}`,
      online: true,
      protocol: "adb" as const
    }));
}

export function createAdbDebugDeviceGateway(options: AdbGatewayOptions = {}): DebugDeviceGateway {
  const command = options.command ?? "adb";
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const runCommand = options.runCommand ?? createDefaultAdbCommandRunner();
  async function run(args: string[]) {
    try {
      return await runCommand(command, args, { timeoutMs });
    } catch (error) {
      return { code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error), durationMs: 1 };
    }
  }
  async function readNodeValue(input: GatewayReadInput) {
    const result = await run(["-s", input.targetRef, "shell", "cat", input.nodePath]);
    return nodeResultFromCommand(result, timeoutMs);
  }
  return {
    async detectTargets(input) {
      if (!input.deviceId?.trim()) {
        return { ok: false, targets: [], error: "ADB target detection requires deviceId so detected targets can be persisted against a known debugging device." };
      }
      const result = await run(["devices"]);
      if (result.timedOut || result.code !== 0) return { ok: false, targets: [], error: normalizeFailure(result, timeoutMs) };
      return { ok: true, targets: parseAdbDevices(result.stdout, input.deviceId) };
    },
    readNode: readNodeValue,
    async writeNode(input: GatewayWriteInput): Promise<GatewayWriteResult> {
      const writeCommand = await run(["-s", input.targetRef, "shell", "sh", "-c", "printf '%s' \"$1\" > \"$2\"", "wiseeff-write-node", input.value, input.nodePath]);
      const writeResult = nodeResultFromCommand(writeCommand, timeoutMs, input.value);
      if (!writeResult.ok) return { ok: false, verified: false, error: writeResult.error, writeResult };
      if (!input.readBack) return { ok: true, value: input.value, verified: true, writeResult };
      const readResult = await readNodeValue(input);
      if (!readResult.ok) return { ok: false, value: input.value, verified: false, error: readResult.error, writeResult, readResult };
      if (readResult.value !== input.value) return { ok: false, value: input.value, verified: false, error: "Read-back mismatch after ADB write.", writeResult, readResult };
      return { ok: true, value: input.value, verified: true, writeResult, readResult };
    }
  };
}
```

- [ ] **Step 6: Extend gateway target type for protocol**

Update `server/modules/debugging/gateway.ts`:

```ts
import type { DebugConnectionProtocol } from "./protocol";

export type GatewayTarget = {
  id: string;
  deviceId: string;
  protocol?: DebugConnectionProtocol;
  targetRef: string;
  label: string;
  online: boolean;
};
```

Existing HDC adapter can omit `protocol`; the service will apply the requested protocol.

- [ ] **Step 7: Run gateway tests**

Run:

```bash
npm run test:server -- server/modules/debugging/gatewayRegistry.test.ts server/modules/debugging/adbGateway.test.ts server/modules/debugging/hdcGateway.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add server/modules/debugging/gateway.ts server/modules/debugging/gatewayRegistry.ts server/modules/debugging/gatewayRegistry.test.ts server/modules/debugging/adbGateway.ts server/modules/debugging/adbGateway.test.ts server/modules/debugging/hdcGateway.ts server/modules/debugging/hdcGateway.test.ts
git commit -m "feat: add adb debugging gateway"
```

Expected: commit succeeds.

## Task 4: Service And Route Protocol Flow

**Files:**
- Modify: `server/modules/debugging/service.ts`
- Modify: `server/modules/debugging/service.test.ts`
- Modify: `server/modules/debugging/routes.ts`
- Modify: `server/modules/debugging/routes.test.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Write service tests for ADB protocol and bindings**

Add cases to `server/modules/debugging/service.test.ts`:

```ts
it("detects ADB targets through the registry and audits protocol metadata", async () => {
  const adbGateway = makeGateway({
    detectTargets: vi.fn(async () => ({
      ok: true,
      targets: [{ id: "adb:emulator-5554", deviceId: "device-1", targetRef: "emulator-5554", label: "ADB target emulator-5554", online: true, protocol: "adb" }]
    }))
  });
  const db = createFakeDb([
    [deviceRow()],
    (call) => [{ ...targetRow(), id: call.values[3], protocol: call.values[4], target_ref: call.values[5], label: call.values[6] }]
  ]);
  const audit = createAuditSpy();
  const service = createDebuggingService({
    db: db.db,
    gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: adbGateway }),
    createAuditEvent: audit.createAuditEvent
  });

  const targets = await service.detectTargets(makeAuth(["debugging:view", "debugging:read"]), {
    projectId: "aurora",
    deviceId: "device-1",
    protocol: "adb"
  });

  expect(targets[0]).toMatchObject({ protocol: "adb", targetRef: "emulator-5554" });
  expect(adbGateway.detectTargets).toHaveBeenCalledWith({ projectId: "aurora", deviceId: "device-1" });
  expect(audit.events.at(-1)?.metadata).toMatchObject({ protocol: "adb", targetCount: 1 });
});

it("reads an ADB node from the session protocol binding without trusting frontend nodePath", async () => {
  const adbGateway = makeGateway();
  const db = createFakeDb([
    [sessionRow({ protocol: "adb" })],
    [parameterRow()],
    [{
      id: "binding-1",
      organization_id: "org-1",
      project_id: "aurora",
      parameter_id: "param-1",
      protocol: "adb",
      node_path: "/sys/adb/current",
      access_mode: "RW",
      enabled: true,
      notes: null,
      created_at: timestamp,
      updated_at: timestamp
    }],
    [targetRow({ protocol: "adb", target_ref: "emulator-5554" })],
    (call) => [operationRow(call, { protocol: "adb", node_path: "/sys/adb/current" })]
  ]);
  const service = createDebuggingService({ db: db.db, gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: adbGateway }) });

  await service.readNode(makeAuth(["debugging:view", "debugging:read"]), {
    sessionId: "session-1",
    parameterId: "param-1",
    nodePath: "/malicious/frontend/path"
  });

  expect(adbGateway.readNode).toHaveBeenCalledWith({ targetRef: "emulator-5554", nodePath: "/sys/adb/current" });
});

it("rejects writes when the session protocol binding is missing", async () => {
  const db = createFakeDb([
    [sessionRow({ protocol: "adb" })],
    [parameterRow()],
    []
  ]);
  const service = createDebuggingService({ db: db.db, gatewayRegistry: createDebugDeviceGatewayRegistry({ adb: makeGateway() }) });

  await expect(service.writeNode(makeAuth(["debugging:view", "debugging:read", "debugging:write"]), {
    sessionId: "session-1",
    parameterId: "param-1",
    value: "3200"
  })).rejects.toMatchObject({
    code: "DEBUG_BINDING_NOT_CONFIGURED"
  });
});
```

Adjust fake result ordering to match repository queries during implementation.

- [ ] **Step 2: Write route tests for protocol fields**

Add to `server/modules/debugging/routes.test.ts`:

```ts
it("passes protocol to target detection service", async () => {
  const db = makeDb();
  const gateway = makeGateway();
  serviceMocks.detectTargets.mockResolvedValue([targetRecord({ protocol: "adb" })]);

  const response = await requestJson<{ items: DebugTargetRecord[] }>(
    makeServer({ db, gateway }),
    "/api/v1/debugging/targets/detect",
    { method: "POST", body: { projectId: "aurora", deviceId: "device-1", protocol: "adb" } }
  );

  expect(response.status).toBe(200);
  expect(serviceMocks.detectTargets).toHaveBeenCalledWith(expect.anything(), {
    projectId: "aurora",
    deviceId: "device-1",
    protocol: "adb"
  }, expect.anything());
});

it("accepts binding-aware read requests without nodePath", async () => {
  serviceMocks.readNode.mockResolvedValue(operationRecord({ protocol: "adb" }));

  const response = await requestJson(
    makeServer({ db: makeDb(), gateway: makeGateway() }),
    "/api/v1/debugging/nodes/read",
    { method: "POST", body: { sessionId: "session-1", parameterId: "param-1" } }
  );

  expect(response.status).toBe(200);
  expect(serviceMocks.readNode).toHaveBeenCalledWith(expect.anything(), {
    sessionId: "session-1",
    parameterId: "param-1"
  }, expect.anything());
});
```

- [ ] **Step 3: Run service and route tests and verify failure**

Run:

```bash
npm run test:server -- server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts
```

Expected: FAIL because service still accepts a single gateway and uses parameter node path directly.

- [ ] **Step 4: Update service options**

In `server/modules/debugging/service.ts`, replace the required `gateway` option with registry support while preserving tests that pass one gateway:

```ts
import { createDebugDeviceGatewayRegistry, type DebugDeviceGatewayRegistry } from "./gatewayRegistry";
import { defaultDebugConnectionProtocol, type DebugConnectionProtocol } from "./protocol";
import { getDebugParameterNodeBinding } from "./repository";

type ServiceOptions = {
  db: Database;
  gateway?: DebugDeviceGateway;
  gatewayRegistry?: DebugDeviceGatewayRegistry;
  createAuditEvent?: AuditWriter;
  metrics?: Pick<MetricsRegistry, "recordDeviceGatewayOperation">;
  tracing?: Pick<TracingBoundary, "withSpan">;
  gatewayMode?: "simulator" | "hdc" | "adb" | "multi" | string;
};

const registry = options.gatewayRegistry ?? createDebugDeviceGatewayRegistry({
  hdc: options.gateway,
  adb: options.gateway
});
```

Use the final code pattern inside `createDebuggingService`, not a top-level `registry` variable.

- [ ] **Step 5: Add binding helpers in service**

Add:

```ts
async function requireProtocolBinding(
  tx: Queryable,
  input: { organizationId: string; parameterId: string; protocol: DebugConnectionProtocol }
) {
  const binding = await getDebugParameterNodeBinding(tx, input);
  if (!binding) {
    throw new ApiError("DEBUG_BINDING_NOT_CONFIGURED", "Debug parameter is not configured for the selected protocol.", 400, {
      parameterId: input.parameterId,
      protocol: input.protocol
    });
  }
  if (!binding.enabled) {
    throw new ApiError("DEBUG_BINDING_DISABLED", "Debug parameter binding is disabled for the selected protocol.", 400, {
      parameterId: input.parameterId,
      protocol: input.protocol
    });
  }
  return binding;
}
```

Update `ensureReadable` and `ensureWritable` to accept a binding access mode and node path instead of `parameter.nodePath`.

- [ ] **Step 6: Route detect and session creation through protocol**

In `detectTargets`, call:

```ts
const protocol = input.protocol ?? defaultDebugConnectionProtocol;
const gateway = registry.requireGateway(protocol);
const gatewayResult = await gateway.detectTargets({ projectId: input.projectId, deviceId: input.deviceId });
```

When upserting targets, include `protocol` for each target:

```ts
targets: result.targets.map((target) => ({
  id: target.id,
  protocol,
  targetRef: target.targetRef,
  label: target.label,
  online: target.online
}))
```

Audit metadata must include `protocol`.

In `createSession`, require `target.protocol === input.protocol` and create the session with that protocol.

- [ ] **Step 7: Route read/write/rollback through session protocol and binding**

For `readNode`:

```ts
const protocol = session.protocol ?? defaultDebugConnectionProtocol;
const binding = input.parameterId
  ? await requireProtocolBinding(tx, { organizationId, parameterId: input.parameterId, protocol })
  : null;
const nodePath = binding?.nodePath ?? input.nodePath;
if (!nodePath) throw new ApiError("VALIDATION_FAILED", "parameterId or nodePath is required.", 400);
if (binding) ensureReadable(parameter, session, binding.nodePath, binding.accessMode);
const gateway = registry.requireGateway(protocol);
const result = await gateway.readNode({ targetRef: target.targetRef, nodePath });
```

Persist operation with `protocol`.

For `writeNode`, always require binding for `parameterId`, use `binding.nodePath` and `binding.accessMode`, and create snapshot entries with `protocol`.

For rollback, use `session.protocol` and entry `protocol ?? session.protocol` to select gateway. Reject if a snapshot contains mixed protocols in this release:

```ts
if (entry.protocol && entry.protocol !== session.protocol) {
  throw new ApiError("VALIDATION_FAILED", "Snapshot protocol does not match the rollback session.", 400);
}
```

- [ ] **Step 8: Update routes/app wiring**

In `server/modules/debugging/routes.ts`, accept `debugGatewayRegistry?: DebugDeviceGatewayRegistry` and pass it to `createDebuggingService`.

In `server/app.ts`, extend options:

```ts
debugGatewayRegistry?: DebugDeviceGatewayRegistry;
```

Pass both `debugGateway` and `debugGatewayRegistry` through to `registerDebuggingRoutes`.

- [ ] **Step 9: Run service and route tests**

Run:

```bash
npm run test:server -- server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add server/modules/debugging/service.ts server/modules/debugging/service.test.ts server/modules/debugging/routes.ts server/modules/debugging/routes.test.ts server/app.ts
git commit -m "feat: route debugging operations by protocol"
```

Expected: commit succeeds.

## Task 5: Environment, Server Startup, Seeds, And Readiness

**Files:**
- Modify: `server/config/env.ts`
- Modify: `server/config/env.test.ts`
- Modify: `.env.example`
- Modify: `ops/self-hosted/.env.example`
- Modify: `server/index.ts`
- Modify: `scripts/seed-m3-debugging.ts`
- Modify: `server/modules/operations/health.ts`
- Modify: `server/modules/operations/routes.ts`
- Modify: related operations tests if health output changes.

- [ ] **Step 1: Write env tests**

Add to `server/config/env.test.ts`:

```ts
it("allows adb and multi debugging gateway modes", () => {
  expect(loadServerEnv({ DEBUG_DEVICE_GATEWAY_MODE: "adb" }).DEBUG_DEVICE_GATEWAY_MODE).toBe("adb");
  expect(loadServerEnv({ DEBUG_DEVICE_GATEWAY_MODE: "multi" }).DEBUG_DEVICE_GATEWAY_MODE).toBe("multi");
});

it("defaults ADB_TIMEOUT_MS to HDC timeout budget", () => {
  expect(loadServerEnv({}).ADB_TIMEOUT_MS).toBe(5000);
  expect(loadServerEnv({ ADB_TIMEOUT_MS: "7500" }).ADB_TIMEOUT_MS).toBe(7500);
});
```

- [ ] **Step 2: Run env tests and verify failure**

Run:

```bash
npm run test:server -- server/config/env.test.ts
```

Expected: FAIL because `adb`, `multi`, and `ADB_TIMEOUT_MS` are unknown.

- [ ] **Step 3: Update env schema**

In `server/config/env.ts`:

```ts
DEBUG_DEVICE_GATEWAY_MODE: z.enum(["simulator", "hdc", "adb", "multi"]).default("simulator"),
HDC_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
ADB_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
```

Update production validation to allow `hdc`, `adb`, or `multi`:

```ts
if (
  env.NODE_ENV === "production" &&
  !["hdc", "adb", "multi"].includes(env.DEBUG_DEVICE_GATEWAY_MODE) &&
  !env.DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION
) {
  throw new Error(
    "DEBUG_DEVICE_GATEWAY_MODE=hdc, adb, or multi is required when NODE_ENV=production. Set DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION=true only for non-customer staging environments that intentionally run the simulator."
  );
}
```

- [ ] **Step 4: Wire server startup registry**

In `server/index.ts`, import ADB and registry:

```ts
import { createAdbDebugDeviceGateway } from "./modules/debugging/adbGateway";
import { createDebugDeviceGatewayRegistry } from "./modules/debugging/gatewayRegistry";
```

Build:

```ts
const hdcGateway = createHdcDebugDeviceGateway({ timeoutMs: env.HDC_TIMEOUT_MS });
const adbGateway = createAdbDebugDeviceGateway({ timeoutMs: env.ADB_TIMEOUT_MS });
const simulatorGateway = createSimulatorDebugDeviceGateway();
const debugGateway =
  env.DEBUG_DEVICE_GATEWAY_MODE === "hdc"
    ? hdcGateway
    : env.DEBUG_DEVICE_GATEWAY_MODE === "adb"
      ? adbGateway
      : simulatorGateway;
const debugGatewayRegistry = createDebugDeviceGatewayRegistry({
  hdc: env.DEBUG_DEVICE_GATEWAY_MODE === "multi" ? hdcGateway : debugGateway,
  adb: env.DEBUG_DEVICE_GATEWAY_MODE === "multi" || env.DEBUG_DEVICE_GATEWAY_MODE === "adb" ? adbGateway : undefined
});
```

Pass `debugGatewayRegistry` into `createWiseEffServerFromEnv`.

- [ ] **Step 5: Update seed script**

In `scripts/seed-m3-debugging.ts`, after inserting each `debugging_parameters` row, insert an HDC binding:

```ts
await tx.query(
  `
  insert into debugging_parameter_node_bindings (
    id, organization_id, project_id, parameter_id, protocol, node_path, access_mode, enabled, notes, metadata, updated_at
  )
  values ($1, $2, $3, $4, 'hdc', $5, $6, true, $7, '{}'::jsonb, now())
  on conflict (parameter_id, protocol) do update set
    node_path = excluded.node_path,
    access_mode = excluded.access_mode,
    enabled = excluded.enabled,
    notes = excluded.notes,
    updated_at = now()
  `,
  [`${parameter.id}:hdc`, organizationId, projectId, parameter.id, parameter.nodePath, parameter.accessMode, "Seeded HDC node binding."]
);
```

Do not seed enabled ADB bindings unless a safe fixture exists. If adding examples, set `enabled=false`.

- [ ] **Step 6: Update env examples**

Add to `.env.example` and `ops/self-hosted/.env.example`:

```text
# DEBUG_DEVICE_GATEWAY_MODE supports simulator, hdc, adb, or multi.
ADB_TIMEOUT_MS=5000
```

Keep `HDC_TIMEOUT_MS=5000`.

- [ ] **Step 7: Update readiness only if necessary**

If `server/modules/operations/health.ts` or readiness output reports `DEBUG_DEVICE_GATEWAY_MODE`, add support for `adb` and `multi` without changing the public shape unless tests require it. If no health code change is needed, record that in the commit message body or plan execution notes.

- [ ] **Step 8: Run env and startup-related tests**

Run:

```bash
npm run test:server -- server/config/env.test.ts server/modules/operations/routes.test.ts server/modules/operations/health.test.ts
```

Expected: PASS. If an operations test file does not exist, omit it and record the omission.

- [ ] **Step 9: Commit**

Run:

```bash
git add server/config/env.ts server/config/env.test.ts .env.example ops/self-hosted/.env.example server/index.ts scripts/seed-m3-debugging.ts server/modules/operations/health.ts server/modules/operations/routes.ts
git commit -m "feat: configure adb debugging runtime"
```

Expected: commit succeeds. If operations files were not changed, omit them from `git add`.

## Task 6: Frontend Domain, Port, HTTP DTOs, And Runtime

**Files:**
- Modify: `src/domain/debugging/types.ts`
- Modify: `src/application/ports/DebuggingGateway.ts`
- Modify: `src/application/debugging/debuggingRuntime.ts`
- Modify: `src/application/debugging/debuggingRuntime.test.ts`
- Modify: `src/infrastructure/http/debuggingDtos.ts`
- Modify: `src/infrastructure/http/debuggingDtos.test.ts`
- Modify: `src/infrastructure/http/debuggingClient.ts`
- Modify: `src/infrastructure/http/debuggingClient.test.ts`

- [ ] **Step 1: Write DTO mapper tests**

Add to `src/infrastructure/http/debuggingDtos.test.ts`:

```ts
it("maps protocol binding state into debug parameters", () => {
  expect(debugParameterFromDto({
    id: "param-1",
    projectId: "aurora",
    name: "Current",
    key: "current",
    description: "Current limit",
    module: "Battery",
    unit: "mA",
    range: "0-5000",
    risk: "Medium",
    currentValue: "3000",
    targetValue: "3200",
    selectedBinding: {
      protocol: "adb",
      nodePath: "/sys/adb/current",
      accessMode: "RW",
      enabled: true
    },
    bindings: []
  })).toMatchObject({
    id: "param-1",
    selectedProtocol: "adb",
    nodePath: "/sys/adb/current",
    accessMode: "RW",
    bindingStatus: "configured"
  });
});

it("maps missing selected binding into an unavailable row", () => {
  expect(debugParameterFromDto({
    id: "param-1",
    projectId: "aurora",
    name: "Current",
    key: "current",
    description: "Current limit",
    module: "Battery",
    unit: "mA",
    range: "0-5000",
    risk: "Medium",
    currentValue: "3000",
    targetValue: "3200",
    selectedBinding: null,
    bindings: []
  })).toMatchObject({
    nodePath: "",
    accessMode: "RO",
    bindingStatus: "missing"
  });
});
```

- [ ] **Step 2: Write HTTP client tests**

Add to `src/infrastructure/http/debuggingClient.test.ts`:

```ts
it("sends protocol in detect and session requests", async () => {
  const api = createApiClient({ baseUrl: "http://api.test", fetch: fetchMock });
  const gateway = createHttpDebuggingGateway(api);
  fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

  await gateway.detectTargets({ projectId: "aurora", deviceId: "device-1", protocol: "adb" });

  expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/v1/debugging/targets/detect", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ projectId: "aurora", deviceId: "device-1", protocol: "adb" })
  }));
});

it("omits nodePath from API read/write when parameterId is present", async () => {
  const api = createApiClient({ baseUrl: "http://api.test", fetch: fetchMock });
  const gateway = createHttpDebuggingGateway(api);
  fetchMock.mockResolvedValueOnce(jsonResponse({ operation: nodeOperationDto() }));

  await gateway.readNode({ sessionId: "session-1", parameterId: "param-1", nodePath: "/frontend/path" });

  expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/v1/debugging/nodes/read", expect.objectContaining({
    body: JSON.stringify({ sessionId: "session-1", parameterId: "param-1" })
  }));
});
```

Adapt `fetchMock`, `jsonResponse`, and `nodeOperationDto` helper names to the existing test file.

- [ ] **Step 3: Run frontend infrastructure tests and verify failure**

Run:

```bash
npm test -- src/infrastructure/http/debuggingDtos.test.ts src/infrastructure/http/debuggingClient.test.ts src/application/debugging/debuggingRuntime.test.ts
```

Expected: FAIL because protocol and binding DTOs are not implemented.

- [ ] **Step 4: Update frontend types**

In `src/domain/debugging/types.ts`:

```ts
export type DebugConnectionProtocol = "hdc" | "adb";
export type DebugParameterBindingStatus = "configured" | "missing" | "disabled";

export type DebugParameterNodeBinding = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugParameterAccessMode;
  enabled: boolean;
  notes?: string;
};
```

Extend `DebugParameter`:

```ts
selectedProtocol?: DebugConnectionProtocol;
bindingStatus?: DebugParameterBindingStatus;
bindingDisabledReason?: string;
bindings?: DebugParameterNodeBinding[];
```

Keep `nodePath` and `accessMode` for compatibility.

In `src/application/ports/DebuggingGateway.ts`, add protocol fields:

```ts
import type { DebugConnectionProtocol } from "@/domain/debugging/types";

export type DeviceTarget = {
  id: string;
  deviceId?: string;
  protocol?: DebugConnectionProtocol;
  label: string;
  targetRef?: string;
  status?: "detected" | "lost";
};

export type DetectTargetsInput = {
  projectId?: string;
  deviceId?: string;
  protocol?: DebugConnectionProtocol;
};

export type DebugSessionSnapshot = {
  id: string;
  projectId: string;
  deviceId: string;
  targetId: string;
  protocol?: DebugConnectionProtocol;
  status: "active" | "closed";
  startedAt: string;
  endedAt: string | null;
};
```

- [ ] **Step 5: Update DTOs and client**

In `src/infrastructure/http/debuggingDtos.ts`, extend DTOs:

```ts
export type DebugParameterNodeBindingDto = {
  protocol: "hdc" | "adb";
  nodePath: string;
  accessMode: "RO" | "WO" | "RW";
  enabled: boolean;
  notes?: string | null;
};

export type DebugParameterDto = {
  ...
  nodePath?: string;
  accessMode?: "RO" | "WO" | "RW";
  selectedBinding?: DebugParameterNodeBindingDto | null;
  bindings?: DebugParameterNodeBindingDto[];
};
```

Update mapper:

```ts
const selected = dto.selectedBinding;
const bindingStatus = selected ? (selected.enabled ? "configured" : "disabled") : "missing";
return {
  ...,
  nodePath: selected?.enabled ? selected.nodePath : dto.nodePath ?? "",
  accessMode: selected?.enabled ? selected.accessMode : dto.accessMode ?? "RO",
  selectedProtocol: selected?.protocol,
  bindingStatus,
  bindings: dto.bindings?.map((binding) => ({
    protocol: binding.protocol,
    nodePath: binding.nodePath,
    accessMode: binding.accessMode,
    enabled: binding.enabled,
    notes: binding.notes ?? undefined
  }))
};
```

In `src/infrastructure/http/debuggingClient.ts`:

- add `protocol` query to `buildParametersPath`.
- send `protocol` in `detectTargets` and `createSession`.
- for read/write, omit `nodePath` when `parameterId` exists:

```ts
function bindingAwareReadPayload(input: ReadNodeInput) {
  return input.parameterId
    ? { sessionId: input.sessionId, parameterId: input.parameterId }
    : input;
}
```

- [ ] **Step 6: Update runtime actions**

In `src/application/debugging/debuggingRuntime.ts`, update `detectAndStartSession` signature:

```ts
detectAndStartSession(projectId: string, options?: { protocol?: DebugConnectionProtocol }): Promise<{ session: DebugSessionSnapshot; target: DeviceTarget }>;
```

API mode:

```ts
const protocol = options?.protocol ?? "hdc";
const [target] = await api.detectTargets({ projectId, protocol });
const session = await api.createSession({
  projectId,
  deviceId: target.deviceId ?? target.id,
  targetId: target.id,
  protocol
});
```

Mock mode should include `protocol` on the target/session.

- [ ] **Step 7: Run frontend infrastructure tests**

Run:

```bash
npm test -- src/infrastructure/http/debuggingDtos.test.ts src/infrastructure/http/debuggingClient.test.ts src/application/debugging/debuggingRuntime.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/domain/debugging/types.ts src/application/ports/DebuggingGateway.ts src/application/debugging/debuggingRuntime.ts src/application/debugging/debuggingRuntime.test.ts src/infrastructure/http/debuggingDtos.ts src/infrastructure/http/debuggingDtos.test.ts src/infrastructure/http/debuggingClient.ts src/infrastructure/http/debuggingClient.test.ts
git commit -m "feat: add frontend debugging protocol contract"
```

Expected: commit succeeds.

## Task 7: Node Debugging Protocol Switch UI

**Files:**
- Modify: `src/NodeDebuggingPage.tsx`
- Modify: `src/NodeDebuggingPage.test.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write UI tests**

Add to `src/NodeDebuggingPage.test.tsx`:

```tsx
it("passes the selected protocol to API target detection", async () => {
  const debuggingActions = createDebuggingActions();
  render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

  fireEvent.click(await screen.findByRole("button", { name: "ADB" }));
  fireEvent.click(screen.getByRole("button", { name: /重新检测/ }));

  await waitFor(() => expect(debuggingActions.detectAndStartSession).toHaveBeenLastCalledWith(
    userState.activeProjectId,
    { protocol: "adb" }
  ));
});

it("clears the active session when switching protocol", async () => {
  const debuggingActions = createDebuggingActions();
  render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

  expect(await screen.findByText(/在线 · API Gateway Target/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "ADB" }));

  expect(screen.getByText(/切换协议后需要重新检测设备/)).toBeInTheDocument();
  expect(screen.getByText(/离线 · ADB 设备/)).toBeInTheDocument();
});

it("disables rows that are missing a binding for the selected protocol", () => {
  const missingBindingState = {
    ...userState,
    debugParameters: [{
      ...userState.debugParameters[0],
      nodePath: "",
      bindingStatus: "missing" as const,
      selectedProtocol: "adb" as const
    }]
  };
  const debuggingActions = createDebuggingActions({ detectAndStartSession: vi.fn(() => new Promise<never>(() => undefined)) });

  render(<NodeDebuggingPage state={missingBindingState} debuggingActions={debuggingActions} />);

  expect(screen.getByText("未配置该协议节点")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /选择/ })).toBeDisabled();
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
npm test -- src/NodeDebuggingPage.test.tsx
```

Expected: FAIL because protocol control and binding disabled copy do not exist.

- [ ] **Step 3: Add protocol state and selector**

In `src/NodeDebuggingPage.tsx`, add:

```ts
import type { DebugConnectionProtocol } from "./domain/debugging/types";

const protocolStorageKey = "wiseeff.nodeDebugging.protocol";

function readInitialProtocol(): DebugConnectionProtocol {
  return window.localStorage.getItem(protocolStorageKey) === "adb" ? "adb" : "hdc";
}
```

Inside component:

```ts
const [protocol, setProtocol] = useState<DebugConnectionProtocol>(readInitialProtocol);
```

Add handler:

```ts
const switchProtocol = (nextProtocol: DebugConnectionProtocol) => {
  if (nextProtocol === protocol) return;
  window.localStorage.setItem(protocolStorageKey, nextProtocol);
  setProtocol(nextProtocol);
  setTarget(undefined);
  setActiveTargetId(undefined);
  setActiveSessionId(undefined);
  setSessionStartedAt(null);
  setConnectionError("切换协议后需要重新检测设备");
  setDetectDiagnosticError("");
  autoReadSignatureRef.current = "";
};
```

Render segmented buttons before `NodeSessionSummaryCard`:

```tsx
<div className="protocol-switch" role="group" aria-label="连接协议">
  {(["hdc", "adb"] as const).map((item) => (
    <button
      key={item}
      type="button"
      className={protocol === item ? "protocol-switch-button active" : "protocol-switch-button"}
      aria-pressed={protocol === item}
      onClick={() => switchProtocol(item)}
    >
      {item.toUpperCase()}
    </button>
  ))}
</div>
```

- [ ] **Step 4: Pass protocol to detect and copy**

Update detect:

```ts
const result = await debuggingActions.detectAndStartSession(state.activeProjectId, { protocol }) as DetectResultWithOperation;
```

Update local HDC fallback to prevent ADB local bridge expectations:

```ts
if (!debuggingActions && protocol === "adb") {
  throw new Error("ADB 调试需要 API 模式后端 gateway。");
}
```

Update hardcoded HDC copy to use `protocol.toUpperCase()`.

- [ ] **Step 5: Add binding disabled reason**

Add helpers:

```ts
function bindingUnavailableReason(row: RuntimeRow) {
  if (row.bindingStatus === "missing") return "未配置该协议节点";
  if (row.bindingStatus === "disabled") return "该协议节点已停用";
  if (!row.nodePath) return "节点不可用";
  return "";
}
```

Update `canRead` and `canWrite` to require `bindingStatus !== "missing"` and `bindingStatus !== "disabled"` when present.

Render reason in current value/status cells:

```tsx
{bindingUnavailableReason(row) ? <small className="node-row-error">{bindingUnavailableReason(row)}</small> : null}
```

- [ ] **Step 6: Add styles**

In `src/styles.css`:

```css
.protocol-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  padding: 3px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--surface-subtle);
}

.protocol-switch-button {
  min-height: 32px;
  min-width: 56px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-weight: 700;
  cursor: pointer;
}

.protocol-switch-button.active {
  background: var(--surface);
  color: var(--text-strong);
  box-shadow: 0 1px 3px rgb(15 23 42 / 12%);
}
```

Use existing CSS variables in the file. If names differ, choose existing neutral surface/border/text variables.

- [ ] **Step 7: Run UI tests**

Run:

```bash
npm test -- src/NodeDebuggingPage.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/NodeDebuggingPage.tsx src/NodeDebuggingPage.test.tsx src/styles.css
git commit -m "feat: add node debugging protocol switch"
```

Expected: commit succeeds.

## Task 8: Admin Binding Management UI And Reducer

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/DebuggingPage.test.tsx`
- Modify: `src/reducer.debugging.test.ts`
- Modify: `src/mockData.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write reducer tests**

Add to `src/reducer.debugging.test.ts`:

```ts
it("updates HDC and ADB node bindings separately for debug parameters", () => {
  const target = base.debugParameters[0];
  const next = reducer(base, {
    type: "UPDATE_DEBUG_PARAMETER_NODE_BINDING",
    parameterId: target.id,
    protocol: "adb",
    binding: {
      protocol: "adb",
      nodePath: "/sys/class/power_supply/battery/adb_current",
      accessMode: "RW",
      enabled: true,
      notes: "ADB lab path"
    }
  });

  const updated = next.configDraft.debugParameters.find((parameter) => parameter.id === target.id);
  expect(updated?.bindings).toEqual(expect.arrayContaining([
    expect.objectContaining({ protocol: "adb", nodePath: "/sys/class/power_supply/battery/adb_current", accessMode: "RW", enabled: true })
  ]));
  expect(updated?.nodePath).toBe(target.nodePath);
});
```

- [ ] **Step 2: Write Admin UI tests**

Add to `src/DebuggingPage.test.tsx` under `/debugging-admin 节点元数据`:

```tsx
it("shows separate HDC and ADB binding editors", () => {
  window.history.replaceState(null, "", "/debugging-admin");
  renderDebuggingPage({ state: adminState });

  expect(screen.getByText("HDC 节点绑定")).toBeInTheDocument();
  expect(screen.getByText("ADB 节点绑定")).toBeInTheDocument();
  expect(screen.getAllByLabelText("节点路径")).toHaveLength(2);
});
```

Use the existing render helper name from the file.

- [ ] **Step 3: Run reducer/Admin tests and verify failure**

Run:

```bash
npm test -- src/reducer.debugging.test.ts src/DebuggingPage.test.tsx
```

Expected: FAIL because binding reducer/UI do not exist.

- [ ] **Step 4: Add reducer action**

In `src/App.tsx`, add action type:

```ts
| {
    type: "UPDATE_DEBUG_PARAMETER_NODE_BINDING";
    parameterId: string;
    protocol: DebugConnectionProtocol;
    binding: DebugParameterNodeBinding;
  }
```

Add reducer case:

```ts
case "UPDATE_DEBUG_PARAMETER_NODE_BINDING": {
  const updateParameter = (parameter: DebugParameter): DebugParameter => {
    if (parameter.id !== action.parameterId) return parameter;
    const bindings = parameter.bindings ?? [{
      protocol: "hdc" as const,
      nodePath: parameter.nodePath,
      accessMode: parameter.accessMode,
      enabled: Boolean(parameter.nodePath)
    }];
    const nextBindings = bindings.some((binding) => binding.protocol === action.protocol)
      ? bindings.map((binding) => binding.protocol === action.protocol ? action.binding : binding)
      : [...bindings, action.binding];
    return { ...parameter, bindings: nextBindings };
  };
  const configDraft = {
    ...state.configDraft,
    debugParameters: state.configDraft.debugParameters.map(updateParameter)
  };
  return {
    ...state,
    configDraft,
    debugParameters: state.debugParameters.map(updateParameter)
  };
}
```

- [ ] **Step 5: Initialize bindings in mock data**

In `src/mockData.ts`, where `debugParameters` are derived, add a default HDC binding for existing node metadata:

```ts
bindings: parameter.bindings ?? [{
  protocol: "hdc",
  nodePath: parameter.nodePath,
  accessMode: parameter.accessMode,
  enabled: Boolean(parameter.nodePath)
}]
```

Preserve current `nodePath` and `accessMode`.

- [ ] **Step 6: Add Admin binding editor UI**

Inside `DebuggingAdminPage` in `src/App.tsx`, replace the single node path/access mode editor with two binding panels. Add local helper:

```ts
const bindingFor = (protocol: DebugConnectionProtocol): DebugParameterNodeBinding => {
  const existing = selectedParameter.bindings?.find((binding) => binding.protocol === protocol);
  return existing ?? {
    protocol,
    nodePath: protocol === "hdc" ? selectedParameter.nodePath : "",
    accessMode: protocol === "hdc" ? selectedParameter.accessMode : "RO",
    enabled: protocol === "hdc" ? Boolean(selectedParameter.nodePath) : false,
    notes: ""
  };
};

const updateBinding = (protocol: DebugConnectionProtocol, patch: Partial<DebugParameterNodeBinding>) => {
  const current = bindingFor(protocol);
  dispatch({
    type: "UPDATE_DEBUG_PARAMETER_NODE_BINDING",
    parameterId: selectedParameter.id,
    protocol,
    binding: { ...current, ...patch, protocol }
  });
};
```

Render:

```tsx
{(["hdc", "adb"] as const).map((protocol) => {
  const binding = bindingFor(protocol);
  return (
    <section className="debug-binding-card" key={protocol} aria-label={`${protocol.toUpperCase()} 节点绑定`}>
      <div className="debug-binding-card-head">
        <strong>{protocol.toUpperCase()} 节点绑定</strong>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={binding.enabled}
            onChange={(event) => updateBinding(protocol, { enabled: event.target.checked })}
          />
          启用
        </label>
      </div>
      <label className="field-label">
        节点路径
        <input
          aria-label="节点路径"
          value={binding.nodePath}
          onChange={(event) => updateBinding(protocol, { nodePath: event.target.value })}
        />
      </label>
      <label className="field-label">
        访问模式
        <select
          aria-label="访问模式"
          value={binding.accessMode}
          onChange={(event) => updateBinding(protocol, { accessMode: event.target.value as DebugParameter["accessMode"] })}
        >
          <option value="RO">RO</option>
          <option value="WO">WO</option>
          <option value="RW">RW</option>
        </select>
      </label>
      <label className="field-label">
        备注
        <textarea
          aria-label="绑定备注"
          value={binding.notes ?? ""}
          onChange={(event) => updateBinding(protocol, { notes: event.target.value })}
        />
      </label>
    </section>
  );
})}
```

If existing form uses custom `Select` component, use that component instead of raw `select` to match style.

- [ ] **Step 7: Add styles**

In `src/styles.css`:

```css
.debug-binding-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--surface);
}

.debug-binding-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
}
```

Use existing CSS variables if names differ.

- [ ] **Step 8: Run reducer/Admin tests**

Run:

```bash
npm test -- src/reducer.debugging.test.ts src/DebuggingPage.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add src/App.tsx src/DebuggingPage.test.tsx src/reducer.debugging.test.ts src/mockData.ts src/styles.css
git commit -m "feat: manage protocol node bindings"
```

Expected: commit succeeds.

## Task 9: API Contract, Acceptance Coverage, And Device-Lab Smoke

**Files:**
- Modify: `e2e/debugging.api.spec.ts`
- Modify: `e2e/acceptance/debugging-simulator.acceptance.spec.ts`
- Modify: `e2e/acceptance/hdc-device-lab.acceptance.spec.ts`
- Create: `e2e/acceptance/adb-device-lab.acceptance.spec.ts`
- Modify: `e2e/acceptance/operationMatrix.ts`
- Modify: `docs/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/zh-CN/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/developer/user-operation-coverage-matrix.md`
- Modify: `docs/zh-CN/developer/user-operation-coverage-matrix.md`

- [ ] **Step 1: Add ADB operation matrix entry**

In `e2e/acceptance/operationMatrix.ts`, add after `HDC-LAB-001`:

```ts
{
  id: "ADB-LAB-001",
  priority: "P1",
  area: "debugging",
  route: "/node-debugging",
  roles: ["Hardware Committer", "Admin"],
  action: "Run the real ADB device-lab read/write smoke when explicitly enabled.",
  coverage: "conditional",
  acceptanceIds: ["ADB-LAB-001"],
  specFiles: ["e2e/acceptance/adb-device-lab.acceptance.spec.ts"],
  assertions: ["ui", "api", "audit"],
  deferralReason: "Requires DEBUG_DEVICE_GATEWAY_MODE=adb or multi and ADB_DEVICE_LAB_AVAILABLE=true with hardware attached."
}
```

- [ ] **Step 2: Update coverage docs**

Add `ADB-LAB-001` to `docs/developer/browser-acceptance-coverage-map.md`:

```md
| `ADB-LAB-001` | F | No | Real ADB device lab read/write smoke runs when explicitly enabled. | `e2e/acceptance/adb-device-lab.acceptance.spec.ts` |
```

Add equivalent Chinese row to `docs/zh-CN/developer/browser-acceptance-coverage-map.md`.

Regenerate or manually update user operation matrices to include the new operation row.

- [ ] **Step 3: Create ADB device-lab acceptance spec**

Create `e2e/acceptance/adb-device-lab.acceptance.spec.ts` by adapting `e2e/acceptance/hdc-device-lab.acceptance.spec.ts`:

- Use markers:

```ts
// @acceptance ADB-LAB-001
// @operation ADB-LAB-001
```

- Gate on:

```ts
test.skip(process.env.ADB_DEVICE_LAB_AVAILABLE !== "true", "ADB device-lab acceptance requires ADB_DEVICE_LAB_AVAILABLE=true.");
test.skip(!["adb", "multi"].includes(process.env.DEBUG_DEVICE_GATEWAY_MODE ?? ""), "ADB device-lab acceptance only runs in adb or multi gateway mode.");
```

- Required env vars:

```text
ADB_SMOKE_PROJECT_ID
ADB_SMOKE_DEVICE_ID
ADB_SMOKE_TARGET_REF
ADB_SMOKE_PARAMETER_ID
ADB_SMOKE_NODE_PATH
ADB_SMOKE_WRITE_VALUE
```

- Call detect/session/read/write/rollback APIs with `protocol: "adb"`.
- Assert audit/session/operation evidence includes `protocol=adb`.

- [ ] **Step 4: Update existing debugging API assertions**

In `e2e/debugging.api.spec.ts` and simulator/HDC acceptance specs:

- assert existing HDC/simulator-compatible flows still create `protocol: "hdc"` sessions or omit protocol only where legacy DTOs intentionally do so.
- update request bodies to include `protocol: "hdc"` for HDC target detection/session creation where explicit protocol clarity improves tests.

- [ ] **Step 5: Run coverage checks**

Run:

```bash
npm run acceptance:coverage
npm run acceptance:operation-matrix
```

Expected: PASS. If script names differ, inspect `package.json` and run the matching coverage/matrix commands.

- [ ] **Step 6: Commit**

Run:

```bash
git add e2e/debugging.api.spec.ts e2e/acceptance/debugging-simulator.acceptance.spec.ts e2e/acceptance/hdc-device-lab.acceptance.spec.ts e2e/acceptance/adb-device-lab.acceptance.spec.ts e2e/acceptance/operationMatrix.ts docs/developer/browser-acceptance-coverage-map.md docs/zh-CN/developer/browser-acceptance-coverage-map.md docs/developer/user-operation-coverage-matrix.md docs/zh-CN/developer/user-operation-coverage-matrix.md
git commit -m "test: add adb debugging acceptance coverage"
```

Expected: commit succeeds.

## Task 10: Documentation And Generated Schema

**Files:**
- Modify: `docs/FRONTEND.md`
- Modify: `docs/zh-CN/frontend.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/zh-CN/SECURITY.md`
- Modify: `docs/design-docs/domain-model.md`
- Modify: `docs/zh-CN/design-docs/domain-model.md`
- Modify: `docs/design-docs/api-contract.md`
- Modify: `docs/zh-CN/design-docs/api-contract.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `docs/zh-CN/design-docs/testing-strategy.md`
- Modify: `docs/developer/environment-variables.md`
- Modify: `docs/zh-CN/developer/environment-variables.md`
- Create: `docs/runbooks/adb-device-lab.md`
- Create: `docs/zh-CN/runbooks/adb-device-lab.md`
- Modify: `docs/runbooks/README.md`
- Modify: `docs/zh-CN/runbooks/README.md`
- Modify: `docs/generated/db-schema.md`

- [ ] **Step 1: Update frontend docs**

In `docs/FRONTEND.md`, replace the Debugging Gateway section with protocol-aware language:

```md
`/node-debugging` lets operators choose the debugging protocol for the current session: HDC or ADB. API mode sends the selected protocol to target detection and session creation, then read/write calls use the session protocol and server-side node bindings. Rows without an enabled binding for the selected protocol are visible but read/write disabled.
```

Add equivalent Chinese text to `docs/zh-CN/frontend.md`.

- [ ] **Step 2: Update security docs**

In `docs/SECURITY.md`, update Device Safety:

```md
M7 ADB/HDC protocol support keeps both command families behind the backend `DebugDeviceGatewayRegistry`. Frontend clients select `hdc` or `adb` for session creation, but node reads, writes, snapshots, rollback, leases, and audit derive the protocol from the persisted session and node binding. ADB commands execute as `adb` from the backend PATH with argv process execution, timeout normalization, and readback mismatch reporting.
```

Add equivalent Chinese text to `docs/zh-CN/SECURITY.md`.

- [ ] **Step 3: Update domain/API/testing docs**

Update:

- `docs/design-docs/domain-model.md`: add `DebugConnectionProtocol` and `debugging_parameter_node_bindings`.
- `docs/design-docs/api-contract.md`: document `protocol` on detect/session DTOs and binding-aware read/write without frontend `nodePath`.
- `docs/design-docs/testing-strategy.md`: document default mock/unit coverage plus conditional ADB device-lab smoke.

Mirror changes in Chinese companion files.

- [ ] **Step 4: Update env docs and examples**

In `docs/developer/environment-variables.md` add:

```md
| `ADB_TIMEOUT_MS` | `5000` | ADB adapter | Command timeout budget. |
```

Change `DEBUG_DEVICE_GATEWAY_MODE` row to mention `simulator`, `hdc`, `adb`, and `multi`.

Mirror in `docs/zh-CN/developer/environment-variables.md`.

- [ ] **Step 5: Add ADB runbooks**

Create `docs/runbooks/adb-device-lab.md`:

```md
# ADB Device Lab Runbook

> Chinese: [Chinese](../zh-CN/runbooks/adb-device-lab.md)

Use this runbook to collect real-device evidence for the ADB gateway path.

## Required Inputs

- `DEBUG_DEVICE_GATEWAY_MODE=adb` or `DEBUG_DEVICE_GATEWAY_MODE=multi`
- `ADB_DEVICE_LAB_AVAILABLE=true`
- `ADB_SMOKE_PROJECT_ID`
- `ADB_SMOKE_DEVICE_ID`
- `ADB_SMOKE_TARGET_REF`
- `ADB_SMOKE_PARAMETER_ID`
- `ADB_SMOKE_NODE_PATH`
- `ADB_SMOKE_WRITE_VALUE`
- optional `ADB_SMOKE_EXPECT_READ_PATTERN`
- optional `ADB_SMOKE_USER_ID`

## Procedure

1. Confirm the device is in the approved lab environment.
2. Confirm the target node is safe to read and write through ADB.
3. Start the API with ADB or multi gateway mode.
4. Run the ADB device-lab acceptance spec.
5. Verify target detection.
6. Verify node read.
7. Verify node write with readback.
8. Verify snapshot rollback.
9. Record timeout/offline behavior if the lab procedure allows safe simulation.
10. Record stderr/nonzero failure normalization if the lab procedure allows safe simulation.

## Acceptance

Evidence must show command timestamps, target and node identifiers, requested value, previous/readback value, rollback value, audit event id or request id, and failure cases tested or explicitly skipped.
```

Create the Chinese companion with the same sections in Chinese.

Add links in runbook README files.

- [ ] **Step 6: Regenerate schema docs**

Run the existing schema summary generator if present. If there is no generator command, update `docs/generated/db-schema.md` manually to include:

- `debugging_parameter_node_bindings`
- `debugging_targets.protocol`
- `debugging_sessions.protocol`
- `node_operations.protocol`

Record the method used in the task notes.

- [ ] **Step 7: Run documentation check**

Run:

```bash
node --import tsx ./scripts/check-doc-governance.ts
```

Expected: PASS.

Also try:

```bash
npm run docs:check
```

Expected: PASS in normal environments. If it fails with `tsx` IPC `EPERM`, record the blocker and the successful `node --import tsx` equivalent.

- [ ] **Step 8: Commit**

Run:

```bash
git add docs/FRONTEND.md docs/zh-CN/frontend.md docs/SECURITY.md docs/zh-CN/SECURITY.md docs/design-docs/domain-model.md docs/zh-CN/design-docs/domain-model.md docs/design-docs/api-contract.md docs/zh-CN/design-docs/api-contract.md docs/design-docs/testing-strategy.md docs/zh-CN/design-docs/testing-strategy.md docs/developer/environment-variables.md docs/zh-CN/developer/environment-variables.md docs/runbooks/adb-device-lab.md docs/zh-CN/runbooks/adb-device-lab.md docs/runbooks/README.md docs/zh-CN/runbooks/README.md docs/generated/db-schema.md
git commit -m "docs: document adb debugging protocol"
```

Expected: commit succeeds.

## Task 11: Browser Verification And Final Gates

**Files:**
- No new source files expected.
- Produce screenshots under `work/ui-checks/`.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
npm run test:server -- server/modules/debugging/status.test.ts server/modules/debugging/schemas.test.ts server/modules/debugging/repository.test.ts server/modules/debugging/gatewayRegistry.test.ts server/modules/debugging/adbGateway.test.ts server/modules/debugging/hdcGateway.test.ts server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts server/config/env.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
npm test -- src/infrastructure/http/debuggingDtos.test.ts src/infrastructure/http/debuggingClient.test.ts src/application/debugging/debuggingRuntime.test.ts src/NodeDebuggingPage.test.tsx src/DebuggingPage.test.tsx src/reducer.debugging.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run broader verification**

Run:

```bash
npm run test:all
npm run build
node --import tsx ./scripts/check-doc-governance.ts
```

Expected: PASS.

- [ ] **Step 4: Start local dev server**

Run:

```bash
npm run dev
```

Expected: Vite serves a local URL, usually `http://127.0.0.1:5173`.

- [ ] **Step 5: Browser-check `/node-debugging` protocol UI**

Run Playwright CLI checks:

```bash
playwright-cli -s=adb-hdc-debug open http://127.0.0.1:5173/node-debugging
playwright-cli -s=adb-hdc-debug resize 1440 900
playwright-cli -s=adb-hdc-debug snapshot
playwright-cli -s=adb-hdc-debug screenshot --filename=work/ui-checks/20260621-adb-hdc-node-debugging-desktop.png
playwright-cli -s=adb-hdc-debug resize 768 1024
playwright-cli -s=adb-hdc-debug snapshot
playwright-cli -s=adb-hdc-debug screenshot --filename=work/ui-checks/20260621-adb-hdc-node-debugging-tablet.png
playwright-cli -s=adb-hdc-debug resize 390 844
playwright-cli -s=adb-hdc-debug snapshot
playwright-cli -s=adb-hdc-debug screenshot --filename=work/ui-checks/20260621-adb-hdc-node-debugging-mobile.png
playwright-cli -s=adb-hdc-debug console error
```

Interactions to exercise:

- Click `ADB`.
- Confirm the page says protocol switching requires redetection.
- Click `HDC`.
- Open a row with a configured binding.
- Confirm no raw `nodePath` appears in normal row/details text.
- Confirm rows missing selected-protocol binding are disabled if seeded/mock data includes one.

Expected: no console errors, no overlap, no horizontal scrolling, no squeezed buttons.

- [ ] **Step 6: Browser-check `/debugging-admin` binding UI**

Run:

```bash
playwright-cli -s=adb-hdc-debug open http://127.0.0.1:5173/debugging-admin
playwright-cli -s=adb-hdc-debug resize 1440 900
playwright-cli -s=adb-hdc-debug snapshot
playwright-cli -s=adb-hdc-debug screenshot --filename=work/ui-checks/20260621-adb-hdc-debugging-admin-desktop.png
playwright-cli -s=adb-hdc-debug resize 768 1024
playwright-cli -s=adb-hdc-debug snapshot
playwright-cli -s=adb-hdc-debug screenshot --filename=work/ui-checks/20260621-adb-hdc-debugging-admin-tablet.png
playwright-cli -s=adb-hdc-debug resize 390 844
playwright-cli -s=adb-hdc-debug snapshot
playwright-cli -s=adb-hdc-debug screenshot --filename=work/ui-checks/20260621-adb-hdc-debugging-admin-mobile.png
playwright-cli -s=adb-hdc-debug console error
playwright-cli -s=adb-hdc-debug close
```

Interactions to exercise:

- Toggle ADB binding enabled.
- Edit ADB node path and access mode.
- Confirm HDC binding remains unchanged.
- Confirm labels and fields do not overlap at all three viewports.

Expected: no console errors, no overlap, no horizontal overflow.

- [ ] **Step 7: Run acceptance checks**

Run:

```bash
npm run acceptance:coverage
npm run acceptance:operation-matrix
```

Expected: PASS.

If a full browser acceptance run is feasible in the environment, run:

```bash
npm run acceptance:browser
```

Expected: PASS or only conditional hardware specs skipped for missing explicit device-lab env flags.

- [ ] **Step 8: Final commit**

If browser screenshots under `work/ui-checks/` are intended as local evidence only and ignored by git, do not force-add them. Commit any final test/doc fixes:

```bash
git status --short
git add <changed tracked files>
git commit -m "test: verify adb hdc debugging protocol"
```

Expected: commit succeeds if there are final tracked changes. If no tracked changes remain, record "no final commit needed."

## Documentation Impact Matrix

| Area | Status | Files | Required action |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md`, `docs/zh-CN/README.md` | Update only if ADB/HDC protocol support becomes a new top-level map entry; otherwise record unchanged. |
| Planning docs | Update | `docs/exec-plans/active/2026-06-21-wiseeff-adb-hdc-debugging-protocol.md`, `docs/PLANS.md` | Keep this plan active during implementation; move to completed after verification. |
| Product specs | Review | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md`, Chinese companions | Update only if product-facing debugging workflow descriptions mention HDC-only behavior. |
| Architecture docs | Update | `docs/design-docs/domain-model.md`, `docs/zh-CN/design-docs/domain-model.md`, `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md`, `ARCHITECTURE.md` | Add protocol and node-binding model; update API contract. |
| Frontend/design docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Document protocol switching, selected-protocol bindings, and Admin binding management. |
| Security/governance docs | Update | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`, `docs/security/README.md` | Document ADB/HDC backend gateway boundary, no frontend command execution, session-derived protocol, and audit evidence. |
| Reliability/runbooks | Update | `docs/runbooks/adb-device-lab.md`, `docs/zh-CN/runbooks/adb-device-lab.md`, `docs/runbooks/README.md`, `docs/zh-CN/runbooks/README.md`, `docs/RELIABILITY.md` | Add ADB device-lab runbook and review reliability wording for gateway modes. |
| Quality/testing docs | Update | `docs/design-docs/testing-strategy.md`, `docs/zh-CN/design-docs/testing-strategy.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/zh-CN/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/zh-CN/developer/user-operation-coverage-matrix.md`, `docs/QUALITY_SCORE.md` | Add ADB conditional acceptance and operation coverage. |
| Developer env docs | Update | `.env.example`, `ops/self-hosted/.env.example`, `docs/developer/environment-variables.md`, `docs/zh-CN/developer/environment-variables.md` | Add `ADB_TIMEOUT_MS` and document gateway modes. |
| Generated artifacts | Update | `docs/generated/db-schema.md` | Regenerate or update after migration. |
| References | Review | `docs/references/` | Update only if a reference describes HDC-only debugging. |
| API docs | Review | `docs/api/README.md`, `docs/api/examples.md`, Chinese companions | Update if public examples include debugging target/session/read/write payloads. |

## Documentation Update Gate

Before moving this plan to `docs/exec-plans/completed/`:

- [ ] Every `Update` row in the Documentation Impact Matrix has been edited in English and Chinese where required.
- [ ] Every `Review` row has either been updated or recorded as unchanged with evidence in the completed-plan notes.
- [ ] `docs/generated/db-schema.md` reflects migration `0017_adb_hdc_debugging_protocol.sql`.
- [ ] `node --import tsx ./scripts/check-doc-governance.ts` passes.
- [ ] `npm run docs:check` passes, or an environment-specific `tsx` IPC blocker is recorded with the successful equivalent command.
- [ ] Browser acceptance coverage includes `ADB-LAB-001` and operation matrix docs are updated.
- [ ] Any deferred work is added to `docs/exec-plans/tech-debt-tracker.md`.

## Plan Self-Review

- Spec coverage: Tasks 1-5 cover backend protocol, binding data model, ADB adapter, API/service flow, env, and seeding. Tasks 6-8 cover frontend protocol selection and Admin binding management. Task 9 covers acceptance and device-lab evidence. Task 10 covers docs and generated schema. Task 11 covers final verification.
- Placeholder scan: This plan intentionally avoids `TBD`/`TODO` language and gives exact file paths, code snippets, commands, and expected outcomes for each task.
- Type consistency: `DebugConnectionProtocol`, `protocol`, `debugging_parameter_node_bindings`, and `ADB-LAB-001` names are used consistently across tasks.
