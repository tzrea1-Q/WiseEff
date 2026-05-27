import { describe, expect, it } from "vitest";
import {
  debugDeviceFromDto,
  debugParameterFromDto,
  debugTargetFromDto,
  nodeOperationFromDto,
  nodeReadResultFromDto,
  nodeWriteResultFromDto,
  type DebugDeviceDto,
  type DebugParameterDto,
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

  it("maps detected targets", () => {
    expect(debugTargetFromDto(targetDto)).toEqual(targetDto);
  });

  it("maps node operations without dropping snapshot or failure details", () => {
    expect(nodeOperationFromDto(writeOperationDto)).toMatchObject({
      failureReason: "Readback mismatch.",
      snapshotId: "snap-1"
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
