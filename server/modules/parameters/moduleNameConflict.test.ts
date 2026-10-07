import pg from "pg";
import { describe, expect, it } from "vitest";

import { createDatabase, type Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import { updateParameterModuleForAuth } from "./service";

const constraint = "parameter_modules_org_parent_name_unique_idx";
const auth = makeTestAuthContext({ organizationId: "org-1" });

function databaseError(code: string, name = constraint) {
  return Object.assign(new pg.DatabaseError("duplicate module name", 0, "error"), {
    code,
    constraint: name,
    table: "parameter_modules"
  });
}

async function failedUpdate(error: unknown, parentId: string | null) {
  const statements: string[] = [];
  const queryable: Queryable = {
    async query<Row>(text: string, values: unknown[] = []) {
      const sql = text.trim();
      statements.push(sql.split(/\s+/, 1)[0]);
      if (sql === "begin" || sql === "rollback") return { rows: [], rowCount: null };
      if (sql.startsWith("update parameter_modules")) {
        expect(values.slice(0, 3)).toEqual(["org-1", "module-1", "Shared name"]);
        throw error;
      }
      if (sql.includes("from parameter_modules") && sql.includes("name = $2")) {
        expect(values).toEqual(["org-1", "Shared name", parentId]);
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from parameter_modules") && sql.includes("id = $2")) {
        return { rows: [{
          id: "module-1", organization_id: "org-1", parent_id: parentId,
          name: "Old name", path: "module-1", depth: 0, sort_order: 0,
          description: "", scope: "", importance: "medium", kind: "business",
          origin: "curated", source_key: null, attribution_subject_id: null
        } as Row], rowCount: 1 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  let rejected: unknown;
  try {
    await updateParameterModuleForAuth(createDatabase(queryable), auth, "module-1", {
      name: "  Shared name  "
    });
    throw new Error("Expected update to reject");
  } catch (caught) {
    rejected = caught;
    // Rejection is observable only after rollback; no commit or success audit INSERT.
    expect(statements).toEqual(["select", "select", "begin", "select", "update", "rollback"]);
  }
  return rejected;
}

describe("module name transaction conflicts", () => {
  it.each([null, "parent-1"])("maps the exact PostgreSQL constraint after rollback (parent %s)", async (parentId) => {
    const error = await failedUpdate(databaseError("23505"), parentId);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "CONFLICT", status: 409,
      message: "Parameter module already exists under this parent.",
      details: { name: "Shared name", parentId }
    });
  });

  it.each([
    ["another unique constraint", databaseError("23505", "unrelated_unique_idx")],
    ["another SQLSTATE", databaseError("23503")],
    ["ordinary exception", new Error("update failed")],
    ["ApiError", new ApiError("FORBIDDEN", "denied")],
    ["lookalike exception", Object.assign(new Error("duplicate"), { code: "23505", constraint })]
  ])("rethrows %s unchanged after rollback", async (_label, original) => {
    expect(await failedUpdate(original, "parent-1")).toBe(original);
  });
});
