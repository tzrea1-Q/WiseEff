import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createProjectForAuth } from "./projectService";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const txCalls: QueryCall[] = [];

  const runQuery = async <Row,>(target: QueryCall[], text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    target.push(call);
    const next = results.shift() ?? [];
    const rows = typeof next === "function" ? next(call) : next;
    return { rows: rows as Row[], rowCount: rows.length };
  };

  const tx: Queryable = {
    query: (text, values = []) => runQuery(txCalls, text, values)
  };
  const db: Database = {
    query: (text, values = []) => runQuery(txCalls, text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => fn(tx)
  };

  return { db, txCalls };
}

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["admin:access"],
    ...overrides
  };
}

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "nova",
    name: "Nova",
    code: "NOVA",
    status: "initialized",
    updated_at: new Date("2026-07-02T00:00:00.000Z"),
    ...overrides
  };
}

function configSetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "dcs-default-nova",
    organization_id: "org-1",
    project_id: "nova",
    name: "default",
    description: "Auto-created default configuration set.",
    derived_from_id: null,
    created_at: new Date("2026-07-02T00:00:00.000Z"),
    updated_at: new Date("2026-07-02T00:00:00.000Z"),
    ...overrides
  };
}

describe("createProjectForAuth", () => {
  it("creates a project and ensures a default dts_config_set named default", async () => {
    const { db, txCalls } = createFakeDb([[projectRow()], [], [configSetRow()], []]);

    const item = await createProjectForAuth(db, adminAuth(), {
      id: "nova",
      name: "Nova",
      code: "NOVA"
    });

    expect(item).toMatchObject({ id: "nova", name: "Nova", code: "NOVA", status: "initialized" });
    expect(txCalls.find((call) => call.text.includes("insert into projects"))).toBeTruthy();
    expect(txCalls.find((call) => call.text.includes("insert into dts_config_set"))).toBeTruthy();
    const configInsert = txCalls.find((call) => call.text.includes("insert into dts_config_set"));
    expect(configInsert?.values).toEqual(
      expect.arrayContaining(["org-1", "nova", "default"])
    );
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))).toBeTruthy();
  });

  it("is idempotent when the default config set already exists for the project", async () => {
    const { db, txCalls } = createFakeDb([[projectRow()], [configSetRow({ id: "dcs-existing" })]]);

    const item = await createProjectForAuth(db, adminAuth(), {
      id: "nova",
      name: "Nova",
      code: "NOVA"
    });

    expect(item.id).toBe("nova");
    expect(txCalls.find((call) => call.text.includes("insert into projects"))).toBeTruthy();
    expect(txCalls.find((call) => call.text.includes("insert into dts_config_set"))).toBeFalsy();
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))).toBeFalsy();
  });

  it("rejects callers without admin:access", async () => {
    const { db, txCalls } = createFakeDb([]);

    await expect(
      createProjectForAuth(
        db,
        adminAuth({ permissions: ["parameter:view"] }),
        { id: "nova", name: "Nova", code: "NOVA" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<ApiError>);

    expect(txCalls).toHaveLength(0);
  });
});
