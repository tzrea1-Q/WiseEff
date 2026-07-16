/**
 * Round 6 T6: semantic fixture cleanup must scope Config Set deletes by org+project+name.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { withPgClient } from "../../../e2e/acceptance/helpers/database";
import { cleanupSemanticAcceptanceArtifacts } from "../../../e2e/acceptance/helpers/semanticFixtureCleanup";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";

const ORG_A = "org-cleanup-iso-a";
const ORG_B = "org-cleanup-iso-b";
const PROJECT_A1 = "project-cleanup-iso-a1";
const PROJECT_A2 = "project-cleanup-iso-a2";
const PROJECT_B = "project-cleanup-iso-b";
const SHARED_NAME = "shared-acceptance-cs-r6";

const databaseAvailable = await isTestDatabaseAvailable();

function ensureDatabaseUrl() {
  if (!process.env.DATABASE_URL?.trim()) {
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL?.trim() || "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff";
  }
}

async function ensureTenantGraph() {
  ensureDatabaseUrl();
  const ids = {
    a1: `dcs-cleanup-a1-${randomUUID().slice(0, 8)}`,
    a2: `dcs-cleanup-a2-${randomUUID().slice(0, 8)}`,
    b: `dcs-cleanup-b-${randomUUID().slice(0, 8)}`,
  };
  await withPgClient(async (client) => {
    await client.query(
      `insert into organizations (id, name) values ($1, 'A'), ($2, 'B')
       on conflict (id) do update set name = excluded.name`,
      [ORG_A, ORG_B],
    );
    for (const [projectId, orgId, code] of [
      [PROJECT_A1, ORG_A, "CA1"],
      [PROJECT_A2, ORG_A, "CA2"],
      [PROJECT_B, ORG_B, "CB"],
    ] as const) {
      await client.query(
        `
        insert into projects (id, organization_id, name, code, status)
        values ($1, $2, $3, $4, 'initialized')
        on conflict (id) do update set organization_id = excluded.organization_id
        `,
        [projectId, orgId, `Cleanup ${code}`, code],
      );
    }
    for (const row of [
      { id: ids.a1, orgId: ORG_A, projectId: PROJECT_A1 },
      { id: ids.a2, orgId: ORG_A, projectId: PROJECT_A2 },
      { id: ids.b, orgId: ORG_B, projectId: PROJECT_B },
    ]) {
      await client.query(
        `
        insert into dts_config_set (id, organization_id, project_id, name, description)
        values ($1, $2, $3, $4, 'cleanup isolation')
        on conflict (id) do update set name = excluded.name
        `,
        [row.id, row.orgId, row.projectId, SHARED_NAME],
      );
    }
  });
  return ids;
}

async function wipeSharedName() {
  ensureDatabaseUrl();
  for (const [orgId, projectId] of [
    [ORG_A, PROJECT_A1],
    [ORG_A, PROJECT_A2],
    [ORG_B, PROJECT_B],
  ] as const) {
    await cleanupSemanticAcceptanceArtifacts({
      organizationId: orgId,
      projectId,
      configSetNames: [SHARED_NAME],
    }).catch(() => undefined);
  }
}

describe.skipIf(!databaseAvailable)("semanticFixtureCleanup tenant isolation", () => {
  it("fail-closes when organizationId or projectId is missing", async () => {
    ensureDatabaseUrl();
    await expect(
      cleanupSemanticAcceptanceArtifacts({
        organizationId: "",
        projectId: PROJECT_A1,
        configSetNames: [SHARED_NAME],
      }),
    ).rejects.toThrow(/organizationId and projectId/);

    await expect(
      cleanupSemanticAcceptanceArtifacts({
        organizationId: ORG_A,
        projectId: "  ",
        configSetNames: [SHARED_NAME],
      }),
    ).rejects.toThrow(/organizationId and projectId/);
  });

  it("deletes only the target org+project Config Set when names collide", async () => {
    await wipeSharedName();
    const ids = await ensureTenantGraph();

    try {
      await cleanupSemanticAcceptanceArtifacts({
        organizationId: ORG_A,
        projectId: PROJECT_A1,
        configSetNames: [SHARED_NAME],
      });

      await withPgClient(async (client) => {
        const remaining = await client.query<{ id: string; project_id: string }>(
          `select id, project_id from dts_config_set where name = $1 order by project_id`,
          [SHARED_NAME],
        );
        const remainingIds = remaining.rows.map((row) => row.id);
        expect(remainingIds).not.toContain(ids.a1);
        expect(remainingIds).toEqual(expect.arrayContaining([ids.a2, ids.b]));
        expect(remaining.rows.find((row) => row.id === ids.a2)?.project_id).toBe(PROJECT_A2);
        expect(remaining.rows.find((row) => row.id === ids.b)?.project_id).toBe(PROJECT_B);
      });
    } finally {
      await wipeSharedName();
    }
  });
});
