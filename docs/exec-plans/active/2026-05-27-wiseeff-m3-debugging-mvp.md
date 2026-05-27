# WiseEff M3 Debugging MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first persistent, auditable debugging loop: detect a simulator target, read nodes, write nodes with validation and readback, create snapshots, rollback from valid snapshots, and drive the existing debugging UI through API mode.

**Architecture:** M3 adds a `server/modules/debugging` module beside the M1/M2 backend modules. The main API owns auth, RBAC, validation, sessions, snapshots, node-operation records, and audit writes; the gateway adapter owns simulator/HDC/device communication behind a narrow `DebugDeviceGateway` interface. The frontend keeps mock mode and local HDC helpers for development, but `VITE_WISEEFF_RUNTIME_MODE=api` uses an HTTP `DebuggingGateway` plus a runtime coordinator to hydrate devices, parameters, sessions, operations, and rollback state.

**Tech Stack:** TypeScript, Node HTTP server, PostgreSQL, Zod, in-memory simulator gateway for M3, React 19, Vite, Vitest, Testing Library, Playwright smoke tests.

---

## Scope Boundary

M3 includes:

- Persistent debugging devices, detected targets, debug parameters, sessions, snapshots, node operations, and debug events.
- A deterministic simulator gateway that supports target detection, node reads, node writes, offline failures, read-only failures, range failures, and readback mismatch failures.
- Backend permission checks for debugging read, write, rollback, and admin-only catalog operations.
- Server-side validation for online device state, node access mode, numeric ranges, high-risk confirmation, snapshot existence, and rollback eligibility.
- Audit events for target detection, session creation, node read, node write success, node write failure, readback mismatch, snapshot creation, and rollback.
- API mode for `/debugging`, `/node-debugging`, and `/debugging-admin` using the `DebuggingGateway` port while preserving mock mode behavior and existing demos.
- E2E smoke against simulator mode: detect target, read node, write node, verify readback, produce failure reason for a bad write, and rollback from a valid snapshot.

M3 does not include:

- Direct production HDC/ADB device access from the backend. The M3 gateway is simulator-first; real HDC remains behind the existing local Vite bridge and a future adapter seam.
- Distributed gateway workers, remote device reservation, multi-operator locking, or long-running device lease management.
- Agent-driven write approvals. M3 accepts explicit UI confirmation/approval tokens; M4 will route mutating Agent tools through approval records.
- Full debugging parameter catalog CRUD in API mode. M3 seeds and reads the catalog; browser-only config editing remains mock/development behavior.
- Parameter-management writeback from debugging results. M3 records node operations and snapshots, but does not create parameter change requests automatically.

## Success Criteria

- With `VITE_WISEEFF_RUNTIME_MODE=api`, `/node-debugging` can detect the seeded simulator target, read all readable nodes, write an RW node, and show a verified readback value after page refresh.
- A write to a read-only node, offline target, out-of-range value, or readback-mismatch node returns a readable failure reason, persists a `node_operations` row, creates a `debug_events` row, and writes an audit event.
- A high-risk write requires an explicit confirmation token and creates a pre-write snapshot before mutating the simulator node value.
- Rollback only succeeds for a valid snapshot owned by the same session/project, writes the previous values through the gateway, marks rollback operation results, and invalidates or consumes the snapshot according to the persisted status.
- `/debugging` and `/debugging-admin` continue to work in mock mode and do not perform browser-only production writes in API mode.
- `npm run test:all`, `npm run build`, and the M3 Playwright smoke pass.

## Contract And Status Mapping

M3 locks the debugging API shape as:

```text
GET  /api/v1/debugging/devices
POST /api/v1/debugging/targets/detect
GET  /api/v1/debugging/parameters
POST /api/v1/debugging/sessions
GET  /api/v1/debugging/sessions/:sessionId
GET  /api/v1/debugging/sessions/:sessionId/events
POST /api/v1/debugging/nodes/read
POST /api/v1/debugging/nodes/write
POST /api/v1/debugging/snapshots/:snapshotId/rollback
```

Backend status codes stay stable lowercase. Frontend DTO mappers convert them to the existing UI labels and runtime statuses.

| Backend status | Frontend status | Meaning |
| --- | --- | --- |
| `online` | `已连接` | The simulator target is available for reads/writes. |
| `offline` | `未连接` | The target is known but not reachable. |
| `active` | active session | A debugging session can accept operations. |
| `closed` | closed session | A debugging session is retained for history only. |
| `pending` | `执行中` | Operation accepted and executing. |
| `succeeded` | `成功` | Operation completed and persisted. |
| `failed` | `失败` | Operation failed with `failureReason`. |
| `readback_mismatch` | `失败` | Write completed but readback did not match the target value. |
| `valid` | rollback enabled | Snapshot can still be used. |
| `consumed` | rollback disabled | Snapshot has already been used for rollback. |
| `invalid` | rollback disabled | Snapshot cannot be used because one or more entries are no longer safe. |

## File Structure

Create:

- `server/migrations/0005_m3_debugging.sql`
- `scripts/seed-m3-debugging.ts`
- `test-fixtures/debugging/simulator-state.json`
- `server/modules/debugging/types.ts`
- `server/modules/debugging/status.ts`
- `server/modules/debugging/status.test.ts`
- `server/modules/debugging/schemas.ts`
- `server/modules/debugging/schemas.test.ts`
- `server/modules/debugging/policy.ts`
- `server/modules/debugging/policy.test.ts`
- `server/modules/debugging/gateway.ts`
- `server/modules/debugging/simulator.ts`
- `server/modules/debugging/simulator.test.ts`
- `server/modules/debugging/repository.ts`
- `server/modules/debugging/repository.test.ts`
- `server/modules/debugging/service.ts`
- `server/modules/debugging/service.test.ts`
- `server/modules/debugging/routes.ts`
- `server/modules/debugging/routes.test.ts`
- `src/infrastructure/http/debuggingDtos.ts`
- `src/infrastructure/http/debuggingDtos.test.ts`
- `src/infrastructure/http/debuggingClient.ts`
- `src/infrastructure/http/debuggingClient.test.ts`
- `src/application/debugging/debuggingRuntime.ts`
- `src/application/debugging/debuggingRuntime.test.ts`
- `e2e/debugging.api.spec.ts`

Modify:

- `server/modules/auth/types.ts`
- `server/modules/auth/policy.ts`
- `server/modules/auth/policy.test.ts`
- `server/config/env.ts`
- `server/config/env.test.ts`
- `server/app.ts`
- `server/index.ts`
- `package.json`
- `playwright.config.ts`
- `src/application/ports/DebuggingGateway.ts`
- `src/infrastructure/device/hdcGateway.ts`
- `src/App.tsx`
- `src/app/routes.tsx`
- `src/DebuggingPage.tsx`
- `src/NodeDebuggingPage.tsx`
- `src/DebuggingPage.test.tsx`
- `src/NodeDebuggingPage.test.tsx`
- `src/reducer.debugging.test.ts`
- `src/infrastructure/device/hdcGateway.test.ts`
- `docs/design-docs/api-contract.md`
- `docs/design-docs/domain-model.md`
- `docs/design-docs/testing-strategy.md`
- `docs/FRONTEND.md`
- `docs/SECURITY.md`
- `docs/RELIABILITY.md`
- `docs/QUALITY_SCORE.md`
- `docs/generated/db-schema.md`
- `README.md`
- `docs/exec-plans/tech-debt-tracker.md`

---

### Task 1: Lock M3 Contract, Permissions, Port, And DTO Shape

**Purpose:** Freeze the API contract and frontend port before database and service work so routes, DTOs, runtime actions, and UI tests stay aligned.

**Files:**
- Modify: `docs/design-docs/api-contract.md`
- Modify: `server/modules/auth/types.ts`
- Modify: `server/modules/auth/policy.ts`
- Modify: `server/modules/auth/policy.test.ts`
- Create: `server/modules/debugging/types.ts`
- Create: `server/modules/debugging/status.ts`
- Create: `server/modules/debugging/status.test.ts`
- Create: `server/modules/debugging/schemas.ts`
- Create: `server/modules/debugging/schemas.test.ts`
- Create: `server/modules/debugging/policy.ts`
- Create: `server/modules/debugging/policy.test.ts`
- Modify: `src/application/ports/DebuggingGateway.ts`
- Create: `src/infrastructure/http/debuggingDtos.ts`
- Create: `src/infrastructure/http/debuggingDtos.test.ts`

- [ ] **Step 1: Expand backend debugging permissions**

Update `server/modules/auth/types.ts` so `BackendPermission` includes:

```ts
| "debugging:view"
| "debugging:read"
| "debugging:write"
| "debugging:rollback"
| "debugging:admin"
```

Keep the existing `"debugging:use"` permission for frontend compatibility.

