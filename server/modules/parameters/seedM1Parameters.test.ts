import { describe, expect, it } from "vitest";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { parsePowerManagementConfig, seedM1Parameters } from "../../../scripts/seed-m1-parameters";

const configPath = "src/config/power-management.json";

const config = {
  projects: [{ id: "aurora", name: "Aurora", code: "AUR" }],
  parameterModules: [
    {
      name: "Power",
      description: "Power root",
      scope: "All power settings"
    },
    {
      name: "Charging Policy",
      parent: "Power",
      description: "Charging policy",
      scope: "Charging limits"
    }
  ],
  parameterLibrary: [
    {
      id: "fast-charge-current",
      name: "fast_charge_current_limit_ma",
      description: "Limit fast charge current.",
      explanation: "Controls the fast charging current.",
      configFormat: "ENV: FAST_CHARGE_CURRENT=number",
      module: "Charging Policy",
      range: "1000 - 5000",
      unit: "mA",
      risk: "High",
      sourceFileName: "aurora-board.dts",
      sourceNodePath: "charging_core/ichg_max",
      values: {
        aurora: { currentValue: "3200", recommendedValue: "3000" }
      }
    }
  ]
};

type ExistingProjectParameterValue = {
  currentValue: string;
  recommendedValue: string;
  id?: string;
  valueVersion?: number;
};

function createSeedDatabase(existing?: ExistingProjectParameterValue) {
  const historyEntries: Array<{ id: string; projectParameterValueId: string; version: number; value: string }> = existing
    ? [
        {
          id: `${existing.id ?? "legacy-value-id"}-history-v${existing.valueVersion ?? 1}`,
          projectParameterValueId: existing.id ?? "legacy-value-id",
          version: existing.valueVersion ?? 1,
          value: existing.currentValue
        }
      ]
    : [];
  const parameterValue = existing
    ? {
        id: existing.id ?? "legacy-value-id",
        currentValue: existing.currentValue,
        recommendedValue: existing.recommendedValue,
        valueVersion: existing.valueVersion ?? 1
      }
    : null;
  const queries: Array<{ text: string; values: unknown[] }> = [];

  const tx: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      queries.push({ text, values });

      if (text.includes("insert into project_parameter_values")) {
        const currentValue = values[4] as string;
        const recommendedValue = values[5] as string;
        if (!parameterValue) {
          return {
            rows: [{ id: values[0], value_version: 1 } as Row],
            rowCount: 1
          };
        }

        if (parameterValue.currentValue !== currentValue) {
          parameterValue.valueVersion += 1;
        }
        parameterValue.currentValue = currentValue;
        parameterValue.recommendedValue = recommendedValue;
        return {
          rows: [{ id: parameterValue.id, value_version: parameterValue.valueVersion } as Row],
          rowCount: 1
        };
      }

      if (text.includes("insert into parameter_history_entries")) {
        const id = values[0] as string;
        const projectParameterValueId = values[4] as string;
        const version = values[5] as number;
        const value = values[6] as string;

        if (!historyEntries.some((entry) => entry.projectParameterValueId === projectParameterValueId && entry.version === version)) {
          historyEntries.push({ id, projectParameterValueId, version, value });
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 1 };
    }
  };

  const db: Database = {
    query: tx.query,
    transaction: async (fn) => fn(tx)
  };

  return { db, historyEntries, queries };
}

describe("parsePowerManagementConfig", () => {
  it("throws an actionable error with the config path when the shape is invalid", () => {
    expect(() => parsePowerManagementConfig(configPath, JSON.stringify({ projects: "invalid" }))).toThrow(
      `Invalid M1 parameter seed config at ${configPath}`
    );
  });
});

describe("seedM1Parameters", () => {
  it("binds the local workflow assignees to each seeded project", async () => {
    const { db, queries } = createSeedDatabase();

    await seedM1Parameters(db, config);

    const roleBindings = queries.filter((call) => call.text.includes("insert into user_role_bindings"));
    expect(roleBindings.map((call) => call.values)).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["urb-u-wang-jie-aurora-hardware-committer", "u-wang-jie", "org-chargelab", "aurora", "hardware-committer"]),
        expect.arrayContaining(["urb-u-sun-mei-aurora-software-committer", "u-sun-mei", "org-chargelab", "aurora", "software-committer"]),
        expect.arrayContaining(["urb-u-liu-min-aurora-software-user", "u-liu-min", "org-chargelab", "aurora", "software-user"])
      ])
    );
  });

  it("uses the returned project parameter value id when inserting history", async () => {
    const { db, historyEntries } = createSeedDatabase({
      id: "legacy-value-id",
      currentValue: "3000",
      recommendedValue: "3000",
      valueVersion: 1
    });

    await seedM1Parameters(db, config);

    expect(historyEntries).toContainEqual({
      id: "legacy-value-id-history-v2",
      projectParameterValueId: "legacy-value-id",
      version: 2,
      value: "3200"
    });
  });

  it("seeds the hierarchical module catalog and exact DTS source binding", async () => {
    const { db, queries } = createSeedDatabase();

    await seedM1Parameters(db, config);

    const moduleInserts = queries.filter((call) => call.text.includes("insert into parameter_modules"));
    expect(moduleInserts).toHaveLength(2);
    expect(moduleInserts[1]?.values).toEqual(expect.arrayContaining(["Charging Policy"]));

    const definitionInsert = queries.find((call) => call.text.includes("insert into parameter_definitions"));
    expect(definitionInsert?.text).toContain("parameter_module_id");

    const valueInsert = queries.find((call) => call.text.includes("insert into project_parameter_values"));
    expect(valueInsert?.text).toContain("source_file_name");
    expect(valueInsert?.text).toContain("source_node_path");
    expect(valueInsert?.values).toEqual(
      expect.arrayContaining(["aurora-board.dts", "charging_core/ichg_max"])
    );
  });

  it("adds history only when the seeded current value advances to a new version", async () => {
    const { db, historyEntries } = createSeedDatabase({
      currentValue: "3200",
      recommendedValue: "2800",
      valueVersion: 1
    });

    await seedM1Parameters(db, config);

    expect(historyEntries).toHaveLength(1);
    expect(historyEntries[0]).toMatchObject({ version: 1, value: "3200" });
  });
});
