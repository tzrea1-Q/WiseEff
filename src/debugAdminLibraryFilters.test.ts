import { describe, expect, it } from "vitest";
import { buildDebugModuleTree } from "./debugAdminModules";
import { legacyModuleIdFromName } from "@/domain/modules/moduleTree";
import {
  filterDebugParameterLibrary,
  sortDebugParameterLibrary,
  type DebugParameterLibraryRow
} from "./debugAdminLibraryFilters";

const rows: DebugParameterLibraryRow[] = [
  {
    id: "a",
    name: "Alpha",
    key: "debug.a",
    module: "Battery",
    risk: "High",
    bindings: [
      { protocol: "hdc", nodePath: "/hdc/a", accessMode: "RO", enabled: true },
      { protocol: "adb", nodePath: "/adb/a", accessMode: "RO", enabled: true }
    ],
    enabled: true,
    archivedAt: null
  },
  {
    id: "b",
    name: "Beta",
    key: "debug.b",
    module: "Device Lab",
    risk: "Low",
    bindings: [],
    enabled: false,
    archivedAt: null
  },
  {
    id: "c",
    name: "Gamma",
    key: "debug.c",
    module: "Battery",
    risk: "Medium",
    bindings: [{ protocol: "hdc", nodePath: "/hdc/c", accessMode: "RO", enabled: true }],
    enabled: true,
    archivedAt: null
  },
  {
    id: "d",
    name: "Delta",
    key: "debug.d",
    module: "Diagnostics",
    risk: "Low",
    bindings: [{ protocol: "adb", nodePath: "/adb/d", accessMode: "RO", enabled: true }],
    enabled: true,
    archivedAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "e",
    name: "Epsilon",
    key: "debug.e",
    module: "Diagnostics",
    risk: "Low",
    bindings: [{ protocol: "adb", nodePath: "/adb/e", accessMode: "RO", enabled: true }],
    enabled: true,
    archivedAt: null
  },
  {
    id: "f",
    name: "Zeta",
    key: "debug.f",
    module: "Diagnostics",
    risk: "Low",
    bindings: [],
    enabled: true,
    archivedAt: null
  }
];

const moduleNodes = buildDebugModuleTree(
  rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: "",
    detailedDescription: "",
    writeFormatExample: "",
    writeFormatHint: "",
    module: row.module,
    enabled: true,
    bindings: []
  }))
);
const batteryModuleId = legacyModuleIdFromName("Battery");

describe("filterDebugParameterLibrary", () => {
  it("filters by query, risk, and module", () => {
    const result = filterDebugParameterLibrary(
      rows,
      {
        q: "alpha",
        risk: "high",
        modules: [batteryModuleId],
        coverage: "all",
        sort: "name-asc"
      },
      moduleNodes
    );

    expect(result.map((row) => row.id)).toEqual(["a"]);
  });

  it("filters by coverage categories", () => {
    expect(
      filterDebugParameterLibrary(rows, {
        q: "",
        risk: "all",
        modules: [],
        coverage: "dual",
        sort: "name-asc"
      }).map((row) => row.id)
    ).toEqual(["a"]);

    expect(
      filterDebugParameterLibrary(rows, {
        q: "",
        risk: "all",
        modules: [],
        coverage: "hdc-only",
        sort: "name-asc"
      }).map((row) => row.id)
    ).toEqual(["c"]);

    expect(
      filterDebugParameterLibrary(rows, {
        q: "",
        risk: "all",
        modules: [],
        coverage: "adb-only",
        sort: "name-asc"
      }).map((row) => row.id)
    ).toEqual(["e"]);

    expect(
      filterDebugParameterLibrary(rows, {
        q: "",
        risk: "all",
        modules: [],
        coverage: "missing-binding",
        sort: "name-asc"
      }).map((row) => row.id)
    ).toEqual(["f"]);

    expect(
      filterDebugParameterLibrary(rows, {
        q: "",
        risk: "all",
        modules: [],
        coverage: "archived",
        sort: "name-asc"
      }).map((row) => row.id)
    ).toEqual(["d"]);

    expect(
      filterDebugParameterLibrary(rows, {
        q: "",
        risk: "all",
        modules: [],
        coverage: "disabled",
        sort: "name-asc"
      }).map((row) => row.id)
    ).toEqual(["b"]);
  });
});

describe("sortDebugParameterLibrary", () => {
  it("sorts by name ascending", () => {
    const sorted = sortDebugParameterLibrary(rows, "name-asc");
    expect(sorted.map((row) => row.name)).toEqual(["Alpha", "Beta", "Delta", "Epsilon", "Gamma", "Zeta"]);
  });

  it("sorts by risk descending then name", () => {
    const sorted = sortDebugParameterLibrary(rows, "risk-desc");
    expect(sorted.map((row) => row.id)).toEqual(["a", "c", "b", "d", "e", "f"]);
  });
});
