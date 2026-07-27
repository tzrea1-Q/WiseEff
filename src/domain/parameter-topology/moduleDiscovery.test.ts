import { describe, expect, it } from "vitest";

import {
  filterUnmappedCompatibles,
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
    matchKind: "compatible",
    matchValue: "sc8562",
    priority: 100,
  },
];

describe("moduleDiscovery", () => {
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
        projectCount: 0,
        suggestedGroupName: "new-driver",
      },
    ]);
  });
});
