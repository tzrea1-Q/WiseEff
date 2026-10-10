import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../app";
import {
  createPostgresDatabase,
  getRootPostgresPool,
  type RootDatabase,
} from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedOrganization, seedUser } from "../../testing/fixtures";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "../../testing/parameterCatalog";
import { installParameterModuleComparisonCatalogFixture } from "../../testing/parameterCatalog/registryProjection";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import {
  CATALOG_IDEMPOTENCY_HEADER,
  CATALOG_RELEASE_HEADER,
  catalogRegistrationListResponseSchema,
} from "../contracts/dtoSchemas/parameterCatalog";
import {
  countCanonicalPlacementsForModules,
  createParameterModule,
} from "../parameters/parameterModuleRepository";

const databaseAvailable = await isTestDatabaseAvailable();
const organizationId = "org-b4-registration";
const foreignOrganizationId = "org-b4-foreign";
const actors = {
  admin: { organizationId, roleId: "admin" },
  viewer: { organizationId, roleId: "guest" },
  platform: { organizationId, roleId: "platform-admin" },
  foreignAdmin: { organizationId: foreignOrganizationId, roleId: "admin" },
} as const;
type Actor = keyof typeof actors;

describe.skipIf(!databaseAvailable)("canonical registration guards through the assembled API", () => {
  let database: ParameterCatalogDatabase;
  let root: RootDatabase;
  let server: Server;
  let releaseId: string;
  let businessModuleId: string;
  let nodeModuleId: string;
  let driverModuleId: string;
  let foreignModuleId: string;

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("b4registration");
    root = createPostgresDatabase(database.url);
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("Registration guard tests require real PostgreSQL.");
    const { pin } = await installParameterModuleComparisonCatalogFixture(pool);
    releaseId = pin.id;
    for (const id of [organizationId, foreignOrganizationId]) {
      await seedOrganization(root, { id });
    }
    for (const [actor, identity] of Object.entries(actors)) {
      const userId = `user-b4-${actor}`;
      await seedUser(root, { id: userId, organizationId: identity.organizationId });
      await root.query(
        `insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
         values ($1, $2, $3, null, $4)`,
        [`role-b4-${actor}`, userId, identity.organizationId, identity.roleId],
      );
    }
    businessModuleId = (await createParameterModule(root, {
      organizationId, name: "Business", kind: "business",
    })).id;
    nodeModuleId = (await createParameterModule(root, {
      organizationId, name: "Node", kind: "node-type",
    })).id;
    driverModuleId = (await createParameterModule(root, {
      organizationId, name: "Driver", kind: "driver-group",
    })).id;
    foreignModuleId = (await createParameterModule(root, {
      organizationId: foreignOrganizationId, name: "Foreign driver", kind: "driver-group",
    })).id;
    server = createWiseEffServer({
      db: root,
      auth: {
        mode: "production",
        verifier: {
          verify: async (authorization) => {
            const actor = String(authorization ?? "").replace(/^Bearer\s+/i, "") as Actor;
            if (!Object.hasOwn(actors, actor)) throw new Error("Unknown test actor.");
            return makeTestAuthContext({
              userId: `user-b4-${actor}`,
              organizationId: actors[actor].organizationId,
              roles: [],
              permissions: [],
            });
          },
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await root?.close();
    await database?.close();
  });

  const assertNoRegistrationOrPlacement = async () => {
    for (const actor of ["admin", "foreignAdmin"] as const) {
      const id = actors[actor].organizationId;
      const response = await requestJson(server, `/api/v2/organizations/${id}/subject-registrations`, {
        headers: { authorization: `Bearer ${actor}`, [CATALOG_RELEASE_HEADER]: releaseId },
      });
      expect(response.status, response.bodyText).toBe(200);
      expect(catalogRegistrationListResponseSchema.parse(response.body).items).toEqual([]);
      expect(await countCanonicalPlacementsForModules(root, {
        organizationId: id,
        moduleIds: [businessModuleId, nodeModuleId, driverModuleId, foreignModuleId],
      })).toBe(0);
    }
  };

  const register = (actor: Actor, destinationModuleId: string, targetOrganizationId = organizationId) =>
    requestJson(server, `/api/v2/organizations/${targetOrganizationId}/subject-registrations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${actor}`,
        [CATALOG_RELEASE_HEADER]: releaseId,
        [CATALOG_IDEMPOTENCY_HEADER]: randomUUID(),
      },
      body: JSON.stringify({
        subjectId: "csub_acme_power",
        placement: { mode: "use-default" },
        destinationModuleId,
      }),
    });

  it.each(["missing module", "business module", "node-type module", "cross-tenant module"] as const)(
    "rejects a %s without persisting registration or placement",
    async (target) => {
      await assertNoRegistrationOrPlacement();
      const destinationModuleId = {
        "missing module": "missing-b4-module",
        "business module": businessModuleId,
        "node-type module": nodeModuleId,
        "cross-tenant module": foreignModuleId,
      }[target];
      const response = await register("admin", destinationModuleId);
      expect(response.status, response.bodyText).toBe(400);
      expect(response.body).toMatchObject({
        error: { code: "VALIDATION_FAILED", details: { field: "destinationModuleId", retryable: false } },
      });
      await assertNoRegistrationOrPlacement();
    },
  );

  it.each(["viewer", "platform"] as const)("rejects %s-only registration authority", async (actor) => {
    await assertNoRegistrationOrPlacement();
    const response = await register(actor, driverModuleId);
    expect(response.status, response.bodyText).toBe(403);
    expect(response.body).toMatchObject({
      error: { code: "FORBIDDEN", details: { reason: "forbidden", retryable: false } },
    });
    await assertNoRegistrationOrPlacement();
  });

  it("rejects an administrator writing another tenant's registration", async () => {
    await assertNoRegistrationOrPlacement();
    const response = await register("admin", foreignModuleId, foreignOrganizationId);
    expect(response.status, response.bodyText).toBe(403);
    expect(response.body).toMatchObject({
      error: { code: "FORBIDDEN", details: { reason: "forbidden", retryable: false } },
    });
    await assertNoRegistrationOrPlacement();
  });
});
