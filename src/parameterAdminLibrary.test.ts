import { describe, expect, it } from "vitest";
import type { ParameterRecord } from "@/domain/parameters/types";
import {
  buildParameterLibraryFromRecords,
  buildParameterModulesFromRecords,
  templateModuleId
} from "./parameterAdminLibrary";

const auroraRecord: ParameterRecord = {
  id: "aurora-fast-charge-current",
  name: "fast_charge_current_limit_ma",
  description: "Limit fast charge current.",
  explanation: "Controls fast charge current.",
  configFormat: "YAML",
  module: "Charging Policy",
  projectId: "aurora",
  currentValue: "3200",
  recommendedValue: "3000",
  range: "2500 - 4500",
  unit: "mA",
  risk: "High",
  valueKind: "scalar",
  updatedAt: "2026-06-23T00:00:00.000Z",
  updatedAtTs: "2026-06-23T00:00:00.000Z",
  history: []
};

describe("parameterAdminLibrary", () => {
  it("builds an empty library when API parameters are empty", () => {
    expect(buildParameterLibraryFromRecords([])).toEqual([]);
    expect(buildParameterModulesFromRecords([])).toEqual([]);
  });

  it("groups project parameter records into one library definition", () => {
    const nebulaRecord: ParameterRecord = {
      ...auroraRecord,
      id: "nebula-fast-charge-current",
      projectId: "nebula",
      currentValue: "3600"
    };

    const library = buildParameterLibraryFromRecords([auroraRecord, nebulaRecord], [{ id: "aurora" }, { id: "nebula" }]);

    expect(library).toHaveLength(1);
    expect(library[0]?.id).toBe("fast-charge-current");
    expect(library[0]?.values.aurora?.currentValue).toBe("3200");
    expect(library[0]?.values.nebula?.currentValue).toBe("3600");
  });

  it("derives module metadata from API parameter records", () => {
    expect(buildParameterModulesFromRecords([auroraRecord])).toEqual([
      expect.objectContaining({ name: "Charging Policy" })
    ]);
  });

  it("preserves moduleId and modulePath when grouping API records into library definitions", () => {
    const nebulaRecord: ParameterRecord = {
      ...auroraRecord,
      id: "nebula-fast-charge-current",
      projectId: "nebula",
      currentValue: "3600"
    };
    const withModule: ParameterRecord = {
      ...auroraRecord,
      moduleId: "pm-charging",
      modulePath: ["Power", "Charging Policy"]
    };

    const library = buildParameterLibraryFromRecords([withModule, nebulaRecord], [{ id: "aurora" }, { id: "nebula" }]);

    expect(library[0]).toEqual(
      expect.objectContaining({
        moduleId: "pm-charging",
        modulePath: ["Power", "Charging Policy"]
      })
    );
  });

  it("resolves template module id from module name when API moduleId is missing", () => {
    const moduleNodes = [
      { id: "pm-charging", name: "Charging Policy", parentId: null, path: "pm-charging", depth: 1 }
    ];

    expect(
      templateModuleId(
        { module: "Charging Policy" },
        moduleNodes
      )
    ).toBe("pm-charging");
  });
});
