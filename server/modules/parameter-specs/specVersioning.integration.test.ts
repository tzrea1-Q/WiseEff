/**
 * PR3: versioned ParameterSpec activate successor + definition-level soft deprecate (ADR-0014).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { ApiError } from "../../shared/http/errors";
import {
  activateParameterSpec,
  deprecateParameterSpec,
  getParameterSpec,
  restoreParameterSpec,
} from "./service";

const ORG_ID = "org-spec-versioning";
const USER_ID = "user-spec-versioning";
const DRAFT_SPEC = "pspec:versioning:draft";
const ACTIVE_SPEC = "pspec:versioning:active";
const GLOBAL_ACTIVE = "pspec:versioning:global-active";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Versioning Admin",
      email: "versioning@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: ORG_ID, name: "Versioning Org" },
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
    valueShape?: Record<string, unknown>;
  },
) {
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key, definition_lifecycle)
    values ($1, $2, 'manual', $3, $4)
    on conflict (id) do nothing
    `,
    [input.specId, input.organizationId, input.key, input.lifecycle],
  );
  const versionId = `${input.specId}:v1`;
  const valueShape = input.valueShape ?? { kind: "string" };
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle, version_status, activated_at,
      constraints, documentation
    ) values (
      $1, $2, 1, $3, $3, $4::jsonb,
      null, null, $5, $6, $7::timestamptz,
      '{}'::jsonb, 'fixture docs'
    )
    on conflict (id) do nothing
    `,
    [
      versionId,
      input.specId,
      input.key,
      JSON.stringify(valueShape),
      input.lifecycle === "deprecated" ? "deprecated" : input.lifecycle,
      input.lifecycle === "deprecated" ? "superseded" : input.lifecycle,
      input.lifecycle === "active" ? "2026-07-01T00:00:00.000Z" : null,
    ],
  );
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, property_key, schema_namespace, constraints, documentation
    ) values ($1, $2, $3, 'manual', '{}'::jsonb, 'fixture docs')
    on conflict (id) do nothing
    `,
    [`dps-${input.specId}`, input.specId, input.key.split("/").pop() ?? input.key],
  );
}

describe.skipIf(!databaseAvailable)("parameter spec versioning (ADR-0014)", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`insert into organizations (id, name) values ($1, 'Versioning Org')`, [ORG_ID]);
    await db.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'Versioning Admin', 'versioning@example.com', 'Admin', true)`,
      [USER_ID, ORG_ID],
    );
    await seedSpec(db, {
      specId: DRAFT_SPEC,
      organizationId: ORG_ID,
      lifecycle: "draft",
      key: "manual/versioning-draft",
    });
    await seedSpec(db, {
      specId: ACTIVE_SPEC,
      organizationId: ORG_ID,
      lifecycle: "active",
      key: "manual/versioning-active",
      valueShape: { kind: "string" },
    });
    await seedSpec(db, {
      specId: GLOBAL_ACTIVE,
      organizationId: null,
      lifecycle: "active",
      key: "global/versioning-active",
    });
  });

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
  });

  it("first activate promotes the single draft version without inserting a successor", async () => {
    const result = await activateParameterSpec(db!, makeAuth(), {
      specId: DRAFT_SPEC,
      valueShape: { kind: "string" },
      constraints: {},
      documentation: "activated docs",
      reason: "complete draft",
    });

    expect(result.item.lifecycle).toBe("active");
    expect(result.item.currentVersion).toBe(1);

    const versions = await db!.query<{ version: number; version_status: string; lifecycle: string }>(
      `
      select version, version_status, lifecycle
      from parameter_spec_versions
      where parameter_spec_id = $1
      order by version asc
      `,
      [DRAFT_SPEC],
    );
    expect(versions.rows).toHaveLength(1);
    expect(versions.rows[0]).toMatchObject({
      version: 1,
      version_status: "active",
      lifecycle: "active",
    });

    const definition = await db!.query<{ definition_lifecycle: string; activated_at: string | null }>(
      `
      select ps.definition_lifecycle, psv.activated_at::text as activated_at
      from parameter_specs ps
      join parameter_spec_versions psv on psv.parameter_spec_id = ps.id
      where ps.id = $1
      `,
      [DRAFT_SPEC],
    );
    expect(definition.rows[0]?.definition_lifecycle).toBe("active");
    expect(definition.rows[0]?.activated_at).toBeTruthy();
  });

  it("activate with content change inserts a successor and supersedes the prior active version", async () => {
    const result = await activateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      valueShape: { kind: "string" },
      constraints: { maxLength: 64 },
      documentation: "successor docs",
      reason: "tighten semantics",
    });

    expect(result.item.lifecycle).toBe("active");
    expect(result.item.currentVersion).toBe(2);
    expect(result.item.currentVersionId).not.toBe(`${ACTIVE_SPEC}:v1`);

    const versions = await db!.query<{
      version: number;
      version_status: string;
      lifecycle: string;
      documentation: string | null;
    }>(
      `
      select version, version_status, lifecycle, documentation
      from parameter_spec_versions
      where parameter_spec_id = $1
      order by version asc
      `,
      [ACTIVE_SPEC],
    );
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows[0]).toMatchObject({
      version: 1,
      version_status: "superseded",
      lifecycle: "deprecated",
    });
    expect(versions.rows[1]).toMatchObject({
      version: 2,
      version_status: "active",
      lifecycle: "active",
      documentation: "successor docs",
    });

    // Historical binding FK target must remain intact.
    const oldVersion = await db!.query<{ id: string }>(
      `select id from parameter_spec_versions where id = $1`,
      [`${ACTIVE_SPEC}:v1`],
    );
    expect(oldVersion.rows).toHaveLength(1);
  });

  it("deprecating an active definition soft-retires the definition without superseding its active version", async () => {
    const result = await deprecateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      reason: "library soft retire",
    });
    expect(result.item.lifecycle).toBe("deprecated");

    const retrieved = await getParameterSpec(db!, makeAuth(), ACTIVE_SPEC);
    expect(retrieved.item.lifecycle).toBe("deprecated");

    const versions = await db!.query<{ version_status: string; definition_lifecycle: string }>(
      `
      select psv.version_status, ps.definition_lifecycle
      from parameter_spec_versions psv
      join parameter_specs ps on ps.id = psv.parameter_spec_id
      where psv.parameter_spec_id = $1
      `,
      [ACTIVE_SPEC],
    );
    expect(versions.rows[0]?.definition_lifecycle).toBe("deprecated");
    expect(versions.rows[0]?.version_status).toBe("active");
  });

  it("restoring a previously activated definition returns it to active", async () => {
    await deprecateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      reason: "temporary retirement",
    });

    const result = await restoreParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      reason: "still needed",
    });
    expect(result.item.lifecycle).toBe("active");
  });

  it("rejects org admin deprecating a platform-global definition", async () => {
    await expect(
      deprecateParameterSpec(db!, makeAuth(), {
        specId: GLOBAL_ACTIVE,
        reason: "org admin cannot govern platform rows",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 } satisfies Partial<ApiError>);
  });

  it("platform-admin deprecates and restores a platform-global definition", async () => {
    const platformAuth = makeAuth();
    platformAuth.roles = [{ projectId: null, roleId: "platform-admin" }];
    platformAuth.permissions = [
      "parameter:view",
      "parameter:edit",
      "admin:access",
      "platform:access",
      "platform:schema-promote",
    ];

    const deprecated = await deprecateParameterSpec(db!, platformAuth, {
      specId: GLOBAL_ACTIVE,
      reason: "platform soft retire",
    });
    expect(deprecated.item.lifecycle).toBe("deprecated");

    const restored = await restoreParameterSpec(db!, platformAuth, {
      specId: GLOBAL_ACTIVE,
      reason: "platform restore",
    });
    expect(restored.item.lifecycle).toBe("active");
  });
});
