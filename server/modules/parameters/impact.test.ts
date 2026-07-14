import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import { buildChangeRequestImpact, buildTemplateImpact } from "./impact";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createFakeDb(handler: (call: QueryCall) => unknown[]) {
  const calls: QueryCall[] = [];
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      const call = { text, values };
      calls.push(call);
      const rows = handler(call);
      return { rows: rows as Row[], rowCount: rows.length };
    }
  };
  return { db, calls };
}

const templateInput = {
  title: "status",
  module: "demo_multi_instance/battery_checker@0",
  currentValue: '"ok"',
  targetValue: '"disabled"',
  risk: "Medium" as const
};

describe("buildTemplateImpact", () => {
  it("returns the exact legacy two-item template", () => {
    expect(buildTemplateImpact(templateInput)).toEqual([
      {
        kind: "parameter",
        name: "status",
        note: `Changes demo_multi_instance/battery_checker@0 parameter from "ok" to "disabled".`,
        risk: "Medium"
      },
      {
        kind: "module",
        name: "demo_multi_instance/battery_checker@0",
        note: "Medium risk module review recommended.",
        risk: "Medium"
      }
    ]);
  });
});

describe("buildChangeRequestImpact", () => {
  it("falls back to template when source binding is missing", async () => {
    const { db, calls } = createFakeDb(() => {
      throw new Error("should not query structural tables without source binding");
    });

    const impact = await buildChangeRequestImpact(db, {
      ...templateInput,
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      sourceFileName: null,
      sourceNodePath: null
    });

    expect(impact).toEqual(buildTemplateImpact(templateInput));
    expect(calls).toHaveLength(0);
  });

  it("falls back to template when source file/node has no dts rows", async () => {
    const { db } = createFakeDb((call) => {
      if (call.text.includes("from dts_nodes") || call.text.includes("join dts_nodes")) {
        return [];
      }
      if (call.text.includes("project_parameter_files")) {
        return [];
      }
      return [];
    });

    const impact = await buildChangeRequestImpact(db, {
      ...templateInput,
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      sourceFileName: "board.dts",
      sourceNodePath: "amba/i2c@1/chip@6E/status"
    });

    expect(impact).toEqual(buildTemplateImpact(templateInput));
  });

  it("includes phandle, compatible, and config-set impact kinds for structural changes", async () => {
    const { db } = createFakeDb((call) => {
      if (call.text.includes("project_parameter_files") && call.text.includes("dts_nodes")) {
        return [
          {
            node_id: "node-chip",
            node_path: "amba/i2c@1/chip@6E",
            compatible: "vendor,chip123",
            file_id: "file-board",
            file_name: "board.dts",
            version_id: "ver-1",
            config_set_id: "cs-default"
          }
        ];
      }
      if (call.text.includes("dts_phandle_refs")) {
        return [
          {
            from_node_path: "amba/consumer",
            from_property: "chip-handle",
            target_label: "chip_label"
          }
        ];
      }
      if (call.text.includes("compatible") && call.text.includes("dts_nodes")) {
        return [
          {
            node_path: "amba/i2c@2/chip@70",
            compatible: "vendor,chip123"
          }
        ];
      }
      if (call.text.includes("config_set_id") && call.text.includes("project_parameter_files")) {
        return [{ file_name: "board-overlay.dts" }, { file_name: "board-sku-b.dts" }];
      }
      return [];
    });

    const impact = await buildChangeRequestImpact(db, {
      ...templateInput,
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      sourceFileName: "board.dts",
      sourceNodePath: "amba/i2c@1/chip@6E/status"
    });

    const kinds = impact.map((item) => item.kind);
    expect(kinds).toContain("phandle");
    expect(kinds).toContain("compatible");
    expect(kinds).toContain("config-set");

    expect(impact).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "phandle",
          name: "amba/consumer",
          risk: "Medium"
        }),
        expect.objectContaining({
          kind: "compatible",
          name: "amba/i2c@2/chip@70",
          risk: "Medium"
        }),
        expect.objectContaining({
          kind: "config-set",
          name: "board-overlay.dts",
          risk: "Medium"
        })
      ])
    );

    // Structural results replace the legacy module-only template pair.
    expect(impact.some((item) => item.kind === "module" && item.note.includes("module review"))).toBe(false);
  });

  it("falls back to template when structural queries all return empty", async () => {
    const { db } = createFakeDb((call) => {
      if (call.text.includes("project_parameter_files") && call.text.includes("dts_nodes")) {
        return [
          {
            node_id: "node-lonely",
            node_path: "lonely",
            compatible: null,
            file_id: "file-board",
            file_name: "board.dts",
            version_id: "ver-1",
            config_set_id: null
          }
        ];
      }
      return [];
    });

    const impact = await buildChangeRequestImpact(db, {
      ...templateInput,
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      sourceFileName: "board.dts",
      sourceNodePath: "lonely/status"
    });

    expect(impact).toEqual(buildTemplateImpact(templateInput));
  });
});
