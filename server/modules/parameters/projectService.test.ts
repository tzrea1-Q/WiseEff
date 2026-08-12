import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { ensureDefaultConfigSetInTx } from "../parameter-files/configSetService";
import { createProjectForAuth } from "./projectService";

const databaseAvailable = await isTestDatabaseAvailable();

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      organizationName: "ChargeLab",
      roles: [{ projectId: null, roleId: "admin" }],
      permissions: ["admin:access"]
    }),
    ...overrides
  };
}

describe.skipIf(!databaseAvailable)("createProjectForAuth", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function readState() {
    const result = await db.query<{ projects: string; config_sets: string; config_set_audits: string }>(
      `select
         (select count(*) from projects where organization_id = $1)::text as projects,
         (select count(*) from dts_config_set where organization_id = $1 and project_id = $2 and name = 'default')::text as config_sets,
         (select count(*) from audit_events where organization_id = $1 and kind = 'config-set')::text as config_set_audits`,
      ["org-1", "nova"]
    );
    return result.rows[0];
  }

  it("creates a project and ensures a default dts_config_set named default", async () => {
    const item = await createProjectForAuth(db, adminAuth(), {
      id: "nova",
      name: "Nova",
      code: "NOVA"
    });

    expect(item).toMatchObject({ id: "nova", name: "Nova", code: "NOVA", status: "initialized" });
    const state = await readState();
    expect(state.projects).toBe("1");
    expect(state.config_sets).toBe("1");
    expect(state.config_set_audits).toBe("1");
  });

  it("is idempotent when the default config set already exists for the project", async () => {
    await createProjectForAuth(db, adminAuth(), { id: "nova", name: "Nova", code: "NOVA" });

    // Re-running the ensure step (as project creation does internally) must neither
    // duplicate the default config set nor emit a second audit event.
    await db.transaction((tx) => ensureDefaultConfigSetInTx(tx, adminAuth(), "nova", {}));

    const state = await readState();
    expect(state.config_sets).toBe("1");
    expect(state.config_set_audits).toBe("1");
  });

  it("rejects callers without admin:access", async () => {
    await expect(
      createProjectForAuth(db, adminAuth({ permissions: ["parameter:view"] }), {
        id: "nova",
        name: "Nova",
        code: "NOVA"
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<ApiError>);

    const state = await readState();
    expect(state.projects).toBe("0");
    expect(state.config_sets).toBe("0");
  });

  it("inserts new projects with initialization_status not_initialized", async () => {
    await createProjectForAuth(db, adminAuth(), {
      id: "nova",
      name: "Nova",
      code: "NOVA"
    });

    const stored = await db.query<{ initialization_status: string }>(
      "select initialization_status from projects where organization_id = $1 and id = $2",
      ["org-1", "nova"]
    );
    expect(stored.rows).toEqual([{ initialization_status: "not_initialized" }]);
  });

  it("returns initializationStatus not_initialized on create even when ops status is initialized", async () => {
    const item = await createProjectForAuth(db, adminAuth(), {
      id: "nova",
      name: "Nova",
      code: "NOVA"
    });

    expect(item).toMatchObject({
      id: "nova",
      status: "initialized",
      initializationStatus: "not_initialized"
    });
  });
});
