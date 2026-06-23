import { describe, expect, it } from "vitest";
import {
  archiveDebugParameterBodySchema,
  createDebugSessionBodySchema,
  debugAdminBindingParamsSchema,
  debugAdminParameterParamsSchema,
  debugParameterNodeBindingSchema,
  detectTargetsBodySchema,
  listDebuggingAdminParametersQuerySchema,
  listDebuggingParametersQuerySchema,
  patchDebugParameterAdminBodySchema,
  upsertDebugParameterNodeBindingBodySchema,
  writeDebugParameterAdminBodySchema,
  readNodeBodySchema,
  rollbackSnapshotBodySchema,
  writeNodeBodySchema
} from "./schemas";

describe("debugging schemas", () => {
  it("accepts optional parameter query filters", () => {
    expect(
      listDebuggingParametersQuerySchema.parse({
        projectId: "aurora",
        module: "power",
        risk: ["Low", "High"]
      })
    ).toEqual({
      projectId: "aurora",
      module: "power",
      risk: ["Low", "High"]
    });
  });

  it("trims and requires target detection project input", () => {
    expect(() => detectTargetsBodySchema.parse({ projectId: "   " })).toThrow();
    expect(detectTargetsBodySchema.parse({ projectId: "aurora", deviceId: "sim-device-1" })).toEqual({
      projectId: "aurora",
      deviceId: "sim-device-1",
      protocol: "hdc"
    });
  });

  it("requires node session and path for reads", () => {
    expect(() => readNodeBodySchema.parse({ sessionId: "dbg-1", nodePath: "" })).toThrow();
  });

  it("defaults readBack to true for writes", () => {
    const parsed = writeNodeBodySchema.parse({
      sessionId: "dbg-1",
      parameterId: "dbg-fast-charge-current",
      nodePath: "/sys/class/power_supply/battery/constant_charge_current",
      value: "3100"
    });

    expect(parsed.readBack).toBe(true);
  });

  it("requires rollback confirmation", () => {
    expect(rollbackSnapshotBodySchema.parse({ confirmationToken: "confirm-rollback" })).toEqual({
      confirmationToken: "confirm-rollback"
    });
  });

  it("requires project, device, and target when creating sessions", () => {
    expect(() => createDebugSessionBodySchema.parse({ projectId: "aurora" })).toThrow();
  });
});

describe("debugging protocol schemas", () => {
  it("accepts hdc and adb protocols for target detection and sessions", () => {
    expect(detectTargetsBodySchema.parse({ projectId: "aurora", deviceId: "device-1", protocol: "adb" })).toEqual({
      projectId: "aurora",
      deviceId: "device-1",
      protocol: "adb"
    });
    expect(
      createDebugSessionBodySchema.parse({
        projectId: "aurora",
        deviceId: "device-1",
        targetId: "adb:serial-1",
        protocol: "adb"
      }).protocol
    ).toBe("adb");
  });

  it("requires bridgeId when targetId references a bridge-backed target", () => {
    expect(() =>
      createDebugSessionBodySchema.parse({
        projectId: "aurora",
        deviceId: "bridge:br-1",
        targetId: "bridge:br-1:adb:serial-1",
        protocol: "adb"
      })
    ).toThrow();
    expect(
      createDebugSessionBodySchema.parse({
        projectId: "aurora",
        deviceId: "bridge:br-1",
        targetId: "bridge:br-1:adb:serial-1",
        bridgeId: "br-1",
        protocol: "adb"
      })
    ).toMatchObject({ bridgeId: "br-1" });
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
    expect(
      debugParameterNodeBindingSchema.parse({
        protocol: "hdc",
        nodePath: "/sys/class/power_supply/battery/current_now",
        accessMode: "RW",
        enabled: true,
        notes: "lab path"
      })
    ).toEqual({
      protocol: "hdc",
      nodePath: "/sys/class/power_supply/battery/current_now",
      accessMode: "RW",
      enabled: true,
      notes: "lab path"
    });
    expect(() =>
      debugParameterNodeBindingSchema.parse({
        protocol: "adb",
        nodePath: "relative/path",
        accessMode: "RW",
        enabled: true
      })
    ).toThrow();
  });
});