Update `server/modules/auth/policy.ts`:

- `guest`: no debugging permissions.
- `hardware-user` and `software-user`: keep existing permissions and add `debugging:view`, `debugging:read`.
- `hardware-committer` and `software-committer`: add `debugging:view`, `debugging:read`, `debugging:write`, `debugging:rollback`.
- `admin`: add all debugging permissions.

Run:

```bash
npm run test:server -- server/modules/auth/policy.test.ts
```

Expected: FAIL until the permission expectations are updated.

- [ ] **Step 2: Add status helper tests**

Create `server/modules/debugging/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  debugAccessModes,
  debugDeviceStatuses,
  debugOperationStatuses,
  debugSnapshotStatuses,
  isTerminalNodeOperationStatus
} from "./status";

describe("debugging status helpers", () => {
  it("defines stable access mode and status codes", () => {
    expect(debugAccessModes).toEqual(["RO", "WO", "RW"]);
    expect(debugDeviceStatuses).toContain("online");
    expect(debugOperationStatuses).toEqual(["pending", "succeeded", "failed", "readback_mismatch"]);
    expect(debugSnapshotStatuses).toEqual(["valid", "consumed", "invalid"]);
  });

  it("identifies terminal operation states", () => {
    expect(isTerminalNodeOperationStatus("pending")).toBe(false);
    expect(isTerminalNodeOperationStatus("succeeded")).toBe(true);
    expect(isTerminalNodeOperationStatus("failed")).toBe(true);
    expect(isTerminalNodeOperationStatus("readback_mismatch")).toBe(true);
  });
});
```

Run:

```bash
npm run test:server -- server/modules/debugging/status.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement status and shared backend types**

Create `server/modules/debugging/status.ts`:

```ts
export const debugAccessModes = ["RO", "WO", "RW"] as const;
export const debugRiskLevels = ["Low", "Medium", "High"] as const;
export const debugDeviceStatuses = ["online", "offline", "unknown"] as const;
export const debugTargetStatuses = ["detected", "lost"] as const;
export const debugSessionStatuses = ["active", "closed"] as const;
export const debugOperationTypes = ["detect", "read", "write", "rollback"] as const;
export const debugOperationStatuses = ["pending", "succeeded", "failed", "readback_mismatch"] as const;
export const debugSnapshotStatuses = ["valid", "consumed", "invalid"] as const;

export type DebugAccessMode = (typeof debugAccessModes)[number];
export type DebugRiskLevel = (typeof debugRiskLevels)[number];
export type DebugDeviceStatus = (typeof debugDeviceStatuses)[number];
export type DebugOperationStatus = (typeof debugOperationStatuses)[number];
export type DebugSnapshotStatus = (typeof debugSnapshotStatuses)[number];

export function isTerminalNodeOperationStatus(status: DebugOperationStatus) {
  return status !== "pending";
}
```

Create `server/modules/debugging/types.ts` with database and service DTO types:

```ts
import type {
  DebugAccessMode,
  DebugDeviceStatus,
  DebugOperationStatus,
  DebugRiskLevel,
  DebugSnapshotStatus
} from "./status";

export type DebugDeviceRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  transport: "simulator" | "hdc";
  status: DebugDeviceStatus;
  firmware: string;
  lastSeenAt: string | null;
};

export type DebugTargetRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  deviceId: string;
  targetRef: string;
  label: string;
  status: "detected" | "lost";
  detectedAt: string;
};

export type DebugParameterRecord = {
  id: string;
  organizationId: string;
  projectId: string;
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

export type DebugSessionRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  deviceId: string;
  targetId: string;
  actorUserId: string;
  status: "active" | "closed";
  startedAt: string;
  endedAt: string | null;
};

export type DebugSnapshotEntry = {
  parameterId: string;
  nodePath: string;
  previousValue: string;
  targetValue: string;
};

export type DebugSnapshotRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  sessionId: string;
  operationId: string | null;
  status: DebugSnapshotStatus;
  risk: DebugRiskLevel;
  entries: DebugSnapshotEntry[];
  createdAt: string;
};

export type NodeOperationRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  sessionId: string;
  parameterId: string | null;
  nodePath: string;
  operationType: "detect" | "read" | "write" | "rollback";
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

- [ ] **Step 4: Add request schema tests**

Create `server/modules/debugging/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createDebugSessionBodySchema,
  detectTargetsBodySchema,
  readNodeBodySchema,
  rollbackSnapshotBodySchema,
  writeNodeBodySchema
} from "./schemas";

describe("debugging schemas", () => {
  it("accepts target detection input", () => {
    expect(detectTargetsBodySchema.parse({ projectId: "aurora", deviceId: "sim-device-1" })).toEqual({
      projectId: "aurora",
      deviceId: "sim-device-1"
    });
  });

  it("requires a node path for reads", () => {
    expect(() => readNodeBodySchema.parse({ sessionId: "dbg-1", nodePath: "" })).toThrow();
  });

  it("requires confirmation for high risk writes", () => {
    const parsed = writeNodeBodySchema.parse({
      sessionId: "dbg-1",
      parameterId: "dbg-fast-charge-current",
      nodePath: "/sys/class/power_supply/battery/constant_charge_current",
      value: "3100",
      readBack: true,
      confirmationToken: "confirm-high-risk-write"
    });

    expect(parsed.confirmationToken).toBe("confirm-high-risk-write");
  });

  it("validates rollback confirmation", () => {
    expect(rollbackSnapshotBodySchema.parse({ confirmationToken: "confirm-rollback" })).toEqual({
      confirmationToken: "confirm-rollback"
    });
  });

  it("requires project, device, and target when creating sessions", () => {
    expect(() => createDebugSessionBodySchema.parse({ projectId: "aurora" })).toThrow();
  });
});
```

Run:

```bash
npm run test:server -- server/modules/debugging/schemas.test.ts
```

Expected: FAIL until schemas exist.

- [ ] **Step 5: Implement request schemas**

Create `server/modules/debugging/schemas.ts`:

```ts
import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const listDebuggingParametersQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  module: nonEmptyString.optional(),
  risk: z.union([nonEmptyString, z.array(nonEmptyString)]).optional()
});

export const detectTargetsBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString.optional()
});

export const createDebugSessionBodySchema = z.object({
  projectId: nonEmptyString,
  deviceId: nonEmptyString,
  targetId: nonEmptyString
});

export const readNodeBodySchema = z.object({
  sessionId: nonEmptyString,
  parameterId: nonEmptyString.optional(),
  nodePath: nonEmptyString
});

export const writeNodeBodySchema = z.object({
  sessionId: nonEmptyString,
  parameterId: nonEmptyString,
  nodePath: nonEmptyString,
  value: nonEmptyString,
  readBack: z.boolean().default(true),
  approvalId: nonEmptyString.optional(),
  confirmationToken: nonEmptyString.optional(),
  expectedPreviousValue: nonEmptyString.optional()
});

export const rollbackSnapshotBodySchema = z.object({
  confirmationToken: nonEmptyString
});
```

- [ ] **Step 6: Add policy tests and helpers**

Create `server/modules/debugging/policy.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import { requireDebugRead, requireDebugRollback, requireDebugWrite } from "./policy";

const baseAuth: AuthContext = {
  user: {
    id: "u-1",
    organizationId: "org-1",
    name: "User",
    email: "user@example.com",
    title: "Engineer",
    isActive: true
  },
  organization: { id: "org-1", name: "Org" },
  roles: [{ projectId: "aurora", roleId: "hardware-user" }],
  permissions: ["parameter:view", "debugging:view", "debugging:read"]
};

describe("debugging policy", () => {
  it("allows read permission", () => {
    expect(() => requireDebugRead(baseAuth)).not.toThrow();
  });

  it("blocks writes without debugging:write", () => {
    expect(() => requireDebugWrite(baseAuth)).toThrow(/debugging:write/);
  });

  it("allows rollback only with rollback permission", () => {
    expect(() => requireDebugRollback({ ...baseAuth, permissions: [...baseAuth.permissions, "debugging:rollback"] })).not.toThrow();
  });
});
```

Create `server/modules/debugging/policy.ts`:

```ts
import { ApiError } from "../../shared/http/errors";
import type { AuthContext, BackendPermission } from "../auth/types";

function requirePermission(auth: AuthContext, permission: BackendPermission) {
  if (!auth.user.isActive || !auth.permissions.includes(permission)) {
    throw new ApiError("FORBIDDEN", `Missing permission: ${permission}.`, 403, { permission });
  }
}

export function requireDebugView(auth: AuthContext) {
  requirePermission(auth, "debugging:view");
}

export function requireDebugRead(auth: AuthContext) {
  requirePermission(auth, "debugging:read");
}

export function requireDebugWrite(auth: AuthContext) {
  requirePermission(auth, "debugging:write");
}

export function requireDebugRollback(auth: AuthContext) {
  requirePermission(auth, "debugging:rollback");
}

export function requireDebugAdmin(auth: AuthContext) {
  requirePermission(auth, "debugging:admin");
}
```

