import { describe, expect, it } from "vitest";

import {
  filterUnmappedCompatibles,
  filterUnmappedDrivers,
  toUnmappedCompatibleHint,
} from "./moduleDiscovery";
import type { ParameterModuleMapping } from "./moduleRegistry";

const mappings: ParameterModuleMapping[] = [
  {
    id: "m1",
    moduleId: "mod-hl7603",
    matchKind: "compatible",
    matchValue: "huawei,bypass_bst_hl7603",
    priority: 300,
  },
  {
    id: "m2",
    moduleId: "mod-sc8562",
    matchKind: "driver",
    matchValue: "sc8562",
    priority: 100,
  },
];

describe("moduleDiscovery", () => {
  it("filters observed drivers that already have a driver mapping", () => {
    const result = filterUnmappedDrivers(
      [
        { driverModule: "sc8562", bindingCount: 4 },
        { driverModule: "mt5788", bindingCount: 2 },
      ],
      mappings,
    );
    expect(result).toEqual([{ driverModule: "mt5788", bindingCount: 2 }]);
  });

  it("filters observed compatibles that already have a compatible mapping", () => {
    const result = filterUnmappedCompatibles(
      [
        toUnmappedCompatibleHint({ compatible: "huawei,bypass_bst_hl7603", bindingCount: 8 }),
        toUnmappedCompatibleHint({ compatible: "vendor,new-driver", bindingCount: 3 }),
      ],
      mappings,
    );
    expect(result).toEqual([
      {
        compatible: "vendor,new-driver",
        bindingCount: 3,
        suggestedGroupName: "new-driver",
      },
    ]);
  });
});
