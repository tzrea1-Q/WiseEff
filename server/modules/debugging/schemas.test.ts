import { describe, expect, it } from "vitest";
import {
  createDebugSessionBodySchema,
  DEBUG_CATALOG_FORMAT_V1,
  debugCatalogDocumentSchema,
  debugParameterNodeBindingSchema,
  detectTargetsBodySchema,
  exportDebugCatalogQuerySchema,
  importDebugCatalogBodySchema,
  listDebuggingParametersQuerySchema,
  readNodeBodySchema,
  rollbackSnapshotBodySchema,
  writeNodeBodySchema
} from "./schemas";

describe("debugging schemas", () => {
  it("accepts optional parameter query filters", () => {
    expect(
      listDebuggingParametersQuerySchema.parse({
        module: "power",
        risk: ["Low", "High"]
      })
    ).toEqual({
      module: "power",
      risk: ["Low", "High"]
    });
  });

  it("trims and requires target detection device input when provided", () => {
    expect(() => detectTargetsBodySchema.parse({ deviceId: "   " })).toThrow();
    expect(detectTargetsBodySchema.parse({ deviceId: "sim-device-1" })).toEqual({
      deviceId: "sim-device-1",
      protocol: "hdc"
    });
    expect(detectTargetsBodySchema.parse({ bridgeId: "br-1" })).toEqual({
      bridgeId: "br-1",
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
    expect(rollbackSnapshotBodySchema.parse({ approvalId: "agent-approval-1" })).toEqual({
      approvalId: "agent-approval-1"
    });
    expect(() => rollbackSnapshotBodySchema.parse({})).toThrow();
  });

  it("requires device and target when creating sessions", () => {
    expect(() => createDebugSessionBodySchema.parse({ deviceId: "device-1" })).toThrow();
  });
});

describe("debugging protocol schemas", () => {
  it("accepts hdc and adb protocols for target detection and sessions", () => {
    expect(detectTargetsBodySchema.parse({ deviceId: "device-1", protocol: "adb" })).toEqual({
      deviceId: "device-1",
      protocol: "adb"
    });
    expect(
      createDebugSessionBodySchema.parse({
        deviceId: "device-1",
        targetId: "adb:serial-1",
        protocol: "adb"
      }).protocol
    ).toBe("adb");
  });

  it("requires bridgeId when targetId references a bridge-backed target", () => {
    expect(() =>
      createDebugSessionBodySchema.parse({
        deviceId: "bridge:br-1",
        targetId: "bridge:br-1:adb:serial-1",
        protocol: "adb"
      })
    ).toThrow();
    expect(
      createDebugSessionBodySchema.parse({
        deviceId: "bridge:br-1",
        targetId: "bridge:br-1:adb:serial-1",
        bridgeId: "br-1",
        protocol: "adb"
      })
    ).toMatchObject({ bridgeId: "br-1" });
  });

  it("rejects unsupported protocols at the API boundary", () => {
    expect(() => detectTargetsBodySchema.parse({ protocol: "fastboot" })).toThrow();
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
  it("parses catalog export query and import document", () => {
    expect(exportDebugCatalogQuerySchema.parse({ includeArchived: "true" })).toEqual({ includeArchived: true });
    expect(
      importDebugCatalogBodySchema.parse({
        format: DEBUG_CATALOG_FORMAT_V1,
        modules: [{ name: "Battery" }],
        nodes: [
          {
            name: "Cycle count",
            moduleNamePath: ["Battery"],
            bindings: [{ protocol: "hdc", nodePath: "/sys/hdc/cycles", accessMode: "RO" }]
          }
        ]
      })
    ).toMatchObject({
      format: DEBUG_CATALOG_FORMAT_V1,
      modules: [{ name: "Battery", parentNamePath: [] }],
      nodes: [expect.objectContaining({ name: "Cycle count", enabled: true })]
    });
  });

  it("rejects catalog documents that omit a module assignment or use a relative binding path", () => {
    expect(() => debugCatalogDocumentSchema.parse({ format: "other", modules: [], nodes: [] })).toThrow();
    expect(() =>
      debugCatalogDocumentSchema.parse({
        format: DEBUG_CATALOG_FORMAT_V1,
        nodes: [{ name: "Missing module" }]
      })
    ).toThrow();
    expect(() =>
      debugCatalogDocumentSchema.parse({
        format: DEBUG_CATALOG_FORMAT_V1,
        nodes: [
          {
            name: "Broken path",
            module: "Battery",
            bindings: [{ protocol: "hdc", nodePath: "relative", accessMode: "RO" }]
          }
        ]
      })
    ).toThrow();
  });

});
