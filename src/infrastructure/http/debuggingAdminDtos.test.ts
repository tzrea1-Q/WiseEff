import { describe, expect, it } from "vitest";
import type { DebugAdminParameterDraft } from "@/domain/debugging/types";
import {
  debugAdminParameterFromDto,
  debugAdminParameterToDto,
  type DebugAdminParameterDto
} from "./debuggingAdminDtos";

const adminParameterDto: DebugAdminParameterDto = {
  id: "param-complex-1",
  name: "DTS profile",
  key: "debug.dts.profile",
  description: "Complex DTS node payload",
  module: "Diagnostics",
  nodePath: "/sys/debug/dts",
  accessMode: "RW",
  unit: "",
  range: "",
  risk: "Medium",
  currentValue: '{\n  "enabled": true\n}',
  targetValue: '{\n  "enabled": false\n}',
  sortOrder: 5,
  enabled: true,
  valueKind: "complex",
  valueFormat: "json",
  normalizationMode: "json-canonical",
  maxValueBytes: 8192,
  bindings: [
    { protocol: "hdc", nodePath: "/sys/debug/dts", accessMode: "RW", enabled: true }
  ]
};

const adminDraft: DebugAdminParameterDraft = {
  id: "param-complex-1",
  name: "DTS profile",
  key: "debug.dts.profile",
  description: "Complex DTS node payload",
  module: "Diagnostics",
  currentValue: '{\n  "enabled": true\n}',
  targetValue: '{\n  "enabled": false\n}',
  unit: "",
  range: "",
  minValue: null,
  maxValue: null,
  risk: "Medium",
  nodePath: "/sys/debug/dts",
  accessMode: "RW",
  sortOrder: 5,
  enabled: true,
  valueKind: "complex",
  valueFormat: "json",
  normalizationMode: "json-canonical",
  maxValueBytes: 8192,
  bindings: [
    { protocol: "hdc", nodePath: "/sys/debug/dts", accessMode: "RW", enabled: true }
  ]
};

describe("debugging admin dto mappers", () => {
  it("defaults legacy admin parameters to scalar/raw/trim", () => {
    expect(
      debugAdminParameterFromDto({
        id: "legacy-param",
        name: "Legacy scalar",
        key: "debug.legacy.scalar",
        description: "",
        module: "Diagnostics",
        unit: "mA",
        range: "0-1000",
        risk: "Low",
        currentValue: "100",
        targetValue: "120"
      })
    ).toMatchObject({
      valueKind: "scalar",
      valueFormat: "raw",
      normalizationMode: "trim",
      maxValueBytes: null
    });
  });

  it("maps complex admin metadata from dto", () => {
    expect(debugAdminParameterFromDto(adminParameterDto)).toMatchObject({
      valueKind: "complex",
      valueFormat: "json",
      normalizationMode: "json-canonical",
      maxValueBytes: 8192
    });
  });

  it("roundtrips complex admin metadata in write dto", () => {
    expect(debugAdminParameterToDto(adminDraft)).toEqual(
      expect.objectContaining({
        valueKind: "complex",
        valueFormat: "json",
        normalizationMode: "json-canonical",
        maxValueBytes: 8192,
        currentValue: adminDraft.currentValue,
        targetValue: adminDraft.targetValue
      })
    );
  });
});