- [ ] **Step 7: Expand the frontend `DebuggingGateway` port**

Update `src/application/ports/DebuggingGateway.ts` to preserve existing method names while adding API-mode context:

```ts
export type DeviceTarget = {
  id: string;
  deviceId: string;
  label: string;
  targetRef: string;
  status: "detected" | "lost";
};

export type DebugDeviceSnapshot = {
  id: string;
  name: string;
  projectId: string;
  firmware: string;
  status: "online" | "offline" | "unknown";
  lastSeenAt: string | null;
};

export type DebugSessionSnapshot = {
  id: string;
  projectId: string;
  deviceId: string;
  targetId: string;
  status: "active" | "closed";
  startedAt: string;
  endedAt: string | null;
};

export type DebugSnapshotSummary = {
  id: string;
  sessionId: string;
  status: "valid" | "consumed" | "invalid";
  risk: "Low" | "Medium" | "High";
  createdAt: string;
};

export type NodeOperationSnapshot = {
  id: string;
  sessionId: string;
  parameterId?: string;
  nodePath: string;
  operationType: "detect" | "read" | "write" | "rollback";
  status: "pending" | "succeeded" | "failed" | "readback_mismatch";
  requestedValue?: string;
  previousValue?: string;
  readValue?: string;
  readbackValue?: string;
  verified: boolean;
  failureReason?: string;
  durationMs: number;
  snapshotId?: string;
  createdAt: string;
};

export type DetectTargetsInput = {
  projectId: string;
  deviceId?: string;
};

export type ReadNodeInput = {
  sessionId?: string;
  target?: string;
  parameterId?: string;
  nodePath: string;
};

export type WriteNodeInput = {
  sessionId?: string;
  target?: string;
  parameterId?: string;
  nodePath: string;
  value: string;
  readBack: boolean;
  confirmationToken?: string;
  approvalId?: string;
};

export type RollbackSnapshotInput = {
  snapshotId: string;
  confirmationToken: string;
};

export interface DebuggingGateway {
  listDevices?(): Promise<DebugDeviceSnapshot[]>;
  listParameters?(query?: { projectId?: string }): Promise<import("../../domain/debugging/types").DebugParameter[]>;
  detectTargets(input?: DetectTargetsInput): Promise<DeviceTarget[]>;
  createSession?(input: { projectId: string; deviceId: string; targetId: string }): Promise<DebugSessionSnapshot>;
  getSession?(sessionId: string): Promise<DebugSessionSnapshot | null>;
  listSessionEvents?(sessionId: string): Promise<NodeOperationSnapshot[]>;
  readNode(input: ReadNodeInput): Promise<NodeReadResult>;
  writeNode(input: WriteNodeInput): Promise<NodeWriteResult>;
  rollbackSnapshot?(input: RollbackSnapshotInput): Promise<{ snapshot: DebugSnapshotSummary; operations: NodeOperationSnapshot[] }>;
}
```

Keep `NodeReadResult` and `NodeWriteResult` exported with existing fields so `createHdcGateway` still compiles.

- [ ] **Step 8: Add frontend DTO mapper tests**

Create `src/infrastructure/http/debuggingDtos.test.ts` with cases:

- `debugDeviceFromDto` maps `online` to `"已连接"` domain status.
- `debugParameterFromDto` preserves `nodePath`, `accessMode`, range, risk, `currentValue`, and `targetValue`.
- `nodeReadResultFromDto` returns `{ ok: true, value, stdout, durationMs }` for succeeded reads.
- `nodeWriteResultFromDto` returns `verified: false` and `error` for `readback_mismatch`.
- `nodeOperationFromDto` preserves failure reason and snapshot id.

Run:

```bash
npm test -- src/infrastructure/http/debuggingDtos.test.ts
```

Expected: FAIL because the file does not exist.

- [ ] **Step 9: Implement frontend DTO mappers**

Create `src/infrastructure/http/debuggingDtos.ts` with DTO names:

```ts
export type DebugDeviceDto = {
  id: string;
  projectId: string;
  name: string;
  firmware: string;
  status: "online" | "offline" | "unknown";
  lastSeenAt: string | null;
};

export type DebugTargetDto = {
  id: string;
  deviceId: string;
  label: string;
  targetRef: string;
  status: "detected" | "lost";
};

export type DebugParameterDto = {
  id: string;
  projectId: string;
  name: string;
  key: string;
  description: string;
  module: string;
  nodePath: string;
  accessMode: "RO" | "WO" | "RW";
  unit: string;
  range: string;
  risk: "Low" | "Medium" | "High";
  currentValue: string;
  targetValue: string;
};

export type NodeOperationDto = {
  id: string;
  sessionId: string;
  parameterId: string | null;
  nodePath: string;
  operationType: "detect" | "read" | "write" | "rollback";
  status: "pending" | "succeeded" | "failed" | "readback_mismatch";
  requestedValue: string | null;
  previousValue: string | null;
  readValue: string | null;
  readbackValue: string | null;
  verified: boolean;
  failureReason: string | null;
  durationMs: number;
  snapshotId: string | null;
  createdAt: string;
};
```

Export:

- `debugDeviceFromDto(dto: DebugDeviceDto): Device`
- `debugParameterFromDto(dto: DebugParameterDto): DebugParameter`
- `debugTargetFromDto(dto: DebugTargetDto): DeviceTarget`
- `nodeOperationFromDto(dto: NodeOperationDto): NodeOperationSnapshot`
- `nodeReadResultFromDto(dto: NodeOperationDto): NodeReadResult`
- `nodeWriteResultFromDto(response: { operation: NodeOperationDto; snapshot?: DebugSnapshotDto }): NodeWriteResult`

- [ ] **Step 10: Document final M3 contract**

Update `docs/design-docs/api-contract.md` debugging section with the locked endpoint list, write payload:

```json
{
  "sessionId": "dbg_1",
  "parameterId": "dbg-fast-charge-current",
  "nodePath": "/sys/class/power_supply/battery/constant_charge_current",
  "value": "3100",
  "readBack": true,
  "confirmationToken": "confirm-high-risk-write"
}
```

and rollback payload:

```json
{
  "confirmationToken": "confirm-rollback"
}
```

- [ ] **Step 11: Run contract tests**

Run:

```bash
npm run test:server -- server/modules/auth/policy.test.ts server/modules/debugging/status.test.ts server/modules/debugging/schemas.test.ts server/modules/debugging/policy.test.ts
npm test -- src/infrastructure/http/debuggingDtos.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add docs/design-docs/api-contract.md server/modules/auth/types.ts server/modules/auth/policy.ts server/modules/auth/policy.test.ts server/modules/debugging/types.ts server/modules/debugging/status.ts server/modules/debugging/status.test.ts server/modules/debugging/schemas.ts server/modules/debugging/schemas.test.ts server/modules/debugging/policy.ts server/modules/debugging/policy.test.ts src/application/ports/DebuggingGateway.ts src/infrastructure/http/debuggingDtos.ts src/infrastructure/http/debuggingDtos.test.ts
git commit -m "feat: define m3 debugging api contract"
```

---

### Task 2: Add M3 Debugging Schema And Seed Data

**Purpose:** Create persistent debugging storage and seed a simulator-backed project catalog without importing mock runtime into the backend.

**Files:**
- Create: `server/migrations/0005_m3_debugging.sql`
- Create: `scripts/seed-m3-debugging.ts`
- Create: `test-fixtures/debugging/simulator-state.json`
- Modify: `package.json`
- Modify: `docs/generated/db-schema.md`
- Modify: `README.md`

- [ ] **Step 1: Run current migration baseline**

Run:

```bash
npm run test:server -- server/shared/database/migrations.test.ts
```

Expected: PASS before adding M3 migration.

- [ ] **Step 2: Create migration**

Create `server/migrations/0005_m3_debugging.sql` with:

