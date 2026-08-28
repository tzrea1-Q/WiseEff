import { describe, expect, it } from "vitest";

import type { DebuggingGateway } from "@/application/ports/DebuggingGateway";
import { isHdcPlaceholderTarget } from "@wiseeff/device-command-core/hdcTargets";
import {
  createMockDebuggingBridgeSeams,
  createMockDebuggingGateway,
  MOCK_DEBUG_BRIDGE_ID,
  MOCK_DEBUG_DEVICE_ID,
  MOCK_DEBUG_TARGET_REF
} from "./mockDebuggingGateway";

function createGateway(): DebuggingGateway {
  return createMockDebuggingGateway();
}

async function startSession(gateway: DebuggingGateway, protocol: "hdc" | "adb" = "hdc") {
  const [target] = await gateway.detectTargets({ protocol });
  return gateway.createSession!({
    deviceId: target!.deviceId ?? MOCK_DEBUG_DEVICE_ID,
    targetId: target!.id,
    protocol,
    bridgeId: target!.bridgeId
  });
}

describe("createMockDebuggingGateway (DebuggingGateway contract)", () => {
  it("serves a bridge-backed, non-placeholder target for both protocols and starts sessions with a detect event", async () => {
    const gateway = createGateway();

    for (const protocol of ["hdc", "adb"] as const) {
      const targets = await gateway.detectTargets({ protocol });
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({
        deviceId: MOCK_DEBUG_DEVICE_ID,
        bridgeId: MOCK_DEBUG_BRIDGE_ID,
        protocol,
        targetRef: MOCK_DEBUG_TARGET_REF
      });
      expect(isHdcPlaceholderTarget(targets[0]!.targetRef!)).toBe(false);
    }

    const session = await startSession(gateway, "adb");
    expect(session.status).toBe("active");
    expect(session.protocol).toBe("adb");
    await expect(gateway.getSession!(session.id)).resolves.toEqual(session);
    await expect(gateway.getSession!("missing-session")).resolves.toBeNull();

    const events = await gateway.listSessionEvents!(session.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ operationType: "detect", status: "succeeded", protocol: "adb" });
  });

  it("reads the seeded device story: catalog values plus plausible drifts, and honest failures", async () => {
    const gateway = createGateway();
    const session = await startSession(gateway);

    // Drifted node: the device-side value visibly differs from the catalog value.
    const drifted = await gateway.readNode({ sessionId: session.id, nodeId: "dbg-charge-input-current" });
    expect(drifted).toMatchObject({ ok: true, value: "3651" });

    // Undrifted read-only node serves the catalog value.
    const catalog = await gateway.readNode({ sessionId: session.id, nodeId: "dbg-battery-impedance" });
    expect(catalog).toMatchObject({ ok: true, value: "68" });

    // Node-path lookup works without an id (same resolution the page relies on).
    const byPath = await gateway.readNode({
      sessionId: session.id,
      nodePath: "/data/local/tmp/wiseeff_nodes/battery/cell_temp_limit_c"
    });
    expect(byPath).toMatchObject({ ok: true, value: "41" });

    // Write-only nodes and unknown nodes fail honestly instead of inventing values.
    await expect(gateway.readNode({ sessionId: session.id, nodeId: "dbg-trickle-start" })).rejects.toThrow(
      "仅支持写入"
    );
    await expect(gateway.readNode({ sessionId: session.id, nodeId: "dbg-missing" })).rejects.toThrow(
      "未找到调试节点"
    );

    // Complex values serve the full payload with preview metadata on the operation.
    const complex = (await gateway.readNode({ sessionId: session.id, nodeId: "dbg-charge-policy-json" })) as Awaited<
      ReturnType<DebuggingGateway["readNode"]>
    > & { operation?: { valueKind?: string; valuePreview?: string } };
    expect(complex.ok).toBe(true);
    expect(complex.value).toContain("inputLimitMa");
    expect(complex.operation?.valueKind).toBe("complex");
    expect(complex.operation?.valuePreview).toBeTruthy();
  });

  it("enforces the high-risk write token, persists the write, and captures a rollback snapshot", async () => {
    const gateway = createGateway();
    const session = await startSession(gateway);

    // Same gate as the server: High-risk writes refuse without the confirmation token.
    await expect(
      gateway.writeNode({ sessionId: session.id, nodeId: "dbg-charge-input-current", value: "3700", readBack: true })
    ).rejects.toThrow("confirm-high-risk-write");

    const written = (await gateway.writeNode({
      sessionId: session.id,
      nodeId: "dbg-charge-input-current",
      value: "3700",
      readBack: true,
      confirmationToken: "confirm-high-risk-write"
    })) as Awaited<ReturnType<DebuggingGateway["writeNode"]>> & {
      operation?: { snapshotId?: string; previousValue?: string };
      snapshot?: { id: string; status: string };
    };
    expect(written).toMatchObject({
      ok: true,
      value: "3700",
      verified: null,
      writeOutcome: "executed",
      readbackOutcome: "observed"
    });
    expect(written.operation?.previousValue).toBe("3651");
    expect(written.snapshot?.status).toBe("valid");
    expect(written.operation?.snapshotId).toBe(written.snapshot?.id);

    // The write persisted: the next read serves the new device value.
    await expect(gateway.readNode({ sessionId: session.id, nodeId: "dbg-charge-input-current" })).resolves.toMatchObject({
      ok: true,
      value: "3700"
    });

    // Low-risk RW writes need no token; RO writes fail honestly.
    await expect(
      gateway.writeNode({ sessionId: session.id, nodeId: "dbg-thermal-foldback", value: "78", readBack: true })
    ).resolves.toMatchObject({ ok: true, verified: null, writeOutcome: "executed", readbackOutcome: "observed" });
    await expect(
      gateway.writeNode({ sessionId: session.id, nodeId: "dbg-battery-impedance", value: "70", readBack: false })
    ).rejects.toThrow("只读");

    // Write-only writes are rejected because the safety contract requires a pre-write rollback snapshot.
    await expect(
      gateway.writeNode({
        sessionId: session.id,
        nodeId: "dbg-trickle-start",
        value: "95",
        readBack: false
      })
    ).rejects.toThrow("无法取得写前快照");
  });

  it("rolls back a write snapshot with confirm-rollback, restoring the pre-write value exactly once", async () => {
    const gateway = createGateway();
    const session = await startSession(gateway);
    const written = (await gateway.writeNode({
      sessionId: session.id,
      nodeId: "dbg-charge-input-current",
      value: "3700",
      readBack: true,
      confirmationToken: "confirm-high-risk-write"
    })) as Awaited<ReturnType<DebuggingGateway["writeNode"]>> & { snapshot?: { id: string } };
    const snapshotId = written.snapshot!.id;

    // Same gate as the server: rollback refuses without the confirmation token.
    await expect(
      gateway.rollbackSnapshot!({ snapshotId, confirmationToken: "wrong-token" })
    ).rejects.toThrow("confirm-rollback");

    const rolledBack = await gateway.rollbackSnapshot!({ snapshotId, confirmationToken: "confirm-rollback" });
    expect(rolledBack.snapshot.status).toBe("consumed");
    expect(rolledBack.operations).toHaveLength(1);
    expect(rolledBack.operations[0]).toMatchObject({
      operationType: "rollback",
      status: "succeeded",
      requestedValue: "3651",
      snapshotId
    });

    // The device value is restored, the rollback landed in session events, and the
    // consumed snapshot cannot be replayed.
    await expect(gateway.readNode({ sessionId: session.id, nodeId: "dbg-charge-input-current" })).resolves.toMatchObject({
      ok: true,
      value: "3651"
    });
    const events = await gateway.listSessionEvents!(session.id);
    expect(events.some((event) => event.operationType === "rollback")).toBe(true);
    await expect(
      gateway.rollbackSnapshot!({ snapshotId, confirmationToken: "confirm-rollback" })
    ).rejects.toThrow("已被使用");
  });

  it("serves the injected live catalog and exposes walkable bridge seams", async () => {
    const customCatalog = [
      {
        id: "dbg-custom",
        name: "自定义节点",
        key: "custom.node",
        description: "",
        module: "Charging Policy",
        currentValue: "7",
        targetValue: "8",
        unit: "",
        range: "0 - 10",
        risk: "Low" as const,
        status: "已同步" as const,
        nodePath: "/data/local/tmp/wiseeff_nodes/custom/node",
        accessMode: "RW" as const
      }
    ];
    const gateway = createMockDebuggingGateway({ getDebugParameters: () => customCatalog });

    await expect(gateway.listRuntimeNodes!({ protocol: "hdc" })).resolves.toEqual(customCatalog);
    const session = await startSession(gateway);
    await expect(gateway.readNode({ sessionId: session.id, nodeId: "dbg-custom" })).resolves.toMatchObject({
      ok: true,
      value: "7"
    });

    const seams = createMockDebuggingBridgeSeams();
    expect(seams.bridges[0]).toMatchObject({ id: MOCK_DEBUG_BRIDGE_ID, revokedAt: null });
    const probe = await seams.probeBridgeHealth();
    expect(probe.health).toMatchObject({ connected: true, bridgeId: MOCK_DEBUG_BRIDGE_ID });
    expect(probe.health?.tools).toMatchObject({ adb: { available: true }, hdc: { available: true } });
    await expect(seams.createPairingCode()).resolves.toMatchObject({ code: "000000" });
  });
});
