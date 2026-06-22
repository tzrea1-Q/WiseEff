import { describe, expect, it } from "vitest";
import {
  debugDeviceFromDto,
  debugParameterFromDto,
  debugSnapshotFromDto,
  debugTargetFromDto,
  nodeOperationFromDto,
  nodeReadResultFromDto,
  nodeWriteResultFromDto,
  type DebugDeviceDto,
  type DebugParameterDto,
  type DebugSnapshotDto,
  type DebugTargetDto,
  type NodeOperationDto
} from "./debuggingDtos";

const deviceDto: DebugDeviceDto = {
  id: "device-1",
  projectId: "aurora",
  name: "Simulator",
  firmware: "1.0.0",
  status: "online",
  lastSeenAt: "2026-05-25T02:00:00.000Z"
};

const parameterDto: DebugParameterDto = {
  id: "param-1",
  projectId: "aurora",
  name: "Fast charge current",
  key: "fast-charge-current",
  description: "Charge limit",
  module: "power",
  nodePath: "/sys/class/power_supply/battery/constant_charge_current",
  accessMode: "RW",
  unit: "mA",
  range: "0-6000",
  risk: "High",
  currentValue: "3000",
  targetValue: "3100"
};

const targetDto: DebugTargetDto = {
  id: "target-1",
  deviceId: "device-1",
  label: "Android device",
  targetRef: "adb:device-1",
  status: "detected"
};

const readOperationDto: NodeOperationDto = {
  id: "op-1",
  sessionId: "session-1",
  parameterId: "param-1",
  nodePath: "/sys/class/power_supply/battery/constant_charge_current",
  operationType: "read",
  status: "succeeded",
  requestedValue: null,
  previousValue: null,
  readValue: "3000",
  readbackValue: null,
  verified: true,
  failureReason: null,
  durationMs: 42,
  snapshotId: null,
  createdAt: "2026-05-25T02:00:00.000Z"
};

const writeOperationDto: NodeOperationDto = {
  ...readOperationDto,
  id: "op-2",
  operationType: "write",
  status: "readback_mismatch",
  requestedValue: "3100",
  readValue: "3000",
  readbackValue: "3000",
  verified: false,
  failureReason: "Readback mismatch.",
  snapshotId: "snap-1"
};

const rollbackPendingSnapshotDto: DebugSnapshotDto = {
  id: "snap-1",
  sessionId: "session-1",
  status: "rollback_pending",
  risk: "High",
  createdAt: "2026-05-25T02:00:00.000Z"
};

describe("debugging dto mappers", () => {
  it("maps debug device status to the existing domain literal", () => {
    expect(debugDeviceFromDto(deviceDto)).toMatchObject({
      id: "device-1",
      status: "已连接"
    });
  });

  it("maps debug parameter fields and status", () => {
    expect(debugParameterFromDto(parameterDto)).toMatchObject({
      nodePath: parameterDto.nodePath,
      accessMode: "RW",
      range: "0-6000",
      risk: "High",
      currentValue: "3000",
      targetValue: "3100",
      status: "已同步"
    });
  });

  it("maps protocol binding state into debug parameters", () => {
    expect(
      debugParameterFromDto({
        ...parameterDto,
        nodePath: "/legacy/current",
        accessMode: "RO",
        selectedBinding: {
          protocol: "adb",
          nodePath: "/sys/adb/current",
          accessMode: "RW",
          enabled: true
        },
        bindings: []
      } as DebugParameterDto)
    ).toMatchObject({
      id: "param-1",
      selectedProtocol: "adb",
      nodePath: "/sys/adb/current",
      accessMode: "RW",
      bindingStatus: "configured"
    });
  });

  it("maps missing selected binding into an unavailable row", () => {
    expect(
      debugParameterFromDto({
        ...parameterDto,
        selectedBinding: null,
        bindings: []
      } as DebugParameterDto)
    ).toMatchObject({
      nodePath: "",
      accessMode: "RO",
      bindingStatus: "missing"
    });
  });

  it("maps binding-only protocol parameters without legacy node fields", () => {
    expect(
      debugParameterFromDto({
        id: "param-1",
        projectId: "aurora",
        name: "Fast charge current",
        key: "fast-charge-current",
        description: "Charge limit",
        module: "power",
        unit: "mA",
        range: "0-6000",
        risk: "High",
        currentValue: "3000",
        targetValue: "3100",
        selectedBinding: {
          protocol: "adb",
          nodePath: "/sys/adb/current",
          accessMode: "RW",
          enabled: true,
          notes: null
        },
        bindings: []
      } as DebugParameterDto)
    ).toMatchObject({
      selectedProtocol: "adb",
      nodePath: "/sys/adb/current",
      accessMode: "RW",
      bindingStatus: "configured"
    });
  });

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

  it("maps disabled selected bindings into unavailable rows", () => {
    expect(
      debugParameterFromDto({
        ...parameterDto,
        selectedBinding: {
          protocol: "adb",
          nodePath: "/sys/adb/current",
          accessMode: "RW",
          enabled: false,
          notes: "待验证"
        },
        bindings: []
      } as DebugParameterDto)
    ).toMatchObject({
      selectedProtocol: "adb",
      nodePath: "",
      accessMode: "RO",
      bindingStatus: "disabled",
      bindingDisabledReason: "待验证"
    });
  });

  it("maps detected targets", () => {
    expect(debugTargetFromDto(targetDto)).toEqual(targetDto);
  });

  it("maps node operations without dropping snapshot or failure details", () => {
    expect(nodeOperationFromDto(writeOperationDto)).toMatchObject({
      failureReason: "Readback mismatch.",
      snapshotId: "snap-1"
    });
  });

  it("maps rollback pending snapshot status without dropping claimed state", () => {
    expect(debugSnapshotFromDto(rollbackPendingSnapshotDto)).toMatchObject({
      id: "snap-1",
      status: "rollback_pending"
    });
  });

  it("maps a successful read result", () => {
    expect(nodeReadResultFromDto(readOperationDto)).toMatchObject({
      ok: true,
      value: "3000",
      stdout: undefined,
      durationMs: 42
    });
  });

  it("maps readback mismatch writes as unverified with an error", () => {
    expect(nodeWriteResultFromDto({ operation: writeOperationDto })).toMatchObject({
      verified: false,
      error: "Readback mismatch."
    });
  });
});
