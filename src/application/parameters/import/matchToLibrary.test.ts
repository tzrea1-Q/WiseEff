import { describe, expect, it } from "vitest";
import { initialState } from "@/mockData";
import { matchToLibrary } from "./matchToLibrary";
import type { ParsedImportRow } from "./types";

const baseRow = (overrides: Partial<ParsedImportRow>): ParsedImportRow => ({
  name: "unknown_param",
  module: "Unknown Module",
  sourceFormat: "spreadsheet",
  ...overrides
});

describe("matchToLibrary", () => {
  const parameters = initialState.parameters;
  const projectId = "aurora";

  it("matches existing parameters by name and module", () => {
    const rows = [
      baseRow({
        name: "fast_charge_current_limit_ma",
        module: "Charging Policy"
      })
    ];
    const reviewed = matchToLibrary(rows, parameters, projectId);
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]).toMatchObject({
      rowId: "import-row-1",
      matchKey: "fast_charge_current_limit_ma::Charging Policy",
      status: "pending",
      existingParameter: expect.objectContaining({
        id: "aurora-fast-charge-current",
        projectId: "aurora"
      })
    });
  });

  it("prefers the target project record when multiple name+module matches exist", () => {
    const sharedName = "shared_param_name";
    const sharedModule = "Shared Module";
    const library = [
      ...parameters,
      {
        ...parameters[0],
        id: "other-project-shared",
        name: sharedName,
        module: sharedModule,
        projectId: "nebula"
      },
      {
        ...parameters[0],
        id: "aurora-project-shared",
        name: sharedName,
        module: sharedModule,
        projectId: "aurora"
      }
    ];
    const reviewed = matchToLibrary(
      [baseRow({ name: sharedName, module: sharedModule })],
      library,
      projectId
    );
    expect(reviewed[0].existingParameter?.id).toBe("aurora-project-shared");
  });

  it("marks duplicate match keys in the same batch as conflict", () => {
    const rows = [
      baseRow({ name: "dup_param", module: "Dup Module" }),
      baseRow({ name: "dup_param", module: "Dup Module" })
    ];
    const reviewed = matchToLibrary(rows, parameters, projectId);
    expect(reviewed[0].status).toBe("conflict");
    expect(reviewed[1].status).toBe("conflict");
    expect(reviewed[0].matchKey).toBe("dup_param::Dup Module");
  });

  it("marks rows with empty module as needs-module", () => {
    const reviewed = matchToLibrary(
      [baseRow({ name: "dts_only_name", module: "" })],
      parameters,
      projectId
    );
    expect(reviewed[0]).toMatchObject({
      rowId: "import-row-1",
      matchKey: "dts_only_name::",
      status: "needs-module"
    });
    expect(reviewed[0].existingParameter).toBeUndefined();
  });

  it("marks unmatched rows as pending new candidates", () => {
    const reviewed = matchToLibrary(
      [baseRow({ name: "brand_new_param", module: "New Module" })],
      parameters,
      projectId
    );
    expect(reviewed[0]).toMatchObject({
      status: "pending",
      matchKey: "brand_new_param::New Module"
    });
    expect(reviewed[0].existingParameter).toBeUndefined();
  });

  it("assigns stable row ids by index", () => {
    const reviewed = matchToLibrary(
      [
        baseRow({ name: "row_a", module: "Mod A" }),
        baseRow({ name: "row_b", module: "Mod B" })
      ],
      parameters,
      projectId
    );
    expect(reviewed.map((row) => row.rowId)).toEqual(["import-row-1", "import-row-2"]);
  });
});
