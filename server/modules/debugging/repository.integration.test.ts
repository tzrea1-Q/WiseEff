import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import {
  acquireDebugDeviceLease,
  archiveDebugParameter,
  archiveDebugParameterNodeBinding,
  claimSnapshotForRollback,
  createDebugParameter,
  createDebugSession,
  createDebugSnapshot,
  ensureBridgeDebugDevice,
  ensureDtsReloadLeaseSession,
  getDebugDevice,
  getDebugParameter,
  getDebugParameterNodeBinding,
  getDebugSession,
  getDebugSnapshot,
  getDebugTarget,
  getDefaultAdbSmokeParameterNodeBinding,
  insertDebugEvent,
  insertNodeOperation,
  linkOperationSnapshot,
  listDebugDevices,
  listDebugParameterNodeBindings,
  listDebugParameters,
  listDebugSessionEvents,
  markSnapshotConsumed,
  releaseDebugDeviceLease,
  restoreDebugParameter,
  restoreSnapshotValid,
  updateDebugParameter,
  updateDebugParameterValues,
  upsertDebugParameterNodeBinding,
  upsertDetectedTargets
} from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_A = "org-debug-a";
const ORG_B = "org-debug-b";
const USER_A = "user-debug-a";
const USER_B = "user-debug-b";
const DEVICE_A = "device-debug-a";
const DEVICE_B = "device-debug-b";
const TARGET_A = "target-debug-a";
const TARGET_B = "target-debug-b";

async function seedDebugGraph(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Debug Org A'), ($2, 'Debug Org B')`,
    [ORG_A, ORG_B]
  );
  await db.query(
    `insert into users (id, organization_id, name, email, title)
     values
       ($1, $3, 'Debug User A', 'debug-a@example.com', 'Engineer'),
       ($2, $4, 'Debug User B', 'debug-b@example.com', 'Engineer')`,
    [USER_A, USER_B, ORG_A, ORG_B]
  );
  await db.query(
    `insert into debugging_devices (id, organization_id, name, transport, status, firmware, last_seen_at)
     values
       ($1, $3, 'Bench A', 'hdc', 'online', 'fw-1', now()),
       ($2, $4, 'Bench B', 'hdc', 'online', 'fw-1', now())`,
    [DEVICE_A, DEVICE_B, ORG_A, ORG_B]
  );
  await db.query(
    `insert into debugging_targets (id, organization_id, device_id, target_ref, label, status, protocol)
     values
       ($1, $3, $5, 'ref-a', 'Target A', 'detected', 'hdc'),
       ($2, $4, $6, 'ref-b', 'Target B', 'detected', 'hdc')`,
    [TARGET_A, TARGET_B, ORG_A, ORG_B, DEVICE_A, DEVICE_B]
  );
}

function parameterInput(overrides: Record<string, unknown> = {}) {
  const key = (overrides.key as string | undefined) ?? "debug.fast_charge.current";
  return {
    organizationId: ORG_A,
    name: "Fast charge current",
    key,
    description: "Charging current limit",
    // node_path is unique per organization (debugging_parameters_org_node_path_idx).
    nodePath: `/sys/class/power/${key.replaceAll(".", "/")}`,
    module: "Charging",
    accessMode: "RW" as const,
    unit: "mA",
    range: "0-5000",
    minValue: 0,
    maxValue: 5000,
    risk: "Medium" as const,
    currentValue: "3000",
    targetValue: "3200",
    sortOrder: 10,
    enabled: true,
    ...overrides
  };
}

