import { describe, expect, it, vi } from "vitest";

import { createApiClient, WiseEffApiError } from "./apiClient";
import { createHttpDebuggingGateway } from "./debuggingClient";
import type { GetSessionResponseEnvelope } from "./debuggingClient";
import type { DebugSessionSnapshot } from "@/application/ports/DebuggingGateway";
import type {
  DebugDeviceDto,
  DebugParameterDto,
  DebugSnapshotDto,
  DebugTargetDto,
  NodeOperationDto
} from "./debuggingDtos";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function createFetchMock(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => jsonResponse(body, status));
}

function createGateway(fetchMock: typeof fetch) {
  return createHttpDebuggingGateway(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));
}

type Equal<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2
    ? (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
      ? true
      : false
    : false;

type Expect<T extends true> = T;

export type GetSessionResponseEnvelopeContract = Expect<
  Equal<GetSessionResponseEnvelope, { item: DebugSessionSnapshot | null }>
>;

const deviceDto: DebugDeviceDto = {
  id: "device-1",
  name: "Aurora Simulator",
  firmware: "sim-1.0",
  status: "online",
  lastSeenAt: "2026-05-27T10:00:00.000Z"
};

const parameterDto: DebugParameterDto = {
  id: "param-1",
  name: "Fast charge current",
  key: "fast_charge_current",
  description: "Controls constant charge current.",
  module: "Battery",
  nodePath: "/sys/current",
  accessMode: "RW",
  unit: "mA",
  range: "0-5000",
  risk: "High",
  currentValue: "3000",
  targetValue: "3200"
};

const targetDto: DebugTargetDto = {
  id: "target-1",
  deviceId: "device-1",
  label: "Aurora Target",
  targetRef: "simulator://aurora-1",
  status: "detected"
};

const sessionDto = {
  id: "session-1",
  deviceId: "device-1",
  targetId: "target-1",
  status: "active",
  startedAt: "2026-05-27T10:00:00.000Z",
  endedAt: null
} as const;

const readOperationDto: NodeOperationDto = {
  id: "op-read",
  sessionId: "session-1",
  parameterId: "param-1",
  nodePath: "/sys/current",
  operationType: "read",
  status: "succeeded",
  requestedValue: null,
  previousValue: null,
  readValue: "3000",
  readbackValue: null,
  verified: true,
  failureReason: null,
  durationMs: 5,
  snapshotId: null,
  createdAt: "2026-05-27T10:01:00.000Z"
};

const writeOperationDto: NodeOperationDto = {
  ...readOperationDto,
  id: "op-write",
  operationType: "write",
  requestedValue: "3200",
  previousValue: "3000",
  readbackValue: "3200",
  snapshotId: "snapshot-1"
};

const snapshotDto: DebugSnapshotDto = {
  id: "snapshot-1",
  sessionId: "session-1",
  status: "consumed",
  risk: "High",
  createdAt: "2026-05-27T10:02:00.000Z"
};

describe("createHttpDebuggingGateway", () => {
  it("lists devices from the debugging devices endpoint", async () => {
    const fetchMock = createFetchMock({ items: [deviceDto] });
    const gateway = createGateway(fetchMock);

    await expect(gateway.listDevices?.()).resolves.toEqual([deviceDto]);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/debugging/devices", expect.objectContaining({ method: "GET" }));
  });

  it("lists parameters with optional protocol filter", async () => {
    const fetchMock = createFetchMock({ items: [parameterDto] });
    const gateway = createGateway(fetchMock);

    await expect(gateway.listParameters?.({ protocol: "adb" })).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/debugging/parameters?protocol=adb", expect.objectContaining({ method: "GET" }));
  });

  it("detects targets through the production endpoint", async () => {
    const fetchMock = createFetchMock({ items: [targetDto] });
    const gateway = createGateway(fetchMock);

    await expect(gateway.detectTargets({ deviceId: "device-1" })).resolves.toEqual([targetDto]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/debugging/targets/detect",
      expect.objectContaining({
        body: JSON.stringify({ deviceId: "device-1" }),
        method: "POST"
      })
    );
  });

  it("sends protocol in detect and session requests", async () => {
    const fetchMock = createFetchMock({ items: [] });
    const gateway = createGateway(fetchMock);

    await gateway.detectTargets({ deviceId: "device-1", protocol: "adb" } as Parameters<typeof gateway.detectTargets>[0]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/debugging/targets/detect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ deviceId: "device-1", protocol: "adb" })
      })
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ item: { ...sessionDto, protocol: "adb" } }));

    await gateway.createSession?.({
      deviceId: "device-1",
      targetId: "adb:device-1",
      protocol: "adb"
    } as Parameters<NonNullable<typeof gateway.createSession>>[0]);

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/debugging/sessions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ deviceId: "device-1", targetId: "adb:device-1", protocol: "adb" })
      })
    );
  });

  it("creates debugging sessions through the production endpoint", async () => {
    const fetchMock = createFetchMock({ item: sessionDto });
    const gateway = createGateway(fetchMock);

    await expect(gateway.createSession?.({ deviceId: "device-1", targetId: "target-1" })).resolves.toEqual(sessionDto);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/debugging/sessions",
      expect.objectContaining({
        body: JSON.stringify({ deviceId: "device-1", targetId: "target-1" }),
        method: "POST"
      })
    );
  });

  it("lists debugging session events from the encoded session route", async () => {
    const fetchMock = createFetchMock({ items: [readOperationDto] });
    const gateway = createGateway(fetchMock);

    await expect(gateway.listSessionEvents?.("session/with spaces")).resolves.toMatchObject([{ id: "op-read" }]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/debugging/sessions/session%2Fwith%20spaces/events",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("reads nodes through the production endpoint", async () => {
    const fetchMock = createFetchMock({ operation: readOperationDto });
    const gateway = createGateway(fetchMock);
    const input = { sessionId: "session-1", nodePath: "/sys/current" };

    await expect(gateway.readNode(input)).resolves.toMatchObject({ ok: true, value: "3000" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/debugging/nodes/read",
      expect.objectContaining({
        body: JSON.stringify(input),
        method: "POST"
      })
    );
  });

  it("omits nodePath from API reads when parameterId is present", async () => {
    const fetchMock = createFetchMock({ operation: readOperationDto });
    const gateway = createGateway(fetchMock);

    await gateway.readNode({ sessionId: "session-1", parameterId: "param-1", nodePath: "/frontend/path" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/debugging/nodes/read",
      expect.objectContaining({
        body: JSON.stringify({ sessionId: "session-1", parameterId: "param-1" })
      })
    );
  });

  it("writes nodes with confirmation tokens through the production endpoint", async () => {
    const fetchMock = createFetchMock({ operation: writeOperationDto, snapshot: snapshotDto });
    const gateway = createGateway(fetchMock);
    const input = {
      sessionId: "session-1",
      nodePath: "/sys/current",
      value: "3200",
      readBack: true,
      confirmationToken: "confirm-high-risk-write"
    };

    await expect(gateway.writeNode(input)).resolves.toMatchObject({ ok: true, value: "3200", verified: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/debugging/nodes/write",
      expect.objectContaining({
        body: JSON.stringify(input),
        method: "POST"
      })
    );
  });

  it("omits nodePath from API writes when parameterId is present", async () => {
    const fetchMock = createFetchMock({ operation: writeOperationDto, snapshot: snapshotDto });
    const gateway = createGateway(fetchMock);

    await gateway.writeNode({
      sessionId: "session-1",
      parameterId: "param-1",
      nodePath: "/frontend/path",
      value: "3200",
      readBack: true
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/debugging/nodes/write",
      expect.objectContaining({
        body: JSON.stringify({ sessionId: "session-1", parameterId: "param-1", value: "3200", readBack: true })
      })
    );
  });

  it("rolls back snapshots with only the confirmation token in the body", async () => {
    const fetchMock = createFetchMock({ snapshot: snapshotDto, operations: [writeOperationDto] });
    const gateway = createGateway(fetchMock);

    await expect(gateway.rollbackSnapshot?.({ snapshotId: "snapshot/with spaces", confirmationToken: "confirm-rollback" })).resolves.toMatchObject({
      snapshot: snapshotDto,
      operations: [{ id: "op-write" }]
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/debugging/snapshots/snapshot%2Fwith%20spaces/rollback",
      expect.objectContaining({
        body: JSON.stringify({ confirmationToken: "confirm-rollback" }),
        method: "POST"
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).not.toHaveProperty("sessionId");
  });

  it("returns null when getSession receives a NOT_FOUND API error", async () => {
    const fetchMock = createFetchMock(
      {
        error: {
          code: "NOT_FOUND",
          message: "Debug session was not found.",
          details: { sessionId: "missing" },
          requestId: "req-1"
        }
      },
      404
    );
    const gateway = createGateway(fetchMock);

    await expect(gateway.getSession?.("missing")).resolves.toBeNull();
  });

  it("returns null when getSession receives an empty successful envelope", async () => {
    const fetchMock = createFetchMock({ item: null });
    const gateway = createGateway(fetchMock);

    await expect(gateway.getSession?.("missing")).resolves.toBeNull();
  });

  it("preserves WiseEffApiError failures from the API client", async () => {
    const fetchMock = createFetchMock(
      {
        error: {
          code: "FORBIDDEN",
          message: "Debugging view permission is required.",
          details: { permission: "debugging:view" },
          requestId: "req-1"
        }
      },
      403
    );
    const gateway = createGateway(fetchMock);

    await expect(gateway.listDevices?.()).rejects.toBeInstanceOf(WiseEffApiError);
  });
});