describe("debugging admin schemas", () => {
  it("parses admin list filters", () => {
    expect(
      listDebuggingAdminParametersQuerySchema.parse({
        projectId: "aurora",
        includeArchived: "true",
        protocol: "adb",
        coverage: "missing-adb"
      })
    ).toEqual({
      projectId: "aurora",
      includeArchived: true,
      protocol: "adb",
      coverage: "missing-adb"
    });
  });

  it("validates parameter metadata and optional bindings", () => {
    expect(
      writeDebugParameterAdminBodySchema.parse({
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
      })
    ).toMatchObject({
      projectId: null,
      name: "Fast charge current",
      enabled: true,
      bindings: [expect.objectContaining({ protocol: "hdc", enabled: true })]
    });
  });

  it("rejects enabled bindings without absolute node paths", () => {
    expect(() =>
      upsertDebugParameterNodeBindingBodySchema.parse({
        nodePath: "relative",
        accessMode: "RW",
        enabled: true
      })
    ).toThrow();
  });

  it("accepts partial admin parameter patches with optional bindings", () => {
    expect(
      patchDebugParameterAdminBodySchema.parse({
        name: "Renamed",
        enabled: false,
        bindings: [
          {
            protocol: "adb",
            nodePath: "/sys/adb/path",
            accessMode: "RO",
            enabled: true
          }
        ]
      })
    ).toEqual({
      name: "Renamed",
      enabled: false,
      bindings: [
        {
          protocol: "adb",
          nodePath: "/sys/adb/path",
          accessMode: "RO",
          enabled: true
        }
      ]
    });
  });

  it("does not downgrade complex value metadata when a patch omits value metadata", () => {
    expect(
      patchDebugParameterAdminBodySchema.parse({
        name: "Renamed only"
      })
    ).toEqual({
      name: "Renamed only"
    });
  });

  it("defaults scalar value metadata only when scalar is explicit on admin parameter patches", () => {
    expect(
      patchDebugParameterAdminBodySchema.parse({
        valueKind: "scalar"
      })
    ).toEqual({
      valueKind: "scalar",
      valueFormat: "raw",
      normalizationMode: "trim"
    });
  });

  it("parses route params and archive reasons", () => {
    expect(debugAdminParameterParamsSchema.parse({ parameterId: "param-1" })).toEqual({ parameterId: "param-1" });
    expect(debugAdminBindingParamsSchema.parse({ parameterId: "param-1", protocol: "adb" })).toEqual({
      parameterId: "param-1",
      protocol: "adb"
    });
    expect(archiveDebugParameterBodySchema.parse({ reason: "Deprecated" })).toEqual({ reason: "Deprecated" });
  });

  it("defaults scalar value metadata on admin parameter writes", () => {
    expect(
      writeDebugParameterAdminBodySchema.parse({
        name: "Scalar parameter",
        key: "debug.scalar",
        module: "Battery",
        risk: "Low"
      })
    ).toMatchObject({
      valueKind: "scalar",
      valueFormat: "raw",
      normalizationMode: "trim"
    });
  });

  it("accepts complex JSON value metadata on admin parameter writes", () => {
    expect(
      writeDebugParameterAdminBodySchema.parse({
        name: "Complex JSON",
        key: "debug.complex.json",
        module: "Diagnostics",
        risk: "Medium",
        valueKind: "complex",
        valueFormat: "json",
        normalizationMode: "json-canonical",
        maxValueBytes: 8192
      })
    ).toMatchObject({
      valueKind: "complex",
      valueFormat: "json",
      normalizationMode: "json-canonical",
      maxValueBytes: 8192
    });
  });

  it("rejects json-canonical normalization without json format", () => {
    expect(() =>
      writeDebugParameterAdminBodySchema.parse({
        name: "Invalid combo",
        key: "debug.invalid",
        module: "Diagnostics",
        risk: "Low",
        valueKind: "complex",
        valueFormat: "raw",
        normalizationMode: "json-canonical"
      })
    ).toThrow();
  });
});