```sql
create table if not exists debugging_devices (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  name text not null,
  transport text not null,
  status text not null,
  firmware text not null,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists debugging_targets (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  device_id text not null references debugging_devices(id),
  target_ref text not null,
  label text not null,
  status text not null,
  detected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (device_id, target_ref)
);

create table if not exists debugging_parameters (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  name text not null,
  key text not null,
  description text not null,
  module text not null,
  node_path text not null,
  access_mode text not null,
  unit text not null,
  range_label text not null,
  min_value numeric,
  max_value numeric,
  risk text not null,
  current_value text not null,
  target_value text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, key),
  unique (project_id, node_path)
);

create table if not exists debugging_sessions (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  device_id text not null references debugging_devices(id),
  target_id text not null references debugging_targets(id),
  actor_user_id text not null references users(id),
  status text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists node_operations (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  session_id text not null references debugging_sessions(id),
  parameter_id text references debugging_parameters(id),
  node_path text not null,
  operation_type text not null,
  status text not null,
  requested_value text,
  previous_value text,
  read_value text,
  readback_value text,
  verified boolean not null default false,
  failure_reason text,
  duration_ms integer not null default 0,
  approval_id text,
  snapshot_id text,
  actor_user_id text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists debugging_snapshots (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  session_id text not null references debugging_sessions(id),
  operation_id text references node_operations(id),
  status text not null,
  risk text not null,
  entries jsonb not null,
  created_by_user_id text not null references users(id),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

alter table node_operations
  add constraint node_operations_snapshot_fk
  foreign key (snapshot_id) references debugging_snapshots(id)
  deferrable initially deferred;

create table if not exists debugging_events (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  session_id text references debugging_sessions(id),
  operation_id text references node_operations(id),
  kind text not null,
  severity text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists debugging_devices_project_idx on debugging_devices(project_id);
create index if not exists debugging_parameters_project_idx on debugging_parameters(project_id, module, risk);
create index if not exists debugging_sessions_project_idx on debugging_sessions(project_id, started_at desc);
create index if not exists node_operations_session_idx on node_operations(session_id, created_at desc);
create index if not exists debugging_events_session_idx on debugging_events(session_id, created_at desc);
```

- [ ] **Step 3: Add simulator fixture**

Create `test-fixtures/debugging/simulator-state.json`:

```json
{
  "targets": [
    {
      "id": "sim-target-aurora-1",
      "deviceId": "sim-device-aurora-1",
      "targetRef": "simulator://aurora-1",
      "label": "Aurora Simulator 1",
      "online": true,
      "nodes": {
        "/sys/class/power_supply/battery/constant_charge_current": "3000",
        "/sys/class/power_supply/battery/input_current_limit": "2800",
        "/sys/class/power_supply/battery/temp_limit": "45",
        "/sys/class/power_supply/battery/cycle_count": "128",
        "/sys/class/power_supply/battery/readback_mismatch": "1"
      },
      "readOnlyNodes": [
        "/sys/class/power_supply/battery/cycle_count"
      ],
      "readbackMismatchNodes": [
        "/sys/class/power_supply/battery/readback_mismatch"
      ]
    }
  ]
}
```

- [ ] **Step 4: Write seed script**

Create `scripts/seed-m3-debugging.ts`:

- Connect through the existing `createPostgresDatabase`.
- Require `DATABASE_URL`.
- Upsert one simulator device for `org-chargelab` and project `aurora`.
- Upsert one detected target `sim-target-aurora-1`.
- Upsert five `debugging_parameters` mapped to the simulator fixture nodes:
  - `dbg-fast-charge-current`, RW, High, range `0-5000`, current `3000`, target `3100`.
  - `dbg-input-current-limit`, RW, Medium, range `0-5000`, current `2800`, target `2900`.
  - `dbg-temp-limit`, RW, High, range `30-70`, current `45`, target `48`.
  - `dbg-cycle-count`, RO, Low, range `0-9999`, current `128`, target `128`.
  - `dbg-readback-mismatch`, RW, Low, range `0-9`, current `1`, target `2`.

The script must use explicit SQL parameters and must not import `src/mockData.ts`.

- [ ] **Step 5: Add seed script command**

Update `package.json`:

```json
"db:seed:m3": "tsx scripts/seed-m3-debugging.ts",
"test:m3": "npm run test:all && npm run build && npm run test:e2e -- --pass-with-no-tests e2e/debugging.api.spec.ts"
```

- [ ] **Step 6: Update generated schema docs**

Update `docs/generated/db-schema.md` with the M3 tables, key columns, foreign keys, and indexes from the migration.

- [ ] **Step 7: Run migration and seed checks**

Run:

```bash
npm run test:server -- server/shared/database/migrations.test.ts
npm run build
```

Expected: PASS.

When a local database is available, also run:

```bash
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
npm run db:seed:m2
npm run db:seed:m3
```

Expected: all commands finish without duplicate-key errors.

- [ ] **Step 8: Commit**

```bash
git add server/migrations/0005_m3_debugging.sql scripts/seed-m3-debugging.ts test-fixtures/debugging/simulator-state.json package.json docs/generated/db-schema.md README.md
git commit -m "feat: add debugging schema and simulator seed"
```

---

### Task 3: Implement Simulator Gateway Adapter

**Purpose:** Provide deterministic device behavior for all M3 backend tests and local API mode without requiring real hardware.

**Files:**
- Create: `server/modules/debugging/gateway.ts`
- Create: `server/modules/debugging/simulator.ts`
- Create: `server/modules/debugging/simulator.test.ts`
- Modify: `server/config/env.ts`
- Modify: `server/config/env.test.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write simulator gateway tests**

Create `server/modules/debugging/simulator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSimulatorDebugDeviceGateway } from "./simulator";

