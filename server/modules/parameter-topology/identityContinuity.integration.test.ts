import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import {
  applyReviewedContinuityToSnapshots,
  createOrReuseBinding,
  upsertBindingRevisionValues,
  type ReviewedContinuityDecision,
} from "./bindingService";
import { ingestConfigRevision } from "./ingestService";
import { CONTINUITY_BASELINE_STATUSES, listPreviousLogicalNodeSnapshots } from "./repository";
import { resolveIdentityMappingTask } from "./service";
import type { ConfigRevisionManifest } from "./types";
import type { LogicalNodeCandidate, LogicalNodeSnapshot } from "../dts/identity";

const SPEC_ID = "spec-cont-gpio";
const SPEC_VERSION_ID = "specver-cont-gpio";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-topo-continuity";
const PROJECT_ID = "project-topo-continuity";
const USER_ID = "user-topo-continuity";
const CONFIG_SET_ID = "dcs-topo-continuity";

const R1_SOURCE = `/dts-v1/;
/ {
	bus {
		dev@10 {
			reg = <0x10>;
			gpio_int = <1>;
		};
	};
};
`;

const AMBIGUOUS_SOURCE = `/dts-v1/;
/ {
	bus {
		left@10 {
			reg = <0x10>;
			gpio_int = <1>;
		};
		right@10 {
			reg = <0x10>;
			gpio_int = <2>;
		};
	};
};
`;

function makeAuth(): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Continuity Admin",
      email: "continuity@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: ORG_ID, name: "Continuity Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
}

async function seedGraph(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Continuity Org')
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID],
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Continuity Admin', 'continuity@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER_ID, ORG_ID],
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ($1, $2, 'Continuity', 'CONT', 'initialized')
    on conflict (id) do update set name = excluded.name
    `,
    [PROJECT_ID, ORG_ID],
  );
  await db.query(
    `
    insert into dts_config_set (id, organization_id, project_id, name, description)
    values ($1, $2, $3, 'continuity', 'identity continuity fixture')
    on conflict (id) do update set name = excluded.name
    `,
    [CONFIG_SET_ID, ORG_ID, PROJECT_ID],
  );
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'dts', 'dev/gpio_int')
    on conflict (id) do nothing
    `,
    [SPEC_ID, ORG_ID],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape, lifecycle
    ) values ($1, $2, 1, 'gpio_int', 'GPIO interrupt', '{}'::jsonb, 'active')
    on conflict (id) do nothing
    `,
    [SPEC_VERSION_ID, SPEC_ID],
  );
  await db.query(
    `
    insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
    values ($1, $2, 'gpio_int', 'vendor', '{}'::jsonb)
    on conflict (id) do nothing
    `,
    ["dps-cont-gpio", SPEC_ID],
  );
}

async function insertPinnedMember(
  db: InMemoryTestDatabase,
  input: {
    fileId: string;
    fileName: string;
    versionId: string;
    content: string;
  },
) {
  const checksum = createHash("sha256").update(input.content, "utf8").digest("hex");
  await db.query(
    `
    insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, $4, 'dts', true, $5, 'base', 0)
    on conflict (id) do update set file_name = excluded.file_name
    `,
    [input.fileId, ORG_ID, PROJECT_ID, input.fileName, CONFIG_SET_ID],
  );
  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)
    on conflict (id) do nothing
    `,
    [
      input.versionId,
      input.fileId,
      `${ORG_ID}/${checksum}-${input.fileName}`,
      checksum,
      Buffer.byteLength(input.content, "utf8"),
      USER_ID,
    ],
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    input.versionId,
    input.fileId,
  ]);
}

function manifestFor(
  fileId: string,
  versionId: string,
  fileName: string,
  content: string,
): ConfigRevisionManifest {
  return {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    configSetId: CONFIG_SET_ID,
    entryFile: fileName,
    includeSearchPaths: ["."],
    overlayOrder: [],
    members: [
      {
        fileId,
        fileVersionId: versionId,
        fileName,
        role: "base",
        sortOrder: 0,
        content,
      },
    ],
  };
}

async function logicalNodeAt(
  db: InMemoryTestDatabase,
  configRevisionId: string,
  nodeLocator: string,
) {
  const result = await db.query<{ logical_node_id: string }>(
    `
    select logical_node_id
    from dts_logical_node_revisions
    where config_revision_id = $1 and node_locator = $2
    limit 1
    `,
    [configRevisionId, nodeLocator],
  );
  return result.rows[0]?.logical_node_id ?? null;
}