describe.skipIf(!databaseAvailable)("debugging repository (behavior)", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedDebugGraph(db);
  });

  afterEach(async () => {
    await db.rollback();
    setParameterIdentityMode(null);
  });

  describe("catalog parameters (archive-only legacy surface, TD-033)", () => {
    it("creates a parameter and reads back the full record, invisible to other tenants", async () => {
      const created = await createDebugParameter(db, parameterInput());

      expect(created).toMatchObject({
        organizationId: ORG_A,
        name: "Fast charge current",
        key: "debug.fast_charge.current",
        nodePath: "/sys/class/power/debug/fast_charge/current",
        accessMode: "RW",
        unit: "mA",
        range: "0-5000",
        minValue: 0,
        maxValue: 5000,
        risk: "Medium",
        currentValue: "3000",
        targetValue: "3200",
        sortOrder: 10,
        enabled: true,
        archivedAt: null
      });

      const readBack = await getDebugParameter(db, { organizationId: ORG_A, parameterId: created.id });
      expect(readBack).toEqual(created);

      // Tenancy is a behavior, not a SQL substring: the other org sees nothing.
      expect(await getDebugParameter(db, { organizationId: ORG_B, parameterId: created.id })).toBeNull();
      expect(await listDebugParameters(db, { organizationId: ORG_B })).toEqual([]);
    });

    it("updates mutable metadata in place and refuses cross-tenant updates", async () => {
      const created = await createDebugParameter(db, parameterInput());

      const updated = await updateDebugParameter(db, {
        ...parameterInput({ name: "Fast charge current (rev B)", targetValue: "3400", sortOrder: 5 }),
        parameterId: created.id
      });
      expect(updated).toMatchObject({ id: created.id, name: "Fast charge current (rev B)", targetValue: "3400", sortOrder: 5 });

      const crossTenant = await updateDebugParameter(db, {
        ...parameterInput({ organizationId: ORG_B, name: "hijacked" }),
        parameterId: created.id
      });
      expect(crossTenant).toBeNull();
      expect((await getDebugParameter(db, { organizationId: ORG_A, parameterId: created.id }))?.name).toBe(
        "Fast charge current (rev B)"
      );
    });

    it("updateDebugParameterValues writes current/target only inside the owning organization", async () => {
      const created = await createDebugParameter(db, parameterInput());

      await updateDebugParameterValues(db, {
        organizationId: ORG_B,
        parameterId: created.id,
        currentValue: "1",
        targetValue: "2"
      });
      expect(await getDebugParameter(db, { organizationId: ORG_A, parameterId: created.id })).toMatchObject({
        currentValue: "3000",
        targetValue: "3200"
      });

      await updateDebugParameterValues(db, {
        organizationId: ORG_A,
        parameterId: created.id,
        currentValue: "3100",
        targetValue: "3300"
      });
      expect(await getDebugParameter(db, { organizationId: ORG_A, parameterId: created.id })).toMatchObject({
        currentValue: "3100",
        targetValue: "3300"
      });
    });

    it("archive hides a parameter from runtime lists, keeps the row for admin lists, and restore preserves enabled state", async () => {
      const enabledParam = await createDebugParameter(db, parameterInput({ key: "debug.k1", sortOrder: 1 }));
      const disabledParam = await createDebugParameter(
        db,
        parameterInput({ key: "debug.k2", name: "Disabled knob", enabled: false, sortOrder: 2 })
      );

      const archived = await archiveDebugParameter(db, {
        organizationId: ORG_A,
        parameterId: enabledParam.id,
        archivedByUserId: USER_A,
        reason: "bench retired"
      });
      expect(archived?.archivedAt).not.toBeNull();
      expect(archived?.archiveReason).toBe("bench retired");

      const runtimeList = await listDebugParameters(db, { organizationId: ORG_A });
      expect(runtimeList.map((item) => item.id)).not.toContain(enabledParam.id);
      // Disabled (not archived) rows are also excluded from the runtime list.
      expect(runtimeList.map((item) => item.id)).not.toContain(disabledParam.id);

      const adminList = await listDebugParameters(db, { organizationId: ORG_A, includeArchived: true });
      expect(adminList.map((item) => item.id)).toEqual(
        expect.arrayContaining([enabledParam.id, disabledParam.id])
      );

      const restored = await restoreDebugParameter(db, { organizationId: ORG_A, parameterId: enabledParam.id });
      expect(restored?.archivedAt).toBeNull();
      // Restore never flips the catalog enabled flag.
      expect(restored?.enabled).toBe(true);

      const restoredDisabled = await restoreDebugParameter(
        db,
        { organizationId: ORG_A, parameterId: disabledParam.id }
      );
      expect(restoredDisabled?.enabled).toBe(false);
    });

    it("lists parameters ordered by sort_order then name", async () => {
      await createDebugParameter(db, parameterInput({ key: "k.c", name: "Charlie", sortOrder: 20 }));
      await createDebugParameter(db, parameterInput({ key: "k.a", name: "Alpha", sortOrder: 10 }));
      await createDebugParameter(db, parameterInput({ key: "k.b", name: "Bravo", sortOrder: 10 }));

      const listed = await listDebugParameters(db, { organizationId: ORG_A });
      expect(listed.map((item) => item.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    });

    it("rejects a second catalog parameter on the same node path within one organization", async () => {
      await createDebugParameter(db, parameterInput({ key: "k.dup" }));

      await expect(
        createDebugParameter(db, parameterInput({ key: "k.other", nodePath: "/sys/class/power/k/dup" }))
      ).rejects.toThrow(/debugging_parameters_org_node_path_idx/);
    });
  });

  describe("protocol node bindings", () => {
    it("upserts a binding, updates it idempotently, and archive hides it from enabled-only reads", async () => {
      const parameter = await createDebugParameter(db, parameterInput());

      const created = await upsertDebugParameterNodeBinding(db, {
        organizationId: ORG_A,
        parameterId: parameter.id,
        protocol: "hdc",
        nodePath: "/sys/node/v1",
        accessMode: "RW",
        enabled: true,
        notes: "bench binding"
      });
      expect(created).toMatchObject({ parameterId: parameter.id, protocol: "hdc", nodePath: "/sys/node/v1", enabled: true });

      const updated = await upsertDebugParameterNodeBinding(db, {
        organizationId: ORG_A,
        parameterId: parameter.id,
        protocol: "hdc",
        nodePath: "/sys/node/v2",
        accessMode: "RO",
        enabled: true,
        notes: null
      });
      expect(updated?.id).toBe(created?.id);
      expect(updated).toMatchObject({ nodePath: "/sys/node/v2", accessMode: "RO" });

      const archivedBinding = await archiveDebugParameterNodeBinding(db, {
        organizationId: ORG_A,
        parameterId: parameter.id,
        protocol: "hdc"
      });
      expect(archivedBinding?.enabled).toBe(false);

      expect(
        await getDebugParameterNodeBinding(db, { organizationId: ORG_A, parameterId: parameter.id, protocol: "hdc" })
      ).toBeNull();
      expect(
        await getDebugParameterNodeBinding(db, {
          organizationId: ORG_A,
          parameterId: parameter.id,
          protocol: "hdc",
          includeDisabled: true
        })
      ).toMatchObject({ enabled: false });
    });

    it("refuses to bind a parameter owned by another organization", async () => {
      const parameter = await createDebugParameter(db, parameterInput());

      const crossTenant = await upsertDebugParameterNodeBinding(db, {
        organizationId: ORG_B,
        parameterId: parameter.id,
        protocol: "hdc",
        nodePath: "/sys/steal",
        accessMode: "RW",
        enabled: true
      });
      expect(crossTenant).toBeNull();
      expect(await listDebugParameterNodeBindings(db, { organizationId: ORG_B })).toEqual([]);
    });

    it("lists bindings for selected parameters and returns only the enabled ADB smoke default", async () => {
      const parameterOne = await createDebugParameter(db, parameterInput({ key: "k.one" }));
      const parameterTwo = await createDebugParameter(db, parameterInput({ key: "k.two", name: "Second" }));
      await upsertDebugParameterNodeBinding(db, {
        organizationId: ORG_A,
        parameterId: parameterOne.id,
        protocol: "hdc",
        nodePath: "/sys/one",
        accessMode: "RW",
        enabled: true
      });
      await upsertDebugParameterNodeBinding(db, {
        organizationId: ORG_A,
        parameterId: parameterTwo.id,
        protocol: "adb",
        nodePath: "/sys/two",
        accessMode: "RO",
        enabled: true
      });

      const selected = await listDebugParameterNodeBindings(db, {
        organizationId: ORG_A,
        parameterIds: [parameterOne.id]
      });
      expect(selected.map((binding) => binding.parameterId)).toEqual([parameterOne.id]);

      // Smoke default is a stated fact on the row, not any adb binding.
      expect(await getDefaultAdbSmokeParameterNodeBinding(db, { organizationId: ORG_A })).toBeNull();

      await db.query(
        `insert into debugging_parameter_node_bindings (
           id, organization_id, parameter_id, protocol, node_path, access_mode, enabled, is_smoke_default
         ) values ('smoke-binding-1', $1, $2, 'adb', '/sys/smoke', 'RO', true, true)`,
        [ORG_A, parameterOne.id]
      );
      expect(await getDefaultAdbSmokeParameterNodeBinding(db, { organizationId: ORG_A })).toMatchObject({
        id: "smoke-binding-1",
        protocol: "adb"
      });

      await db.query(`update debugging_parameter_node_bindings set enabled = false where id = 'smoke-binding-1'`);
      expect(await getDefaultAdbSmokeParameterNodeBinding(db, { organizationId: ORG_A })).toBeNull();
      expect(
        await getDefaultAdbSmokeParameterNodeBinding(db, { organizationId: ORG_A, includeDisabled: true })
      ).toMatchObject({ id: "smoke-binding-1" });
    });
  });

  describe("devices and detected targets", () => {
    it("scopes device lists and lookups to the organization", async () => {
      const devicesA = await listDebugDevices(db, { organizationId: ORG_A });
      expect(devicesA.map((device) => device.id)).toEqual([DEVICE_A]);

      expect(await getDebugDevice(db, { organizationId: ORG_A, deviceId: DEVICE_B })).toBeNull();
      expect(await getDebugDevice(db, { organizationId: ORG_A, deviceId: DEVICE_A })).toMatchObject({
        id: DEVICE_A,
        name: "Bench A"
      });
    });

    it("upsertDetectedTargets updates target status, derives device status, and auto-creates bridge devices", async () => {
      const records = await upsertDetectedTargets(db, {
        organizationId: ORG_A,
        targets: [
          { id: TARGET_A, deviceId: DEVICE_A, targetRef: "ref-a", label: "Target A", online: false },
          {
            id: "bridge:mac-1:hdc:serial-9",
            deviceId: "bridge:mac-1",
            bridgeId: "mac-1",
            bridgeMachineLabel: "Mac Bench",
            protocol: "hdc",
            targetRef: "serial-9",
            label: "Bridged phone",
            online: true
          }
        ]
      });

      expect(records).toHaveLength(2);
      expect(await getDebugTarget(db, { organizationId: ORG_A, targetId: TARGET_A })).toMatchObject({ status: "lost" });

      // The lost target flips its device offline; the bridge device is created online.
      expect(await getDebugDevice(db, { organizationId: ORG_A, deviceId: DEVICE_A })).toMatchObject({
        status: "offline"
      });
      expect(await getDebugDevice(db, { organizationId: ORG_A, deviceId: "bridge:mac-1" })).toMatchObject({
        status: "online",
        name: "Mac Bench"
      });
    });

    it("ensureBridgeDebugDevice upserts only bridge-prefixed device ids", async () => {
      await ensureBridgeDebugDevice(db, {
        organizationId: ORG_A,
        deviceId: "plain-device-id",
        name: "ignored",
        protocol: "hdc"
      });
      expect(await getDebugDevice(db, { organizationId: ORG_A, deviceId: "plain-device-id" })).toBeNull();

      await ensureBridgeDebugDevice(db, {
        organizationId: ORG_A,
        deviceId: "bridge:mac-2",
        name: "Bridge Two",
        protocol: "adb"
      });
      expect(await getDebugDevice(db, { organizationId: ORG_A, deviceId: "bridge:mac-2" })).toMatchObject({
        name: "Bridge Two",
        status: "online"
      });
    });
  });

  describe("sessions and device leases", () => {
    it("createDebugSession persists an active session readable by its organization only", async () => {
      const session = await createDebugSession(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        targetId: TARGET_A,
        actorUserId: USER_A
      });

      expect(session).toMatchObject({ status: "active", deviceId: DEVICE_A, targetId: TARGET_A });
      expect(await getDebugSession(db, { organizationId: ORG_A, sessionId: session.id })).toMatchObject({
        id: session.id,
        actorUserId: USER_A
      });
      expect(await getDebugSession(db, { organizationId: ORG_B, sessionId: session.id })).toBeNull();
    });

    it("ensureDtsReloadLeaseSession creates target + synthetic session idempotently", async () => {
      const input = {
        organizationId: ORG_A,
        sessionId: "dts-reload:run-1",
        deviceId: DEVICE_A,
        bridgeId: "mac-1",
        bridgeMachineLabel: "Mac Bench",
        protocol: "hdc" as const,
        targetRef: "serial-9",
        actorUserId: USER_A
      };
      await ensureDtsReloadLeaseSession(db, input);
      await ensureDtsReloadLeaseSession(db, input);

      const session = await getDebugSession(db, { organizationId: ORG_A, sessionId: "dts-reload:run-1" });
      expect(session).toMatchObject({ status: "active", executionMode: "bridge", bridgeId: "mac-1" });
      expect(
        await getDebugTarget(db, {
          organizationId: ORG_A,
          targetId: "bridge:mac-1:hdc:serial-9"
        })
      ).toMatchObject({ status: "detected", label: "Mac Bench" });
    });

    it("lease acquisition renews for the owner, refuses a live competitor, and allows takeover after expiry", async () => {
      const ownerSession = await createDebugSession(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        targetId: TARGET_A,
        actorUserId: USER_A
      });
      const rivalSession = await createDebugSession(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        targetId: TARGET_A,
        actorUserId: USER_A
      });

      const acquired = await acquireDebugDeviceLease(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        sessionId: ownerSession.id,
        actorUserId: USER_A,
        leaseTtlMs: 60_000
      });
      expect(acquired?.sessionId).toBe(ownerSession.id);

      // The owner renews without resetting acquired_at. Backdate it first so
      // the "keep" branch is distinguishable under the frozen transaction now().
      await db.query(`update debug_device_leases set acquired_at = now() - interval '2 hours' where device_id = $1`, [
        DEVICE_A
      ]);
      const renewed = await acquireDebugDeviceLease(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        sessionId: ownerSession.id,
        actorUserId: USER_A,
        leaseTtlMs: 60_000
      });
      expect(renewed?.acquiredAt).not.toBe(acquired?.acquiredAt);
      expect(new Date(renewed!.acquiredAt).getTime()).toBeLessThan(new Date(acquired!.acquiredAt).getTime());

      // A live lease cannot be stolen by another session.
      const stolen = await acquireDebugDeviceLease(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        sessionId: rivalSession.id,
        actorUserId: USER_A,
        leaseTtlMs: 60_000
      });
      expect(stolen).toBeNull();

      // After expiry the rival takes over and acquired_at resets to now().
      // Inside the fixture's single transaction now() is frozen, so backdate
      // acquired_at first and assert the takeover overwrites the backdated value.
      await db.query(
        `update debug_device_leases
         set expires_at = now() - interval '1 second',
             acquired_at = now() - interval '1 hour'
         where device_id = $1`,
        [DEVICE_A]
      );
      const takenOver = await acquireDebugDeviceLease(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        sessionId: rivalSession.id,
        actorUserId: USER_A,
        leaseTtlMs: 60_000
      });
      expect(takenOver?.sessionId).toBe(rivalSession.id);
      expect(takenOver?.acquiredAt).toBe(acquired?.acquiredAt);
    });

    it("releaseDebugDeviceLease expires only the owning session's lease", async () => {
      const ownerSession = await createDebugSession(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        targetId: TARGET_A,
        actorUserId: USER_A
      });
      const strangerSession = await createDebugSession(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        targetId: TARGET_A,
        actorUserId: USER_A
      });
      await acquireDebugDeviceLease(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        sessionId: ownerSession.id,
        actorUserId: USER_A,
        leaseTtlMs: 60_000
      });

      expect(
        await releaseDebugDeviceLease(db, { organizationId: ORG_A, deviceId: DEVICE_A, sessionId: strangerSession.id })
      ).toBeNull();

      const released = await releaseDebugDeviceLease(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        sessionId: ownerSession.id
      });
      expect(released?.sessionId).toBe(ownerSession.id);

      // The lease is expired: the stranger can now acquire it.
      const nextOwner = await acquireDebugDeviceLease(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        sessionId: strangerSession.id,
        actorUserId: USER_A,
        leaseTtlMs: 60_000
      });
      expect(nextOwner?.sessionId).toBe(strangerSession.id);
    });
  });

  describe("node operations, snapshots, and events", () => {
    async function seedSession() {
      return createDebugSession(db, {
        organizationId: ORG_A,
        deviceId: DEVICE_A,
        targetId: TARGET_A,
        actorUserId: USER_A
      });
    }

    it("insertNodeOperation stores read/write outcome fields and lists them newest-last", async () => {
      const session = await seedSession();

      const write = await insertNodeOperation(db, {
        organizationId: ORG_A,
        sessionId: session.id,
        parameterId: null,
        nodePath: "/sys/class/power/fast_charge",
        operationType: "write",
        status: "succeeded",
        requestedValue: "1",
        previousValue: "3000",
        readbackValue: "0x1",
        verified: null,
        writeOutcome: "executed",
        readbackOutcome: "observed",
        durationMs: 42,
        actorUserId: USER_A
      });
      expect(write).toMatchObject({
        operationType: "write",
        status: "succeeded",
        requestedValue: "1",
        previousValue: "3000",
        readbackValue: "0x1",
        verified: null,
        writeOutcome: "executed",
        readbackOutcome: "observed",
        durationMs: 42
      });

      const failedRead = await insertNodeOperation(db, {
        organizationId: ORG_A,
        sessionId: session.id,
        parameterId: null,
        nodePath: "/sys/class/power/fast_charge",
        operationType: "read",
        status: "failed",
        relatedOperationId: write.id,
        failureReason: "node busy",
        durationMs: 7,
        actorUserId: USER_A
      });
      expect(failedRead).toMatchObject({ status: "failed", failureReason: "node busy", relatedOperationId: write.id });

      // created_at is frozen inside the fixture transaction; backdate the first
      // operation so the newest-last ordering is observable.
      await db.query(`update node_operations set created_at = now() - interval '1 minute' where id = $1`, [write.id]);
      const events = await listDebugSessionEvents(db, { organizationId: ORG_A, sessionId: session.id });
      expect(events.map((event) => event.id)).toEqual([write.id, failedRead.id]);
      expect(await listDebugSessionEvents(db, { organizationId: ORG_B, sessionId: session.id })).toEqual([]);
    });

    it("insertNodeOperation never falls a parameterId back into the node_id FK column, in either identity mode (#416)", async () => {
      const session = await seedSession();
      const parameter = await createDebugParameter(db, parameterInput());

      // No debug_nodes row shares the parameter's id (production admin creation
      // never writes one), so these inserts only succeed because node_id stays
      // null instead of borrowing the parameter id.
      for (const mode of ["semantic", "legacy"] as const) {
        setParameterIdentityMode(mode);
        const operation = await insertNodeOperation(db, {
          organizationId: ORG_A,
          sessionId: session.id,
          parameterId: parameter.id,
          nodePath: "/sys/class/power/debug/fast_charge/current",
          operationType: "read",
          status: "succeeded",
          readValue: "3000",
          verified: true,
          durationMs: 3,
          actorUserId: USER_A
        });

        const row = await db.query<{ parameter_id: string | null; node_id: string | null }>(
          `select parameter_id, node_id from node_operations where id = $1`,
          [operation.id]
        );
        expect(row.rows, `identity mode: ${mode}`).toEqual([{ parameter_id: parameter.id, node_id: null }]);
      }
    });

    it("snapshot lifecycle: valid → rollback_pending → valid → consumed, each edge scoped and single-shot", async () => {
      const session = await seedSession();
      const snapshot = await createDebugSnapshot(db, {
        organizationId: ORG_A,
        sessionId: session.id,
        risk: "High",
        entries: [{ nodePath: "/sys/a", value: "1" }],
        createdByUserId: USER_A
      });
      expect(snapshot.status).toBe("valid");
      expect(snapshot.entries).toEqual([{ nodePath: "/sys/a", value: "1" }]);

      // Cross-tenant claims never move the state machine.
      expect(await claimSnapshotForRollback(db, { organizationId: ORG_B, snapshotId: snapshot.id })).toBeNull();

      const claimed = await claimSnapshotForRollback(db, { organizationId: ORG_A, snapshotId: snapshot.id });
      expect(claimed?.status).toBe("rollback_pending");
      // The claim is single-shot: a second concurrent claimer loses.
      expect(await claimSnapshotForRollback(db, { organizationId: ORG_A, snapshotId: snapshot.id })).toBeNull();

      const restored = await restoreSnapshotValid(db, { organizationId: ORG_A, snapshotId: snapshot.id });
      expect(restored?.status).toBe("valid");
      // Restore only applies to rollback_pending rows.
      expect(await restoreSnapshotValid(db, { organizationId: ORG_A, snapshotId: snapshot.id })).toBeNull();

      const consumed = await markSnapshotConsumed(db, { organizationId: ORG_A, snapshotId: snapshot.id });
      expect(consumed?.status).toBe("consumed");
      // Consumed snapshots cannot be reused or reclaimed.
      expect(await markSnapshotConsumed(db, { organizationId: ORG_A, snapshotId: snapshot.id })).toBeNull();
      expect(await claimSnapshotForRollback(db, { organizationId: ORG_A, snapshotId: snapshot.id })).toBeNull();

      expect(await getDebugSnapshot(db, { organizationId: ORG_A, snapshotId: snapshot.id })).toMatchObject({
        status: "consumed"
      });
    });

    it("links a snapshot to an operation only within the same session and organization", async () => {
      const session = await seedSession();
      const otherSession = await seedSession();

      const operation = await insertNodeOperation(db, {
        organizationId: ORG_A,
        sessionId: session.id,
        parameterId: null,
        nodePath: "/sys/a",
        operationType: "write",
        status: "success",
        durationMs: 5,
        actorUserId: USER_A
      });
      const sameSession = await createDebugSnapshot(db, {
        organizationId: ORG_A,
        sessionId: session.id,
        risk: "Medium",
        entries: [],
        createdByUserId: USER_A
      });
      const foreignSession = await createDebugSnapshot(db, {
        organizationId: ORG_A,
        sessionId: otherSession.id,
        risk: "Medium",
        entries: [],
        createdByUserId: USER_A
      });

      await linkOperationSnapshot(db, {
        organizationId: ORG_A,
        operationId: operation.id,
        snapshotId: foreignSession.id
      });
      let events = await listDebugSessionEvents(db, { organizationId: ORG_A, sessionId: session.id });
      expect(events[0]?.snapshotId).toBeNull();

      await linkOperationSnapshot(db, {
        organizationId: ORG_A,
        operationId: operation.id,
        snapshotId: sameSession.id
      });
      events = await listDebugSessionEvents(db, { organizationId: ORG_A, sessionId: session.id });
      expect(events[0]?.snapshotId).toBe(sameSession.id);
    });

    it("insertDebugEvent persists audit trail rows with metadata", async () => {
      const session = await seedSession();
      await insertDebugEvent(db, {
        organizationId: ORG_A,
        sessionId: session.id,
        kind: "session-started",
        severity: "info",
        message: "Session started on Bench A",
        metadata: { deviceId: DEVICE_A }
      });

      const rows = await db.query<{ kind: string; severity: string; message: string; metadata: unknown }>(
        `select kind, severity, message, metadata from debugging_events where organization_id = $1 and session_id = $2`,
        [ORG_A, session.id]
      );
      expect(rows.rows).toEqual([
        {
          kind: "session-started",
          severity: "info",
          message: "Session started on Bench A",
          metadata: { deviceId: DEVICE_A }
        }
      ]);
    });
  });
});