describe("simulator debugging gateway", () => {
  it("detects online simulator targets", async () => {
    const gateway = createSimulatorDebugDeviceGateway();
    const result = await gateway.detectTargets({ projectId: "aurora" });

    expect(result.ok).toBe(true);
    expect(result.targets[0]).toMatchObject({
      id: "sim-target-aurora-1",
      targetRef: "simulator://aurora-1"
    });
  });

  it("reads node values", async () => {
    const gateway = createSimulatorDebugDeviceGateway();
    const result = await gateway.readNode({
      targetRef: "simulator://aurora-1",
      nodePath: "/sys/class/power_supply/battery/constant_charge_current"
    });

    expect(result).toMatchObject({ ok: true, value: "3000" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("blocks read-only node writes", async () => {
    const gateway = createSimulatorDebugDeviceGateway();
    const result = await gateway.writeNode({
      targetRef: "simulator://aurora-1",
      nodePath: "/sys/class/power_supply/battery/cycle_count",
      value: "129",
      readBack: true
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/read-only/i);
  });

  it("reports readback mismatch", async () => {
    const gateway = createSimulatorDebugDeviceGateway();
    const result = await gateway.writeNode({
      targetRef: "simulator://aurora-1",
      nodePath: "/sys/class/power_supply/battery/readback_mismatch",
      value: "2",
      readBack: true
    });

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.readResult?.stdout).not.toBe("2");
  });

  it("reports offline targets", async () => {
    const gateway = createSimulatorDebugDeviceGateway({
      targets: [
        {
          id: "offline",
          deviceId: "sim-device",
          targetRef: "simulator://offline",
          label: "Offline",
          online: false,
          nodes: {}
        }
      ]
    });

    const result = await gateway.readNode({ targetRef: "simulator://offline", nodePath: "/missing" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/offline/i);
  });
});
```

Run:

```bash
npm run test:server -- server/modules/debugging/simulator.test.ts
```

Expected: FAIL until gateway files exist.

- [ ] **Step 2: Define gateway interface**

Create `server/modules/debugging/gateway.ts`:

```ts
export type GatewayTarget = {
  id: string;
  deviceId: string;
  targetRef: string;
  label: string;
  online: boolean;
};

export type GatewayReadInput = {
  targetRef: string;
  nodePath: string;
};

export type GatewayWriteInput = GatewayReadInput & {
  value: string;
  readBack: boolean;
};

export type GatewayNodeResult = {
  ok: boolean;
  value?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  durationMs: number;
};

export type GatewayWriteResult = {
  ok: boolean;
  value?: string;
  verified: boolean;
  error?: string;
  writeResult: GatewayNodeResult;
  readResult?: GatewayNodeResult;
};

export interface DebugDeviceGateway {
  detectTargets(input: { projectId: string; deviceId?: string }): Promise<{ ok: boolean; targets: GatewayTarget[]; error?: string }>;
  readNode(input: GatewayReadInput): Promise<GatewayNodeResult>;
  writeNode(input: GatewayWriteInput): Promise<GatewayWriteResult>;
}
```

- [ ] **Step 3: Implement simulator gateway**

Create `server/modules/debugging/simulator.ts`:

- Load the default simulator state from an inline constant matching `test-fixtures/debugging/simulator-state.json`.
- Store node values in a per-gateway `Map<string, Map<string, string>>`.
- `detectTargets` returns only targets for the requested project in M3.
- `readNode` returns `DEVICE_UNAVAILABLE` style error text for offline or unknown target.
- `writeNode` rejects read-only nodes with `error: "Node is read-only."`.
- `writeNode` mutates the node value before readback for normal nodes.
- `writeNode` returns `verified=false` for configured readback mismatch nodes.
- All results include deterministic `durationMs` using an injectable `now()` clock or elapsed fallback.

- [ ] **Step 4: Add environment mode**

Update `server/config/env.ts`:

```ts
DEBUG_DEVICE_GATEWAY_MODE: z.enum(["simulator"]).default("simulator")
```

Update `server/config/env.test.ts` to assert the default is `"simulator"`.

- [ ] **Step 5: Wire gateway creation in API entrypoint**

Update `server/index.ts`:

```ts
import { createSimulatorDebugDeviceGateway } from "./modules/debugging/simulator";

const debugGateway = createSimulatorDebugDeviceGateway();

const server = createWiseEffServer({
  db,
  objectStore,
  debugGateway
});
```

This will require Task 5 to expand `createWiseEffServer` options. For Task 3, export the gateway and keep `server/index.ts` ready for the new option.

- [ ] **Step 6: Run simulator tests**

Run:

```bash
npm run test:server -- server/modules/debugging/simulator.test.ts server/config/env.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/modules/debugging/gateway.ts server/modules/debugging/simulator.ts server/modules/debugging/simulator.test.ts server/config/env.ts server/config/env.test.ts server/index.ts
git commit -m "feat: add simulator debugging gateway"
```

---

### Task 4: Implement Debugging Repository

**Purpose:** Encapsulate SQL persistence for devices, targets, parameters, sessions, snapshots, operations, and events before adding service orchestration.

**Files:**
- Create: `server/modules/debugging/repository.ts`
- Create: `server/modules/debugging/repository.test.ts`

- [ ] **Step 1: Write repository tests**

Create `server/modules/debugging/repository.test.ts` with cases:

- `listDevices` filters by organization and project.
- `upsertDetectedTargets` updates target status and device `last_seen_at`.
- `listParameters` returns sorted parameters by `sort_order`.
- `createSession` persists an active session for the authenticated actor.
- `insertNodeOperation` stores read/write status, values, failure reason, and duration.
- `createSnapshot` stores JSON entries and `valid` status.
- `markSnapshotConsumed` prevents reuse.
- `listSessionEvents` returns operations newest-last for UI history.

Run:

```bash
npm run test:server -- server/modules/debugging/repository.test.ts
```

Expected: FAIL because repository does not exist.

- [ ] **Step 2: Implement read methods**

Create `server/modules/debugging/repository.ts` and export:

```ts
export async function listDebugDevices(db: Queryable, input: { organizationId: string; projectId?: string }): Promise<DebugDeviceRecord[]>;
export async function listDebugParameters(db: Queryable, input: { organizationId: string; projectId?: string; module?: string; risk?: string[] }): Promise<DebugParameterRecord[]>;
export async function getDebugParameter(db: Queryable, input: { organizationId: string; parameterId: string }): Promise<DebugParameterRecord | null>;
export async function getDebugSession(db: Queryable, input: { organizationId: string; sessionId: string }): Promise<DebugSessionRecord | null>;
export async function getDebugTarget(db: Queryable, input: { organizationId: string; targetId: string }): Promise<DebugTargetRecord | null>;
export async function getDebugSnapshot(db: Queryable, input: { organizationId: string; snapshotId: string }): Promise<DebugSnapshotRecord | null>;
export async function listDebugSessionEvents(db: Queryable, input: { organizationId: string; sessionId: string }): Promise<NodeOperationRecord[]>;
```

Use the existing repository style from `server/modules/logs/repository.ts`: `db.query<T>(sql, params)`, explicit row mapping helpers, and no string-concatenated user input.

- [ ] **Step 3: Implement write methods**

Export:

```ts
export async function upsertDetectedTargets(db: Queryable, input: {
  organizationId: string;
  projectId: string;
  deviceId: string;
  targets: Array<{ id: string; targetRef: string; label: string; online: boolean }>;
}): Promise<DebugTargetRecord[]>;

export async function createDebugSession(db: Queryable, input: {
  organizationId: string;
  projectId: string;
  deviceId: string;
  targetId: string;
  actorUserId: string;
}): Promise<DebugSessionRecord>;

export async function insertNodeOperation(db: Queryable, input: {
  organizationId: string;
  projectId: string;
  sessionId: string;
  parameterId: string | null;
  nodePath: string;
  operationType: "detect" | "read" | "write" | "rollback";
  status: "pending" | "succeeded" | "failed" | "readback_mismatch";
  requestedValue?: string | null;
  previousValue?: string | null;
  readValue?: string | null;
  readbackValue?: string | null;
  verified?: boolean;
  failureReason?: string | null;
  durationMs: number;
  approvalId?: string | null;
  snapshotId?: string | null;
  actorUserId: string;
}): Promise<NodeOperationRecord>;

export async function createDebugSnapshot(db: Queryable, input: {
  organizationId: string;
  projectId: string;
  sessionId: string;
  operationId?: string | null;
  risk: "Low" | "Medium" | "High";
  entries: DebugSnapshotEntry[];
  createdByUserId: string;
}): Promise<DebugSnapshotRecord>;

export async function linkOperationSnapshot(db: Queryable, input: { operationId: string; snapshotId: string }): Promise<void>;
export async function markSnapshotConsumed(db: Queryable, input: { snapshotId: string }): Promise<DebugSnapshotRecord>;
export async function insertDebugEvent(db: Queryable, input: {
  id?: string;
  organizationId: string;
  projectId: string;
  sessionId?: string | null;
  operationId?: string | null;
  kind: "target-detected" | "session-created" | "node-read" | "node-write" | "node-write-failed" | "readback-mismatch" | "snapshot-created" | "rollback";
  severity: "Low" | "Medium" | "High";
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void>;
```

- [ ] **Step 4: Run repository tests**

Run:

```bash
npm run test:server -- server/modules/debugging/repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/modules/debugging/repository.ts server/modules/debugging/repository.test.ts
git commit -m "feat: persist debugging sessions and operations"
```

---

### Task 5: Implement Debugging Service Rules

**Purpose:** Enforce device safety in one orchestration layer: permissions, online checks, access mode, range validation, high-risk confirmation, snapshot creation, readback verification, rollback, and audit.

**Files:**
- Create: `server/modules/debugging/service.ts`
- Create: `server/modules/debugging/service.test.ts`
- Modify: `server/modules/debugging/repository.ts`
- Modify: `server/modules/debugging/repository.test.ts`

- [ ] **Step 1: Write service tests**

Create `server/modules/debugging/service.test.ts` with cases:

- `detectTargets` requires `debugging:read`, calls gateway, persists detected targets, and writes an audit event.
- `createSession` rejects offline/lost targets and persists an active session.
- `readNode` requires `debugging:read`, rejects nodes outside the parameter catalog when `parameterId` is supplied, records the operation, and writes audit.
- `writeNode` rejects RO parameters before calling the gateway.
- `writeNode` rejects numeric values outside `minValue`/`maxValue`.
- `writeNode` rejects High-risk parameters without `confirmationToken: "confirm-high-risk-write"`.
- `writeNode` creates a pre-write snapshot with previous value before calling gateway.
- `writeNode` stores `readback_mismatch` when gateway `verified=false`.
- `writeNode` treats audit write failure as operation failure.
- `rollbackSnapshot` rejects missing, consumed, invalid, or cross-session snapshots.
- `rollbackSnapshot` writes previous values, records rollback operations, and marks the snapshot consumed.

Run:

```bash
npm run test:server -- server/modules/debugging/service.test.ts
```

Expected: FAIL until service exists.

- [ ] **Step 2: Implement service factory**

Create:

```ts
export function createDebuggingService(options: {
  db: Database;
  gateway: DebugDeviceGateway;
  createAuditEvent?: typeof createAuditEvent;
}) {
  return {
    listDevices,
    detectTargets,
    listParameters,
    createSession,
    getSession,
    listSessionEvents,
    readNode,
    writeNode,
    rollbackSnapshot
  };
}
```

Every mutating method must run in `db.transaction`.

- [ ] **Step 3: Implement detect and session rules**

Rules:

- `listDevices` requires `debugging:view`.
- `detectTargets` requires `debugging:read`.
- Gateway detection failure writes a failed `debug_events` row and returns `DEVICE_UNAVAILABLE`.
- Successful detection upserts targets and writes audit kind `debug-target-detect`.
- `createSession` requires `debugging:read`, verifies device and target belong to the same project, verifies target status is `detected`, inserts session, inserts event kind `session-created`, and writes audit kind `debug-session-create`.

- [ ] **Step 4: Implement read rules**

Rules:

- `readNode` requires `debugging:read`.
- Session must be `active`.
- If `parameterId` is supplied, parameter project must equal session project and `nodePath` must equal the parameter `nodePath`.
- `accessMode` must be `RO` or `RW`.
- Target must resolve to a gateway `targetRef`.
- Gateway failure creates `node_operations.status="failed"` with `failureReason`.
- Gateway success creates `status="succeeded"`, `readValue`, `verified=true`.
- Audit kind is `debug-node-read`; audit failure throws and rolls back the operation insert.

- [ ] **Step 5: Implement write rules**

Rules:

- `writeNode` requires `debugging:write`.
- Session must be `active`.
- Parameter must exist and be in the same project as session.
- `accessMode` must be `WO` or `RW`.
- `value` must parse as a number when `minValue` or `maxValue` exists.
- Values below `minValue` or above `maxValue` throw `VALIDATION_FAILED`.
- `risk === "High"` requires `confirmationToken === "confirm-high-risk-write"` or a non-empty `approvalId`.
- The service reads the previous value from the gateway before writing and creates a valid snapshot with one entry.
- Gateway write failure stores `status="failed"` and links the snapshot.
- Gateway `ok=true` and `verified=true` stores `status="succeeded"`.
- Gateway `ok=true` and `verified=false` stores `status="readback_mismatch"`.
- On success, update `debugging_parameters.current_value` and `target_value` to the accepted/readback value for M3 visibility.
- Audit kind is `debug-node-write`; include requested value, previous value, readback value, verified, failure reason, snapshot id, and node path.

- [ ] **Step 6: Implement rollback rules**

Rules:

- `rollbackSnapshot` requires `debugging:rollback`.
- `confirmationToken` must equal `"confirm-rollback"`.
- Snapshot must exist, be `valid`, and belong to an active session in the same organization/project.
- For each entry, write `previousValue` back to `nodePath` with `readBack=true`.
- Insert one `node_operations` row per rollback entry with `operationType="rollback"`.
- If every rollback operation succeeds and verifies, mark snapshot `consumed`.
- If any rollback operation fails, keep snapshot `valid`, insert a failed event, and return operations with failure reasons.
- Audit kind is `debug-snapshot-rollback`.

- [ ] **Step 7: Run service tests**

Run:

```bash
npm run test:server -- server/modules/debugging/service.test.ts server/modules/debugging/repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/modules/debugging/service.ts server/modules/debugging/service.test.ts server/modules/debugging/repository.ts server/modules/debugging/repository.test.ts
git commit -m "feat: enforce debugging write safety"
```

---

### Task 6: Register Debugging API Routes

**Purpose:** Expose the M3 service through `/api/v1/debugging/*` with validation, auth context, errors, and simulator gateway registration.

**Files:**
- Create: `server/modules/debugging/routes.ts`
- Create: `server/modules/debugging/routes.test.ts`
- Modify: `server/app.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write route tests**

Create `server/modules/debugging/routes.test.ts` covering:

- `GET /api/v1/debugging/devices?projectId=aurora` returns `{ items }`.
- `POST /api/v1/debugging/targets/detect` validates body and returns detected targets.
- `GET /api/v1/debugging/parameters?projectId=aurora` returns debug parameter DTOs.
- `POST /api/v1/debugging/sessions` returns a session.
- `GET /api/v1/debugging/sessions/:sessionId/events` uses route params.
- `POST /api/v1/debugging/nodes/read` returns an operation result.
- `POST /api/v1/debugging/nodes/write` returns an operation and snapshot.
- `POST /api/v1/debugging/snapshots/:snapshotId/rollback` returns rollback operations.
- missing DB or gateway returns `INTERNAL_ERROR`.
- schema failures return `VALIDATION_FAILED`.
- forbidden writes return `FORBIDDEN`.

Run:

```bash
npm run test:server -- server/modules/debugging/routes.test.ts
```

Expected: FAIL until routes exist.

- [ ] **Step 2: Implement route registration**

Create `registerDebuggingRoutes(router, { db, debugGateway, getCurrentAuthContext })`.

Each route:

- checks `db` and `debugGateway`;
- gets auth context from the request;
- parses params, query, or body with schemas;
- creates `createDebuggingService({ db, gateway: debugGateway })`;
- returns DTO bodies with `{ items }` for lists;
- lets `ApiError` propagate to shared error serializer.

- [ ] **Step 3: Register routes in the app**

Update `server/app.ts`:

```ts
import { registerDebuggingRoutes } from "./modules/debugging/routes";
import type { DebugDeviceGateway } from "./modules/debugging/gateway";

export function createWiseEffServer(options: { db?: Database; objectStore?: ObjectStore; debugGateway?: DebugDeviceGateway } = {}) {
  const router = createRouter();

  router.get("/api/v1/health", async () => ({
    status: 200,
    body: { ok: true, service: "wiseeff-api" }
  }));

  registerAuthRoutes(router, { db: options.db });
  registerAuditRoutes(router, {
    db: options.db,
    getCurrentAuthContext: () => developmentAuthContext
  });
  registerParameterRoutes(router, {
    db: options.db,
    getCurrentAuthContext: (request) => getCurrentAuthContext(options, request)
  });
  registerLogRoutes(router, {
    db: options.db,
    objectStore: options.objectStore,
    getCurrentAuthContext: (request) => getCurrentAuthContext(options, request)
  });
  registerJobRoutes(router, {
    db: options.db,
    getCurrentAuthContext: (request) => getCurrentAuthContext(options, request)
  });
  registerDebuggingRoutes(router, {
    db: options.db,
    debugGateway: options.debugGateway,
    getCurrentAuthContext: (request) => getCurrentAuthContext(options, request)
  });

  return createHttpServer(router);
}
```

Update `server/index.ts` so the simulator gateway is passed to `createWiseEffServer`.

- [ ] **Step 4: Run backend route suite**

Run:

```bash
npm run test:server -- server/modules/debugging/routes.test.ts server/app.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/modules/debugging/routes.ts server/modules/debugging/routes.test.ts server/app.ts server/index.ts
git commit -m "feat: expose debugging api routes"
```

---

### Task 7: Implement HTTP DebuggingGateway

**Purpose:** Give frontend API mode a production gateway implementation matching the expanded `DebuggingGateway` port.

**Files:**
- Create: `src/infrastructure/http/debuggingClient.ts`
- Create: `src/infrastructure/http/debuggingClient.test.ts`
- Modify: `src/infrastructure/device/hdcGateway.ts`
- Modify: `src/infrastructure/device/hdcGateway.test.ts`

- [ ] **Step 1: Write HTTP gateway tests**

Create `src/infrastructure/http/debuggingClient.test.ts`. Mock `fetch` and assert:

- `listDevices()` calls `/api/v1/debugging/devices`.
- `listParameters({ projectId: "aurora" })` calls `/api/v1/debugging/parameters?projectId=aurora`.
- `detectTargets({ projectId: "aurora" })` posts to `/api/v1/debugging/targets/detect`.
- `createSession` posts to `/api/v1/debugging/sessions`.
- `readNode` posts to `/api/v1/debugging/nodes/read`.
- `writeNode` posts to `/api/v1/debugging/nodes/write` with `confirmationToken`.
- `rollbackSnapshot` posts to `/api/v1/debugging/snapshots/:snapshotId/rollback`.
- API `NOT_FOUND` from `getSession` returns `null`.
- API errors remain `WiseEffApiError`.

Run:

```bash
npm test -- src/infrastructure/http/debuggingClient.test.ts
```

Expected: FAIL until client exists.

- [ ] **Step 2: Implement `createHttpDebuggingGateway`**

Create:

```ts
export function createHttpDebuggingGateway(
  apiClient = createApiClient({ baseUrl: wiseEffApiBaseUrl })
): DebuggingGateway
```

Methods:

- `listDevices` -> `GET /api/v1/debugging/devices`
- `listParameters` -> `GET /api/v1/debugging/parameters`
- `detectTargets` -> `POST /api/v1/debugging/targets/detect`
- `createSession` -> `POST /api/v1/debugging/sessions`
- `getSession` -> `GET /api/v1/debugging/sessions/:sessionId`, return `null` on `NOT_FOUND`
- `listSessionEvents` -> `GET /api/v1/debugging/sessions/:sessionId/events`
- `readNode` -> `POST /api/v1/debugging/nodes/read`
- `writeNode` -> `POST /api/v1/debugging/nodes/write`
- `rollbackSnapshot` -> `POST /api/v1/debugging/snapshots/:snapshotId/rollback`

Use `encodeURIComponent` for path params and `URLSearchParams` for query strings.

- [ ] **Step 3: Keep local HDC gateway compatible**

Update `src/infrastructure/device/hdcGateway.ts` so `detectTargets(input?: DetectTargetsInput)` accepts but ignores the optional API-mode input. Preserve existing local HDC behavior and tests.

- [ ] **Step 4: Run gateway tests**

Run:

```bash
npm test -- src/infrastructure/http/debuggingDtos.test.ts src/infrastructure/http/debuggingClient.test.ts src/infrastructure/device/hdcGateway.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/http/debuggingClient.ts src/infrastructure/http/debuggingClient.test.ts src/infrastructure/device/hdcGateway.ts src/infrastructure/device/hdcGateway.test.ts
git commit -m "feat: add http debugging gateway"
```

---

### Task 8: Add Frontend Debugging Runtime Coordinator

**Purpose:** Keep page components focused on UI while API mode handles hydration, session creation, detect/read/write flows, and rollback through the gateway.

**Files:**
- Create: `src/application/debugging/debuggingRuntime.ts`
- Create: `src/application/debugging/debuggingRuntime.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Write runtime coordinator tests**

Create `src/application/debugging/debuggingRuntime.test.ts` covering:

- mock mode `connectDevice`, `pushValues`, and `rollbackLastSnapshot` dispatch existing reducer actions.
- API mode `refresh` calls `gateway.listDevices` and `gateway.listParameters`, then dispatches `HYDRATE_DEBUG_RUNTIME`.
- API mode `detectAndStartSession` calls `detectTargets`, `createSession`, then dispatches active session state.
- API mode `readNode` calls gateway, returns `NodeReadResult`, and dispatches an operation event.
- API mode `writeNode` sends `confirmationToken` for High-risk rows and dispatches operation/snapshot results.
- API mode `rollbackSnapshot` calls gateway and refreshes operations.
- failed gateway calls dispatch a user-facing notification and do not optimistically mark rows successful.

Run:

```bash
npm test -- src/application/debugging/debuggingRuntime.test.ts
```

Expected: FAIL until runtime exists.

- [ ] **Step 2: Add reducer actions**

In `src/App.tsx`, add actions:

```ts
| { type: "HYDRATE_DEBUG_RUNTIME"; devices: Device[]; debugParameters: DebugParameter[] }
| { type: "SET_DEBUG_ACTIVE_SESSION"; session: DebugSessionSnapshot | null; target?: DeviceTarget }
| { type: "UPSERT_DEBUG_NODE_OPERATION"; operation: NodeOperationSnapshot }
| { type: "UPSERT_DEBUG_SNAPSHOT"; snapshot: DebugSnapshotSummary }
```

Reducer behavior:

- `HYDRATE_DEBUG_RUNTIME` replaces `state.devices` and `state.debugParameters`, and mirrors parameters into `state.configDraft.debugParameters` for existing admin display.
- `SET_DEBUG_ACTIVE_SESSION` stores `debuggingSessionStartedAt` from `session.startedAt`.
- `UPSERT_DEBUG_NODE_OPERATION` appends to `debugEvents` using existing event panel-compatible fields.
- `UPSERT_DEBUG_SNAPSHOT` updates `lastDebugSnapshot` only when snapshot status is `valid`.

- [ ] **Step 3: Implement runtime factory**

Create:

```ts
export type DebuggingRuntimeActions = {
  refresh(query?: { projectId?: string }): Promise<void>;
  detectAndStartSession(projectId: string): Promise<{ session: DebugSessionSnapshot; target: DeviceTarget }>;
  readNode(input: ReadNodeInput): Promise<NodeReadResult>;
  writeNode(input: WriteNodeInput & { risk?: "Low" | "Medium" | "High" }): Promise<NodeWriteResult>;
  pushValues(parameterIds: string[]): Promise<void>;
  rollbackSnapshot(input: RollbackSnapshotInput): Promise<void>;
  connectDevice(deviceId: string): Promise<void>;
};
```

`createDebuggingRuntimeActions({ mode, gateway, dispatch, getState })`:

- mock mode wraps existing reducer actions and resolves promises;
- API mode calls gateway methods and dispatches hydration/session/operation/snapshot actions;
- `writeNode` adds `confirmationToken: "confirm-high-risk-write"` when `risk === "High"` and no approval id is present;
- `pushValues` writes each selected/pending parameter sequentially so failure reasons map to rows deterministically.

- [ ] **Step 4: Wire runtime into App shell**

`AppProps` gains optional:

```ts
debuggingGateway?: DebuggingGateway;
```

When `runtimeMode === "api"`:

- default to `createHttpDebuggingGateway()`;
- call `debuggingActions.refresh({ projectId: state.activeProjectId })` after auth hydration;
- show one success notification after first debug API load;
- show an error notification on failure.

Pass `debuggingActions` and `debuggingGateway` through `PageProps` in `src/app/routes.tsx`.

- [ ] **Step 5: Run runtime tests**

Run:

```bash
npm test -- src/application/debugging/debuggingRuntime.test.ts src/App.test.tsx src/permissionRouting.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/application/debugging/debuggingRuntime.ts src/application/debugging/debuggingRuntime.test.ts src/App.tsx src/App.test.tsx src/app/routes.tsx
git commit -m "feat: hydrate debugging runtime from api"
```

---

### Task 9: Wire `/node-debugging` To API Gateway

**Purpose:** Replace direct page-level HDC calls in API mode while preserving the current local HDC experience in mock/development mode.

**Files:**
- Modify: `src/NodeDebuggingPage.tsx`
- Modify: `src/NodeDebuggingPage.test.tsx`
- Modify: `src/app/routes.tsx`

- [ ] **Step 1: Update NodeDebuggingPage tests**

Add tests in `src/NodeDebuggingPage.test.tsx`:

- API mode auto-detect calls `debuggingActions.detectAndStartSession` and shows the returned target label.
- API mode initial readable rows call `debuggingActions.readNode`.
- editing a writable row and clicking write calls `debuggingActions.writeNode` with `sessionId`, `parameterId`, `nodePath`, `value`, and `readBack`.
- readback mismatch displays a failure status and the returned error.
- bulk write sends only pending writable rows.
- local HDC fallback still calls `detectHdcTargets`, `readNodeValue`, and `writeNodeValue` when no API actions are supplied.

Run:

```bash
npm test -- src/NodeDebuggingPage.test.tsx
```

Expected: FAIL until page accepts runtime actions.

- [ ] **Step 2: Add runtime props**

Change `NodeDebuggingPage` props to:

```ts
export function NodeDebuggingPage({
  state,
  debuggingActions
}: {
  state: PrototypeState;
  debuggingActions?: DebuggingRuntimeActions;
}) {
```

Implementation:

- If `debuggingActions` exists, use it for detect/read/write.
- If not, keep the existing direct local HDC calls.
- Store `activeSessionId` and `activeTargetId` in component state after `detectAndStartSession`.
- Pass `sessionId` into every API-mode read/write.
- Convert `NodeReadResult` and `NodeWriteResult` into the existing row runtime statuses.

- [ ] **Step 3: Keep event panel behavior**

When API-mode actions return operation snapshots, append events with:

- parameter name/key;
- operation action `detect`, `read`, `write`, or `write-readback`;
- compact success/failure status;
- `stdout`, `stderr`, `nodePath`, and duration.

If runtime already dispatched global events, avoid duplicate local events by using the operation returned from the action call as the single page event source.

- [ ] **Step 4: Run node page tests**

Run:

```bash
npm test -- src/NodeDebuggingPage.test.tsx src/infrastructure/http/debuggingClient.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/NodeDebuggingPage.tsx src/NodeDebuggingPage.test.tsx src/app/routes.tsx
git commit -m "feat: run node debugging through api gateway"
```

---

### Task 10: Wire `/debugging` And `/debugging-admin` To Runtime

**Purpose:** Make the higher-level debugging workbench use API-mode reads/writes and prevent browser-only config writes from becoming the production path.

**Files:**
- Modify: `src/DebuggingPage.tsx`
- Modify: `src/DebuggingPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/reducer.debugging.test.ts`

- [ ] **Step 1: Update DebuggingPage tests**

In `src/DebuggingPage.test.tsx`, add tests:

- API mode connect button calls `debuggingActions.detectAndStartSession`.
- API mode push pending values calls `debuggingActions.pushValues`.
- High-risk pending parameter push includes confirmation through runtime and shows pending state.
- API mode rollback button calls `debuggingActions.rollbackSnapshot`.
- failed push shows notification and keeps row status failed/pending instead of marking it successful.
- mock mode still dispatches `CONNECT_DEVICE`, `PUSH_DEBUG_VALUES`, and `ROLLBACK_LAST_SNAPSHOT`.

Run:

```bash
npm test -- src/DebuggingPage.test.tsx
```

Expected: FAIL until the page uses runtime actions.

- [ ] **Step 2: Add runtime props to DebuggingPage**

Change props:

```ts
type DebuggingPageProps = {
  state: PrototypeState;
  dispatch: (action: AppAction) => void;
  debuggingActions?: DebuggingRuntimeActions;
};
```

Implementation:

- connect button calls `debuggingActions.detectAndStartSession(state.activeProjectId)` when present;
- push button calls `debuggingActions.pushValues(parameterIds)` when present;
- rollback confirmation calls `debuggingActions.rollbackSnapshot({ snapshotId, confirmationToken: "confirm-rollback" })` when present;
- mock mode keeps direct dispatch.

- [ ] **Step 3: Make admin API mode read-only for catalog changes**

In `DebuggingAdminPage` inside `src/App.tsx`:

- Use hydrated `state.configDraft.debugParameters` for display.
- In API mode, disable add/delete/direct-edit controls that would only mutate browser config.
- Show concise helper text: `API 模式下调试参数目录由后端种子和迁移管理；本页用于查看节点路径、访问模式和风险配置。`
- Keep mock mode admin editing behavior unchanged.

- [ ] **Step 4: Preserve reducer tests**

Update `src/reducer.debugging.test.ts` only for new action coverage. Existing mock reducer cases must still pass:

- connect device;
- update debug parameter;
- push values creates snapshot and event;
- rollback restores snapshot.

- [ ] **Step 5: Run targeted frontend tests**

Run:

```bash
npm test -- src/DebuggingPage.test.tsx src/NodeDebuggingPage.test.tsx src/reducer.debugging.test.ts src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/DebuggingPage.tsx src/DebuggingPage.test.tsx src/App.tsx src/reducer.debugging.test.ts
git commit -m "feat: persist debugging workbench through api mode"
```

---

### Task 11: Add M3 E2E, CI Gate, And Documentation

**Purpose:** Prove the simulator-backed debugging loop works end-to-end and document local operation, safety rules, and remaining production gaps.

**Files:**
- Create: `e2e/debugging.api.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Modify: `docs/FRONTEND.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/RELIABILITY.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/design-docs/domain-model.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `README.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`

- [ ] **Step 1: Ensure M3 E2E script exists**

If Task 2 did not add it, update `package.json`:

```json
"test:m3": "npm run test:all && npm run build && npm run test:e2e -- e2e/debugging.api.spec.ts"
```

- [ ] **Step 2: Configure Playwright API mode**

Update `playwright.config.ts` so the API server has:

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
DEBUG_DEVICE_GATEWAY_MODE=simulator
OBJECT_STORE_ROOT=.wiseeff-object-store
```

Keep M1/M2 E2E configuration working.

- [ ] **Step 3: Write M3 E2E smoke**

Create `e2e/debugging.api.spec.ts`:

1. Navigate to `/node-debugging?project=aurora`.
2. Wait for simulator target `Aurora Simulator 1`.
3. Assert a readable row shows `3000` for fast charge current.
4. Open the fast charge current row, change target value to `3100`, and write with readback.
5. Assert the row shows success and readback value `3100`.
6. Open the cycle count row and assert the write button is absent or disabled because access mode is `RO`.
7. Open the readback mismatch row, write value `2`, and assert failure text mentions readback mismatch.
8. Navigate to `/debugging`, open rollback confirmation, confirm rollback.
9. Return to `/node-debugging`, read fast charge current again, and assert it is back to `3000`.
10. Navigate to the audit/admin view and assert a debug node write or rollback audit event exists.

- [ ] **Step 4: Update docs**

Docs updates:

- `README.md`: M3 setup, `db:seed:m3`, simulator mode, API-mode debugging verification, and `npm run test:m3`.
- `docs/FRONTEND.md`: `DebuggingGateway` responsibilities, mock/HDC/API mode split, and runtime coordinator behavior.
- `docs/SECURITY.md`: debugging read/write/rollback permissions, high-risk confirmation, snapshot requirement, audit requirements, and why frontend permission checks remain UX only.
- `docs/RELIABILITY.md`: simulator-first gateway, timeout/offline/readback mismatch reporting, rollback expectations, and production HDC gap.
- `docs/QUALITY_SCORE.md`: M3 tests and remaining risks.
- `docs/design-docs/domain-model.md`: M3 implementation notes for devices, targets, sessions, snapshots, operations, and events.
- `docs/design-docs/testing-strategy.md`: actual M3 commands and simulator fixture.
- `docs/exec-plans/tech-debt-tracker.md`: record deferred real gateway adapter, device leases, generated OpenAPI client, Agent approvals, and catalog CRUD if not already tracked.

- [ ] **Step 5: Final verification**

Run:

```bash
npm run test:all
npm run build
npm run test:e2e -- e2e/debugging.api.spec.ts
git diff --check
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add e2e/debugging.api.spec.ts playwright.config.ts package.json docs/FRONTEND.md docs/SECURITY.md docs/RELIABILITY.md docs/QUALITY_SCORE.md docs/design-docs/domain-model.md docs/design-docs/testing-strategy.md README.md docs/exec-plans/tech-debt-tracker.md
git commit -m "test: add m3 debugging acceptance"
```

---

## Implementation Order And Review Gates

Recommended subagent order:

1. Task 1: contract, permissions, schemas, DTOs, and port shape.
2. Task 2: database migration, seed data, fixture, and docs schema update.
3. Task 3: simulator gateway.
4. Task 4: repository persistence.
5. Task 5: service safety rules.
6. Task 6: API routes and app registration.
7. Task 7: HTTP frontend gateway.
8. Task 8: frontend runtime coordinator.
9. Task 9: `/node-debugging` API-mode wiring.
10. Task 10: `/debugging` and `/debugging-admin` API-mode wiring.
11. Task 11: E2E, docs, and release gates.

Review gates:

- Gate A after Tasks 1-2: contract, permissions, migration, seed data, and DTOs are consistent.
- Gate B after Tasks 3-6: backend simulator loop passes detect/read/write/failure/rollback route and service tests.
- Gate C after Tasks 7-10: mock mode still passes and API mode can hydrate, detect, read, write, show failures, and rollback in the UI.
- Gate D after Task 11: Playwright proves the simulator-backed debugging acceptance loop and docs match shipped behavior.

## Subagent Dispatch Guidance

Use `superpowers:subagent-driven-development` for implementation.

For each task:

- Provide the subagent only the task text, this plan header, and the relevant file excerpts.
- Require the subagent to write the failing test first, run it, implement the minimum code, rerun targeted tests, and commit only the files listed in that task.
- After each task, run a spec-compliance review subagent and then a code-quality review subagent before moving to the next task.
- Do not run implementation subagents in parallel for Tasks 1-6 because they share contracts, migrations, and backend route registration.
- Tasks 7 and 8 can be prepared in parallel only after Task 6 is committed.
- Tasks 9 and 10 should run sequentially because both touch route props and debugging reducer wiring.

## Risk Controls

- Keep mock mode and existing local HDC bridge alive; API mode adds the server-backed path without deleting the development path.
- Do not import `src/mockData.ts` from server runtime. Seed scripts use explicit SQL and the simulator fixture.
- Treat audit write failure as a product failure for detect, session creation, read, write, and rollback.
- Never write a device node before access mode, online target, range, permission, and high-risk confirmation checks pass.
- Always create a pre-write snapshot before a successful or attempted mutating write. Failed writes retain the snapshot for operator diagnosis unless rollback would be unsafe.
- Keep readback mismatch distinct from transport failure so the UI can explain that the write command ran but verification failed.
- Keep rollback bound to a valid snapshot, session, project, and organization. Cross-session and consumed snapshots must fail.
- Use explicit simulator failure cases in tests; do not depend on a real device being attached to run CI or local acceptance.

## Self-Review

- Spec coverage: roadmap M3 items 1-8 are covered by Tasks 1-11: gateway skeleton, simulator, target detection, node read, node write/readback, sessions/snapshots, frontend gateway switch, high-risk confirmation, and audit.
- API contract coverage: every debugging endpoint in `docs/design-docs/api-contract.md` is assigned to Tasks 1 and 6, and frontend client coverage is assigned to Task 7.
- Domain model coverage: `Device`, `DeviceTarget`, `DebugParameter`, `DebugSession`, `DebugSnapshot`, `NodeOperation`, and `DebugEvent` are persisted in Task 2 and exercised in Tasks 4-6.
- Security coverage: permission, range, access mode, confirmation, snapshot, audit, and rollback validation are tested in Task 5.
- Frontend coverage: `DebuggingGateway`, API DTOs, runtime coordinator, `/node-debugging`, `/debugging`, and admin API-mode behavior are covered by Tasks 7-10.
- Acceptance coverage: simulator E2E covers detect, read, write, readback mismatch, rollback, and audit evidence in Task 11.
- Placeholder scan: the plan does not contain unresolved implementation placeholders.
- Type consistency: backend status codes are lowercase; frontend DTOs map them into existing domain/UI labels; `DebuggingGateway` remains the single frontend port for M3 API behavior.
- Residual risk: real HDC backend adapter, device leases, Agent approvals, generated OpenAPI client, and debugging catalog CRUD are intentionally outside M3 and must stay visible in the technical debt tracker.