describe("applyReviewedContinuityToSnapshots", () => {
  it("sets reviewedMappingTo from selected locator fingerprint", () => {
    const previous: LogicalNodeSnapshot[] = [
      {
        logicalNodeId: "ln-stable",
        nodeLocator: "/bus/dev@10",
        name: "dev",
        unitAddress: "10",
        parentLogicalNodeId: "ln-bus",
      },
    ];
    const candidates: LogicalNodeCandidate[] = [
      {
        logicalNodeId: "cand-left",
        nodeLocator: "/bus/left@10",
        name: "left",
        unitAddress: "10",
        parentLogicalNodeId: "ln-bus",
      },
      {
        logicalNodeId: "cand-right",
        nodeLocator: "/bus/right@10",
        name: "right",
        unitAddress: "10",
        parentLogicalNodeId: "ln-bus",
      },
    ];
    const decisions: ReviewedContinuityDecision[] = [
      {
        previousLogicalNodeId: "ln-stable",
        selectedNodeLocator: "/bus/left@10",
        selectedName: "left",
        selectedUnitAddress: "10",
      },
    ];

    const next = applyReviewedContinuityToSnapshots(previous, candidates, decisions);
    expect(next[0]?.reviewedMappingTo).toBe("cand-left");
  });
});

describe.skipIf(!databaseAvailable)("identity continuity across revisons", () => {
  let db: InMemoryTestDatabase | undefined;
  let auth: AuthContext;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedGraph(db);
    auth = makeAuth();
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("needs_mapping/invalid/resolving are not continuity baselines", async () => {
    expect(CONTINUITY_BASELINE_STATUSES).not.toContain("needs_mapping");
    expect(CONTINUITY_BASELINE_STATUSES).not.toContain("invalid");
    expect(CONTINUITY_BASELINE_STATUSES).not.toContain("resolving");

    const stableId = randomUUID();
    const blockedId = randomUUID();
    await db!.query(
      `
      insert into dts_config_revisions (
        id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
      ) values
        ($1, $2, $3, $4, 1, 'resolved', $5),
        ($6, $2, $3, $4, 2, 'needs_mapping', $5)
      `,
      [stableId, ORG_ID, PROJECT_ID, CONFIG_SET_ID, USER_ID, blockedId],
    );
    const ln = randomUUID();
    await db!.query(
      `
      insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
      values ($1, $2, $3, $4)
      `,
      [ln, ORG_ID, PROJECT_ID, CONFIG_SET_ID],
    );
    await db!.query(
      `
      insert into dts_logical_node_revisions (
        id, logical_node_id, config_revision_id, node_locator, name, unit_address, parent_logical_node_id
      ) values
        ($1, $2, $3, '/bus/dev@10', 'dev', '10', null),
        ($4, $2, $5, '/bus/left@10', 'left', '10', null)
      `,
      [randomUUID(), ln, stableId, randomUUID(), blockedId],
    );

    const snapshots = await listPreviousLogicalNodeSnapshots(db!, {
      configSetId: CONFIG_SET_ID,
      beforeRevisionNumber: 3,
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.nodeLocator).toBe("/bus/dev@10");
  });

  it(
    "R1 stable → R2 human resolve → R3 reuses reviewed continuity without duplicate mapping task",
    async () => {
      const fileR1 = "file-cont-r1";
      const verR1 = "fv-cont-r1";
      await insertPinnedMember(db!, {
        fileId: fileR1,
        fileName: "cont-r1.dts",
        versionId: verR1,
        content: R1_SOURCE,
      });
      const r1 = await ingestConfigRevision(
        db!,
        manifestFor(fileR1, verR1, "cont-r1.dts", R1_SOURCE),
        auth,
      );
      expect(r1.status).toBe("resolved");

      const stableLogicalNodeId = await logicalNodeAt(db!, r1.id, "/bus/dev@10");
      expect(stableLogicalNodeId).toBeTruthy();
      const binding = await createOrReuseBinding(db!, {
        organizationId: ORG_ID,
        key: {
          projectId: PROJECT_ID,
          logicalNodeId: stableLogicalNodeId!,
          parameterSpecId: SPEC_ID,
        },
      });
      await upsertBindingRevisionValues(db!, {
        bindingId: binding.id,
        configRevisionId: r1.id,
        parameterSpecVersionId: SPEC_VERSION_ID,
        values: { typedValue: { kind: "cells" }, rawValue: "<1>", schemaState: "valid" },
      });
      const stableBindingId = binding.id;

      const fileR2 = "file-cont-r2";
      const verR2 = "fv-cont-r2";
      await insertPinnedMember(db!, {
        fileId: fileR2,
        fileName: "cont-r2.dts",
        versionId: verR2,
        content: AMBIGUOUS_SOURCE,
      });
      const r2 = await ingestConfigRevision(
        db!,
        manifestFor(fileR2, verR2, "cont-r2.dts", AMBIGUOUS_SOURCE),
        auth,
      );
      expect(r2.status).toBe("needs_mapping");

      const openTasks = await db!.query<{
        id: string;
        previous_logical_node_id: string | null;
        candidate_logical_node_ids: unknown;
        evidence: unknown;
      }>(
        `
        select id, previous_logical_node_id, candidate_logical_node_ids, evidence
        from identity_mapping_tasks
        where config_revision_id = $1 and status = 'open'
        `,
        [r2.id],
      );
      expect(openTasks.rows.length).toBeGreaterThanOrEqual(1);

      const taskForStable = openTasks.rows.find(
        (row) => row.previous_logical_node_id === stableLogicalNodeId,
      );
      expect(taskForStable).toBeTruthy();

      const evidence =
        taskForStable!.evidence &&
        typeof taskForStable!.evidence === "object" &&
        !Array.isArray(taskForStable!.evidence)
          ? (taskForStable!.evidence as {
              candidates?: Array<{ logicalNodeId: string; nodeLocator: string }>;
            })
          : {};
      const leftCandidate = evidence.candidates?.find((c) => c.nodeLocator === "/bus/left@10");
      expect(leftCandidate?.logicalNodeId).toBeTruthy();

      const resolved = await resolveIdentityMappingTask(db!, auth, {
        taskId: taskForStable!.id,
        decision: "resolved",
        selectedLogicalNodeId: leftCandidate!.logicalNodeId,
        reason: "Same board instance as R1 left path",
      });
      expect(resolved.status).toBe("resolved");

      const r2Status = await db!.query<{ status: string }>(
        `select status from dts_config_revisions where id = $1`,
        [r2.id],
      );
      // May still be needs_mapping if other open tasks remain (e.g. bus-only).
      // Resolve any remaining open tasks by dismissing non-stable or resolving uniquely.
      const stillOpen = await db!.query<{ id: string; previous_logical_node_id: string | null; evidence: unknown }>(
        `
        select id, previous_logical_node_id, evidence
        from identity_mapping_tasks
        where config_revision_id = $1 and status = 'open'
        `,
        [r2.id],
      );
      for (const task of stillOpen.rows) {
        const ev =
          task.evidence && typeof task.evidence === "object" && !Array.isArray(task.evidence)
            ? (task.evidence as {
                candidates?: Array<{ logicalNodeId: string; nodeLocator: string }>;
              })
            : {};
        const pick = ev.candidates?.[0];
        if (!pick) continue;
        await resolveIdentityMappingTask(db!, auth, {
          taskId: task.id,
          decision: "resolved",
          selectedLogicalNodeId: pick.logicalNodeId,
          reason: "Clear remaining ambiguity for continuity baseline",
        });
      }

      const r2Final = await db!.query<{ status: string }>(
        `select status from dts_config_revisions where id = $1`,
        [r2.id],
      );
      expect(r2Final.rows[0]?.status).toBe("resolved");
      expect(r2Status.rows[0]?.status).toBeTruthy();

      expect(await logicalNodeAt(db!, r2.id, "/bus/left@10")).toBe(stableLogicalNodeId);
      const r2Binding = await createOrReuseBinding(db!, {
        organizationId: ORG_ID,
        key: {
          projectId: PROJECT_ID,
          logicalNodeId: stableLogicalNodeId!,
          parameterSpecId: SPEC_ID,
        },
      });
      expect(r2Binding.id).toBe(stableBindingId);

      const reuseEvidence = await db!.query<{ evidence: unknown }>(
        `select evidence from identity_mapping_tasks where id = $1`,
        [taskForStable!.id],
      );
      const reused = reuseEvidence.rows[0]?.evidence as Record<string, unknown>;
      expect(reused.continuityReusable).toBe(true);
      expect(reused.selectedNodeLocator).toBe("/bus/left@10");

      const fileR3 = "file-cont-r3";
      const verR3 = "fv-cont-r3";
      await insertPinnedMember(db!, {
        fileId: fileR3,
        fileName: "cont-r3.dts",
        versionId: verR3,
        content: AMBIGUOUS_SOURCE,
      });
      const r3 = await ingestConfigRevision(
        db!,
        manifestFor(fileR3, verR3, "cont-r3.dts", AMBIGUOUS_SOURCE),
        auth,
      );

      expect(r3.status).toBe("resolved");
      const r3Open = await db!.query<{ c: string }>(
        `
        select count(*)::text as c
        from identity_mapping_tasks
        where config_revision_id = $1 and status = 'open'
        `,
        [r3.id],
      );
      expect(Number(r3Open.rows[0]?.c ?? 0)).toBe(0);

      expect(await logicalNodeAt(db!, r3.id, "/bus/left@10")).toBe(stableLogicalNodeId);
      const r3Binding = await createOrReuseBinding(db!, {
        organizationId: ORG_ID,
        key: {
          projectId: PROJECT_ID,
          logicalNodeId: stableLogicalNodeId!,
          parameterSpecId: SPEC_ID,
        },
      });
      expect(r3Binding.id).toBe(stableBindingId);
    },
    60_000,
  );
});
