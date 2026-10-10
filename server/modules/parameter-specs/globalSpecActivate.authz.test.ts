/**
 * Round 6 T3: org admins may read/bind active global specs but cannot activate global drafts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { requestJson } from "../../test/testClient";
import { createWiseEffServer } from "../../app";
import { catalogLegacyGoneResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { listParameterSpecs } from "./service";
import { getParameterSpecRow } from "./repository";

const ORG_A = "org-global-activate-a";
const ORG_B = "org-global-activate-b";
const USER_A = "user-global-activate-a";
const USER_B = "user-global-activate-b";
const GLOBAL_DRAFT = "pspec:global:round6-draft";
const GLOBAL_ACTIVE = "pspec:global:round6-active";
const ORG_DRAFT = "pspec:org:round6-draft";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(orgId: string, userId: string, permissions = ["parameter:view", "parameter:edit", "parameter:review", "admin:access"]): AuthContext {
  return makeTestAuthContext({
    userId,
    organizationId: orgId,
    name: `Admin ${orgId}`,
    email: `${userId}@example.com`,
    organizationName: orgId,
    permissions,
  });
}

async function seed(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'A'), ($2, 'B')
     on conflict (id) do update set name = excluded.name`,
    [ORG_A, ORG_B],
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active) values
      ($1, $2, 'Admin A', 'a@example.com', 'Admin', true),
      ($3, $4, 'Admin B', 'b@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER_A, ORG_A, USER_B, ORG_B],
  );

  for (const [specId, orgId, lifecycle, key] of [
    [GLOBAL_DRAFT, null, "draft", "global/round6-draft"],
    [GLOBAL_ACTIVE, null, "active", "global/round6-active"],
    [ORG_DRAFT, ORG_A, "draft", "manual/round6-org-draft"],
  ] as const) {
    await db.query(
      `
      insert into parameter_specs (id, organization_id, source_kind, specification_key)
      values ($1, $2, 'manual', $3)
      on conflict (id) do nothing
      `,
      [specId, orgId, key],
    );
    const versionId = `${specId}:v1`;
    await db.query(
      `
      insert into parameter_spec_versions (
        id, parameter_spec_id, version, display_name, description, value_shape,
        schema_default, example_value, lifecycle
      ) values ($1, $2, 1, $3, $3, '{"kind":"cells","bits":32,"groups":1,"cellsPerGroup":1}'::jsonb,
                null, null, $4)
      on conflict (id) do nothing
      `,
      [versionId, specId, key, lifecycle],
    );
    await db.query(
      `
      insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints, documentation)
      values ($1, $2, $3, 'manual', '{"cells":1}'::jsonb, 'fixture')
      on conflict (id) do nothing
      `,
      [`dps-${specId}`, specId, key.split("/")[1] ?? key],
    );
  }
}

describe.skipIf(!databaseAvailable)("global spec activation authz", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seed(db);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("assembled HTTP activate is retired; historical globals remain available to operator readers", async () => {
    const auth = makeAuth(ORG_A, USER_A);

    const denied = await requestJson(createWiseEffServer({ db: db! }), `/api/v2/parameter-specs/${encodeURIComponent(GLOBAL_DRAFT)}/activate`, {
      method: "POST",
      body: JSON.stringify({
        valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
        constraints: { cells: 1 },
        documentation: "HTTP global activate",
        reason: "denied",
      }),
    });
    expect(denied.status).toBe(410);
    expect(catalogLegacyGoneResponseSchema.parse(denied.body).error.details).toEqual({
      reason: "legacy-surface-retired", successor: "/api/v2/catalog", retryable: false,
    });

    const listed = await listParameterSpecs(db!, auth, { q: "round6-active" });
    expect(listed.items.some((item) => item.id === GLOBAL_ACTIVE)).toBe(true);
    const detail = await getParameterSpecRow(db!, {
      organizationId: ORG_A,
      specId: GLOBAL_ACTIVE,
    });
    expect(detail).toMatchObject({ id: GLOBAL_ACTIVE, lifecycle: "active" });
  });
});
