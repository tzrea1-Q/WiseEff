
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { requestJson } from "../../test/testClient";
import { createWiseEffServer } from "../../app";
import { catalogLegacyGoneResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { listParameterSpecs } from "./service";

const ORG_ID = "org-spec-lifecycle";
const USER_ID = "user-spec-lifecycle";
const ACTIVE_SPEC = "pspec:org:lifecycle-active";
const DRAFT_SPEC = "pspec:org:lifecycle-draft";
const GLOBAL_ACTIVE = "pspec:global:lifecycle-active";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: USER_ID,
    organizationId: ORG_ID,
    name: "Lifecycle Admin",
    email: "lifecycle@example.com",
    organizationName: "Lifecycle Org",
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
  });
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

  it("assembled HTTP deprecate and restore are retired and keep lifecycle unchanged", async () => {
    const server = createWiseEffServer({ db: db! });

    const deprecated = await requestJson<{ item: { lifecycle: string } }>(
      server,
      `/api/v2/parameter-specs/${encodeURIComponent(ACTIVE_SPEC)}/deprecate`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "http soft retire" }),
      },
    );
    expect(deprecated.status).toBe(410);
    expect(catalogLegacyGoneResponseSchema.parse(deprecated.body).error.details.reason).toBe("legacy-surface-retired");

    const restored = await requestJson<{ item: { lifecycle: string } }>(
      server,
      `/api/v2/parameter-specs/${encodeURIComponent(ACTIVE_SPEC)}/restore`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "http restore" }),
      },
    );
    expect(restored.status).toBe(410);
    expect(catalogLegacyGoneResponseSchema.parse(restored.body).error.details.reason).toBe("legacy-surface-retired");
    const detail = await listParameterSpecs(db!, makeAuth());
    expect(detail.items.find((item) => item.id === ACTIVE_SPEC)?.lifecycle).toBe("active");
  });

  it("assembled HTTP deprecate is gone even without an authenticated admin", async () => {
    const server = createWiseEffServer({ db: db! });

    const denied = await requestJson(
      server,
      `/api/v2/parameter-specs/${encodeURIComponent(ACTIVE_SPEC)}/deprecate`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "no admin" }),
      },
    );
    expect(denied.status).toBe(410);
    expect(catalogLegacyGoneResponseSchema.parse(denied.body).error.details.reason).toBe("legacy-surface-retired");
  });

  it("reports retained referenceCount from organization bindings", async () => {
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

    const retrieved = await listParameterSpecs(db!, makeAuth());
    expect(retrieved.items.find((item) => item.id === ACTIVE_SPEC)?.referenceCount).toBe(1);
  });
});
