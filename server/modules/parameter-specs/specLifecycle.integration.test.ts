/**
 * Spec lifecycle closure (ADR-0011): deprecate / restore at the service seam.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { ApiError } from "../../shared/http/errors";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { registerParameterSpecRoutes } from "./routes";
import { deprecateParameterSpec, getParameterSpec, restoreParameterSpec, updateParameterSpec } from "./service";

const ORG_ID = "org-spec-lifecycle";
const USER_ID = "user-spec-lifecycle";
const ACTIVE_SPEC = "pspec:org:lifecycle-active";
const DRAFT_SPEC = "pspec:org:lifecycle-draft";
const GLOBAL_ACTIVE = "pspec:global:lifecycle-active";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Lifecycle Admin",
      email: "lifecycle@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: ORG_ID, name: "Lifecycle Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
  };
}

async function seedSpec(
  db: InMemoryTestDatabase,
  input: {
    specId: string;
    organizationId: string | null;
    lifecycle: "draft" | "active" | "deprecated";
    key: string;
  },
) {
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'manual', $3)
    on conflict (id) do nothing
    `,
    [input.specId, input.organizationId, input.key],
  );
  const versionId = `${input.specId}:v1`;
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle, activated_at
    ) values (
      $1, $2, 1, $3, $3, '{"kind":"u32"}'::jsonb,
      null, null, $4, $5::timestamptz
    )
    on conflict (id) do nothing
    `,
    [
      versionId,
      input.specId,
      input.key,
      input.lifecycle,
      input.lifecycle === "active" ? "2026-07-01T00:00:00.000Z" : null,
    ],
  );
  await db.query(
    `
    insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints, documentation)
    values ($1, $2, $3, 'manual', '{}'::jsonb, 'fixture')
    on conflict (id) do nothing
    `,
    [`dps-${input.specId}`, input.specId, input.key.split("/").pop() ?? input.key],
  );
}

describe.skipIf(!databaseAvailable)("parameter spec lifecycle deprecate/restore", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`insert into organizations (id, name) values ($1, 'Lifecycle Org')`, [ORG_ID]);
    await db.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'Lifecycle Admin', 'lifecycle@example.com', 'Admin', true)`,
      [USER_ID, ORG_ID],
    );
    await seedSpec(db, {
      specId: ACTIVE_SPEC,
      organizationId: ORG_ID,
      lifecycle: "active",
      key: "manual/lifecycle-active",
    });
    await seedSpec(db, {
      specId: DRAFT_SPEC,
      organizationId: ORG_ID,
      lifecycle: "draft",
      key: "manual/lifecycle-draft",
    });
    await seedSpec(db, {
      specId: GLOBAL_ACTIVE,
      organizationId: null,
      lifecycle: "active",
      key: "global/lifecycle-active",
    });
  });

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
  });

  it("deprecating an active org-owned definition makes it retrievable as deprecated", async () => {
    const result = await deprecateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      reason: "superseded by charging-policy v2",
    });

    expect(result.item.lifecycle).toBe("deprecated");

    const retrieved = await getParameterSpec(db!, makeAuth(), ACTIVE_SPEC);
    expect(retrieved.item.lifecycle).toBe("deprecated");
  });

  it("deprecating a draft org-owned definition archives it as deprecated", async () => {
    const result = await deprecateParameterSpec(db!, makeAuth(), {
      specId: DRAFT_SPEC,
      reason: "never completing this provisional shape",
    });
    expect(result.item.lifecycle).toBe("deprecated");
  });

  it("restoring a previously activated definition returns it to active", async () => {
    await deprecateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      reason: "temporary retirement",
    });

    const result = await restoreParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      reason: "still needed by aurora boards",
    });

    expect(result.item.lifecycle).toBe("active");
  });

  it("restoring a never-activated deprecated definition returns it to draft", async () => {
    await deprecateParameterSpec(db!, makeAuth(), {
      specId: DRAFT_SPEC,
      reason: "abandon provisional",
    });

    const result = await restoreParameterSpec(db!, makeAuth(), {
      specId: DRAFT_SPEC,
      reason: "resume drafting",
    });

    expect(result.item.lifecycle).toBe("draft");
  });

  it("rejects deprecating an already deprecated definition", async () => {
    await deprecateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      reason: "first retirement",
    });

    await expect(
      deprecateParameterSpec(db!, makeAuth(), {
        specId: ACTIVE_SPEC,
        reason: "second retirement",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 } satisfies Partial<ApiError>);
  });

  it("rejects restoring a non-deprecated definition", async () => {
    await expect(
      restoreParameterSpec(db!, makeAuth(), {
        specId: ACTIVE_SPEC,
        reason: "nothing to restore",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 } satisfies Partial<ApiError>);
  });

  it("rejects deprecating a platform-global definition", async () => {
    await expect(
      deprecateParameterSpec(db!, makeAuth(), {
        specId: GLOBAL_ACTIVE,
        reason: "should stay catalog-owned",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 } satisfies Partial<ApiError>);
  });

  it("HTTP deprecate then restore round-trips lifecycle on the public routes", async () => {
    const auth = makeAuth();
    const router = createRouter();
    registerParameterSpecRoutes(router, {
      db: db!,
      getCurrentAuthContext: () => auth,
    });
    const server = createHttpServer(router);

    const deprecated = await requestJson<{ item: { lifecycle: string } }>(
      server,
      `/api/v2/parameter-specs/${encodeURIComponent(ACTIVE_SPEC)}/deprecate`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "http soft retire" }),
      },
    );
    expect(deprecated.status).toBe(200);
    expect(deprecated.body.item.lifecycle).toBe("deprecated");

    const restored = await requestJson<{ item: { lifecycle: string } }>(
      server,
      `/api/v2/parameter-specs/${encodeURIComponent(ACTIVE_SPEC)}/restore`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "http restore" }),
      },
    );
    expect(restored.status).toBe(200);
    expect(restored.body.item.lifecycle).toBe("active");
  });

  it("HTTP deprecate without admin permission is forbidden", async () => {
    const auth = makeAuth();
    auth.permissions = ["parameter:view", "parameter:edit"];
    const router = createRouter();
    registerParameterSpecRoutes(router, {
      db: db!,
      getCurrentAuthContext: () => auth,
    });
    const server = createHttpServer(router);

    const denied = await requestJson(
      server,
      `/api/v2/parameter-specs/${encodeURIComponent(ACTIVE_SPEC)}/deprecate`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "no admin" }),
      },
    );
    expect(denied.status).toBe(403);
  });

  it("reports referenceCount from organization bindings on getParameterSpec", async () => {
    const projectId = "project-spec-lifecycle";
    const moduleId = "mod-lifecycle-unclassified";
    await db!.query(
      `insert into projects (id, organization_id, name, code, status)
       values ($1, $2, 'Lifecycle', 'LFC', 'initialized')`,
      [projectId, ORG_ID],
    );
    await db!.query(
      `
      insert into parameter_modules (
        id, organization_id, name, path, depth, kind, origin, parent_id, sort_order
      ) values ($1, $2, 'Unclassified', 'Unclassified', 0, 'unclassified', 'auto', null, 0)
      `,
      [moduleId, ORG_ID],
    );
    await db!.query(
      `
      insert into project_parameter_bindings (
        id, organization_id, project_id, parameter_spec_id, module_id, logical_node_id
      ) values
        ('binding-lifecycle-1', $1, $2, $3, $4, null)
      `,
      [ORG_ID, projectId, ACTIVE_SPEC, moduleId],
    );

    const retrieved = await getParameterSpec(db!, makeAuth(), ACTIVE_SPEC);
    expect(retrieved.item.referenceCount).toBe(1);
  });

  it("records before/after value_shape and constraints when updating an active definition", async () => {
    await updateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      valueShape: { kind: "u32", bits: 16 },
      constraints: { min: 0, max: 100 },
      documentation: "updated docs",
      reason: "tighten range",
    });

    const audits = await db!.query<{ metadata: Record<string, unknown> }>(
      `
      select metadata
      from audit_events
      where target_id = $1 and action = 'spec-updated'
      order by created_at desc
      limit 1
      `,
      [ACTIVE_SPEC],
    );
    expect(audits.rows[0]?.metadata).toMatchObject({
      previousValueShape: { kind: "u32" },
      nextValueShape: { kind: "u32", bits: 16 },
      previousConstraints: {},
      nextConstraints: { min: 0, max: 100 },
    });
  });
});
