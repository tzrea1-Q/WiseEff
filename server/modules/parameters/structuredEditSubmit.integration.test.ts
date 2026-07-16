import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { registerParameterFileRoutes } from "../parameter-files/routes";
import { uploadProjectParameterFile } from "../parameter-files/service";
import { classifyDtsValue } from "../dts";
import { registerParameterRoutes } from "./routes";
import { submitStructuredEdits } from "./service";

const ORG = "org-p31-edit";
const USER = "user-p31-edit";
const PROJECT = "project-p31-edit";
const PD = "pd-p31-hex";
const PPV = "ppv-p31-hex";

/** Hex rawText that normalizes to lowercase — writeback must keep this exact form. */
const RAW_HEX = "/bits/ 8 <0xAB 0xCD 0xEF 0x12>";
const NORMALIZED_HEX = classifyDtsValue(RAW_HEX, "mixed_case_reg").normalizedValue;

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: USER,
      organizationId: ORG,
      name: "P31 Editor",
      email: "p31-edit@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: ORG, name: "P31 Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "parameter:edit-critical", "admin:access"],
    ...overrides
  };
}

function createMemoryObjectStore(): ObjectStore {
  const entries = new Map<string, Buffer>();
  return {
    async put(input) {
      const checksum = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = `${input.organizationId}/${checksum}-${input.fileName}`;
      entries.set(storageKey, Buffer.from(input.bytes));
      return {
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.byteLength,
        checksumSha256: checksum
      };
    },
    async get(storageKey) {
      const value = entries.get(storageKey);
      if (!value) throw new Error(`Missing object: ${storageKey}`);
      return Buffer.from(value);
    }
  };
}

function makeServer(db: InMemoryTestDatabase, objectStore: ObjectStore, auth: AuthContext = makeAuth()) {
  const router = createRouter();
  const routeOptions = {
    db,
    objectStore,
    getCurrentAuthContext: () => auth
  };
  registerParameterFileRoutes(router, routeOptions);
  registerParameterRoutes(router, routeOptions);
  return createHttpServer(router);
}

async function advanceReview(server: ReturnType<typeof createHttpServer>, requestId: string) {
  const response = await requestJson<{ item: { status: string } }>(
    server,
    `/api/v1/parameter-change-requests/${requestId}/review`,
    {
      method: "POST",
      body: JSON.stringify({ decision: "advance", note: "p31 advance" })
    }
  );
  expect(response.status).toBe(200);
  return response.body.item.status;
}

async function seedBaseline(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'P31 Org')
     on conflict (id) do update set name = excluded.name`,
    [ORG]
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'P31 Editor', 'p31-edit@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER, ORG]
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ($1, $2, 'P31', 'P31', 'initialized')
    on conflict (id) do update set name = excluded.name
    `,
    [PROJECT, ORG]
  );
  await db.query(
    `
    insert into parameter_definitions (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    ) values (
      $1, $2, 'mixed_case_reg', 'hex reg', 'hex reg', 'DTS',
      'amba/i2c@XXXX0000', '', '', 'Low'
    ) on conflict (id) do update set name = excluded.name, module = excluded.module
    `,
    [PD, ORG]
  );
  await db.query(
    `
    insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version, updated_by_user_id,
      source_file_name, source_node_path
    ) values (
      $1, $2, $3, $4,
      '/bits/ 8 <0xab 0xcd 0xef 0x12>', '/bits/ 8 <0xab 0xcd 0xef 0x12>', 1, $5,
      null, null
    ) on conflict (id) do update set current_value = excluded.current_value
    `,
    [PPV, ORG, PROJECT, PD, USER]
  );
}

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("P3.1 structured edit submit mapping", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedBaseline(db);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("maps structured edit to PPV by source, submits CR with rawText (not normalizedValue)", async () => {
    expect(NORMALIZED_HEX).not.toBe(RAW_HEX);
    expect(NORMALIZED_HEX).toBe("/bits/ 8 <0xab 0xcd 0xef 0x12>");

    const objectStore = createMemoryObjectStore();
    const auth = makeAuth();
    const fileName = `p31-${randomUUID()}.dts`;
    const dts = `&amba {
	i2c@XXXX0000 {
		mixed_case_reg = /bits/ 8 <0xab 0xcd 0xef 0x12>;
	};
};
`;
    const uploaded = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: PROJECT,
      fileName,
      bytes: Buffer.from(dts, "utf8")
    });

    // Bind identity fallback so source columns exist (sync would also do this).
    await db!.query(
      `
      update project_parameter_values
      set source_file_name = $1, source_node_path = $2
      where id = $3
      `,
      [fileName, "amba/i2c@XXXX0000/mixed_case_reg", PPV]
    );

    const bindingId = `binding-p31-${randomUUID().slice(0, 8)}`;
    const specId = `spec-p31-${randomUUID().slice(0, 8)}`;
    await db!.query(
      `
      insert into parameter_specs (id, organization_id, source_kind, specification_key)
      values ($1, $2, 'dts', 'amba/mixed_case_reg')
      `,
      [specId, ORG]
    );
    await db!.query(
      `
      insert into project_parameter_bindings (id, organization_id, project_id, logical_node_id, parameter_spec_id)
      values ($1, $2, $3, null, $4)
      `,
      [bindingId, ORG, PROJECT, specId]
    );

    const round = await submitStructuredEdits(db!, auth, {
      projectId: PROJECT,
      edits: [
        {
          fileId: uploaded.file.id,
          nodePath: "amba/i2c@XXXX0000",
          propertyName: "mixed_case_reg",
          rawText: RAW_HEX,
          reason: "raise hex casing for writeback fidelity",
          projectParameterBindingId: bindingId,
          parameterSpecId: specId
        }
      ],
      reason: "P3.1 structured edit submit"
    });

    expect(round.items).toHaveLength(1);
    expect(round.items[0]?.parameterId).toBe(PPV);

    const cr = await db!.query<{
      target_value: string;
      project_parameter_value_id: string;
      project_parameter_binding_id: string | null;
      parameter_spec_id: string | null;
      id: string;
    }>(
      `
      select id, target_value, project_parameter_value_id, project_parameter_binding_id, parameter_spec_id
      from parameter_change_requests
      where submission_round_id = $1
      `,
      [round.id]
    );
    expect(cr.rows).toHaveLength(1);
    expect(cr.rows[0]?.project_parameter_value_id).toBe(PPV);
    expect(cr.rows[0]?.project_parameter_binding_id).toBe(bindingId);
    expect(cr.rows[0]?.parameter_spec_id).toBe(specId);
    // Fidelity: CR payload must be rawText, not normalized lowercase form.
    expect(cr.rows[0]?.target_value).toBe(RAW_HEX);
    expect(cr.rows[0]?.target_value).not.toBe(NORMALIZED_HEX);

    const draft = await db!.query<{ origin: string; target_value: string }>(
      `
      select origin, target_value from parameter_drafts
      where project_parameter_value_id = $1 and user_id = $2
      `,
      [PPV, USER]
    );
    // Draft is consumed by submit; either gone or was created with rawText first.
    expect(draft.rowCount).toBe(0);

    const audit = await db!.query<{ kind: string }>(
      `
      select kind from audit_events
      where organization_id = $1 and project_id = $2
        and kind in ('parameter-submit', 'parameter-structured-edit-submit')
      order by created_at desc
      `,
      [ORG, PROJECT]
    );
    expect(audit.rows.map((r) => r.kind)).toEqual(
      expect.arrayContaining(["parameter-submit", "parameter-structured-edit-submit"])
    );
  });

  it("creates PPV when source binding is missing and maps the new row (no unmapped)", async () => {
    const objectStore = createMemoryObjectStore();
    const auth = makeAuth();
    const fileName = `p31-create-${randomUUID()}.dts`;
    const dts = `/ {
	demo_integer {
		single_value = <42>;
	};
};
`;
    const uploaded = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: PROJECT,
      fileName,
      bytes: Buffer.from(dts, "utf8")
    });

    const round = await submitStructuredEdits(db!, auth, {
      projectId: PROJECT,
      edits: [
        {
          fileId: uploaded.file.id,
          nodePath: "demo_integer",
          propertyName: "single_value",
          rawText: "<99>",
          reason: "create-mapped structured edit"
        }
      ]
    });

    expect(round.items).toHaveLength(1);
    const parameterId = round.items[0]!.parameterId;

    const ppv = await db!.query<{
      source_file_name: string | null;
      source_node_path: string | null;
      current_value: string;
    }>(`select source_file_name, source_node_path, current_value from project_parameter_values where id = $1`, [
      parameterId
    ]);
    expect(ppv.rows[0]).toMatchObject({
      source_file_name: fileName,
      source_node_path: "demo_integer/single_value"
    });

    const cr = await db!.query<{ target_value: string }>(
      `select target_value from parameter_change_requests where project_parameter_value_id = $1`,
      [parameterId]
    );
    expect(cr.rows[0]?.target_value).toBe("<99>");
  });

  it("HTTP submit endpoint produces round+CR with rawText and merge writeback preserves rawText", async () => {
    const objectStore = createMemoryObjectStore();
    const auth = makeAuth();
    const server = makeServer(db!, objectStore, auth);
    const fileName = `p31-http-${randomUUID()}.dts`;
    const dts = `&amba {
	i2c@XXXX0000 {
		mixed_case_reg = /bits/ 8 <0xab 0xcd 0xef 0x12>;
	};
};
`;
    const uploaded = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: PROJECT,
      fileName,
      bytes: Buffer.from(dts, "utf8")
    });
    await db!.query(
      `update project_parameter_values set source_file_name = $1, source_node_path = $2 where id = $3`,
      [fileName, "amba/i2c@XXXX0000/mixed_case_reg", PPV]
    );

    const bindingId = `binding-http-${randomUUID().slice(0, 8)}`;
    const specId = `spec-http-${randomUUID().slice(0, 8)}`;
    await db!.query(
      `
      insert into parameter_specs (id, organization_id, source_kind, specification_key)
      values ($1, $2, 'dts', 'amba/mixed_case_reg')
      `,
      [specId, ORG]
    );
    await db!.query(
      `
      insert into project_parameter_bindings (id, organization_id, project_id, logical_node_id, parameter_spec_id)
      values ($1, $2, $3, null, $4)
      `,
      [bindingId, ORG, PROJECT, specId]
    );

    // Persist binding on a pre-submit draft so HTTP structured-edit submit propagates semantic FKs.
    await db!.query(
      `
      insert into parameter_drafts (
        id, organization_id, project_id, project_parameter_value_id, user_id,
        target_value, reason, origin, project_parameter_binding_id
      ) values ($1, $2, $3, $4, $5, $6, 'prebind', 'manual', $7)
      on conflict (project_id, project_parameter_value_id, user_id) do update set
        project_parameter_binding_id = excluded.project_parameter_binding_id,
        target_value = excluded.target_value
      `,
      [randomUUID(), ORG, PROJECT, PPV, USER, RAW_HEX, bindingId]
    );

    const submitResponse = await requestJson<{
      item: { id: string; items: Array<{ parameterId: string; targetValue: string }> };
    }>(server, `/api/v1/projects/${PROJECT}/dts-structured-edits/submit`, {
      method: "POST",
      body: JSON.stringify({
        edits: [
          {
            fileId: uploaded.file.id,
            nodePath: "amba/i2c@XXXX0000",
            propertyName: "mixed_case_reg",
            rawText: RAW_HEX,
            reason: "http structured submit",
            projectParameterBindingId: bindingId,
            parameterSpecId: specId
          }
        ],
        reason: "P3.1 http fidelity"
      })
    });
    expect(submitResponse.status).toBe(201);
    expect(submitResponse.body.item.items[0]?.parameterId).toBe(PPV);
    expect(submitResponse.body.item.items[0]?.targetValue).toBe(RAW_HEX);

    const requestRow = await db!.query<{
      id: string;
      status: string;
      target_value: string;
      project_parameter_binding_id: string | null;
      parameter_spec_id: string | null;
    }>(
      `
      select id, status, target_value, project_parameter_binding_id, parameter_spec_id
      from parameter_change_requests
      where project_parameter_value_id = $1
      order by created_at desc
      limit 1
      `,
      [PPV]
    );
    expect(requestRow.rows[0]?.target_value).toBe(RAW_HEX);
    expect(requestRow.rows[0]?.project_parameter_binding_id).toBe(bindingId);
    expect(requestRow.rows[0]?.parameter_spec_id).toBe(specId);

    let status = requestRow.rows[0]?.status ?? "";
    const requestId = requestRow.rows[0]!.id;
    while (status !== "merged") {
      status = await advanceReview(server, requestId);
    }

    const history = await db!.query<{
      project_parameter_binding_id: string | null;
      parameter_spec_id: string | null;
    }>(
      `
      select project_parameter_binding_id, parameter_spec_id
      from parameter_history_entries
      where request_id = $1
      `,
      [requestId]
    );
    expect(history.rows[0]?.project_parameter_binding_id).toBe(bindingId);
    expect(history.rows[0]?.parameter_spec_id).toBe(specId);

    const versions = await db!.query<{ version_number: number; origin: string; storage_key: string }>(
      `
      select v.version_number, v.origin, v.storage_key
      from project_parameter_file_versions v
      join project_parameter_files f on f.id = v.file_id
      where f.file_name = $1
      order by v.version_number asc
      `,
      [fileName]
    );
    expect(versions.rows.length).toBeGreaterThanOrEqual(2);
    const writeback = versions.rows.find((v) => v.origin === "writeback");
    expect(writeback).toBeTruthy();
    const written = (await objectStore.get(writeback!.storage_key)).toString("utf8");
    // Non-normalized rewrite evidence: uppercase hex from rawText must appear.
    expect(written).toContain("mixed_case_reg = /bits/ 8 <0xAB 0xCD 0xEF 0x12>;");
    expect(written).not.toContain("mixed_case_reg = /bits/ 8 <0xab 0xcd 0xef 0x12>;");
  });

  it("rejects critical sensitive node submit without parameter:edit-critical", async () => {
    const objectStore = createMemoryObjectStore();
    const auth = makeAuth({
      permissions: ["parameter:view", "parameter:edit", "parameter:review"]
    });
    const fileName = `p31-rbac-${randomUUID()}.dts`;
    const dts = `&amba {
	i2c@XXXX0000 {
		mixed_case_reg = /bits/ 8 <0xab 0xcd 0xef 0x12>;
	};
};
`;
    const uploaded = await uploadProjectParameterFile(db!, objectStore, makeAuth(), {
      projectId: PROJECT,
      fileName,
      bytes: Buffer.from(dts, "utf8")
    });
    await db!.query(
      `update project_parameter_values set source_file_name = $1, source_node_path = $2 where id = $3`,
      [fileName, "amba/i2c@XXXX0000/mixed_case_reg", PPV]
    );
    await db!.query(
      `
      insert into dts_sensitive_node_rules (
        id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
      ) values (
        $1, $2, $3, 'path', 'amba/*', 'critical', 'parameter:edit-critical', true
      )
      `,
      [randomUUID(), ORG, PROJECT]
    );

    await expect(
      submitStructuredEdits(db!, auth, {
        projectId: PROJECT,
        edits: [
          {
            fileId: uploaded.file.id,
            nodePath: "amba/i2c@XXXX0000",
            propertyName: "mixed_case_reg",
            rawText: RAW_HEX,
            reason: "rbac deny"
          }
        ]
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });

  it("rejects agent actor on critical sensitive nodes", async () => {
    const objectStore = createMemoryObjectStore();
    const auth = makeAuth();
    const fileName = `p31-agent-${randomUUID()}.dts`;
    const dts = `&amba {
	i2c@XXXX0000 {
		mixed_case_reg = /bits/ 8 <0xab 0xcd 0xef 0x12>;
	};
};
`;
    const uploaded = await uploadProjectParameterFile(db!, objectStore, auth, {
      projectId: PROJECT,
      fileName,
      bytes: Buffer.from(dts, "utf8")
    });
    await db!.query(
      `update project_parameter_values set source_file_name = $1, source_node_path = $2 where id = $3`,
      [fileName, "amba/i2c@XXXX0000/mixed_case_reg", PPV]
    );
    await db!.query(
      `
      insert into dts_sensitive_node_rules (
        id, organization_id, project_id, match_type, pattern, risk_tier, required_capability, enabled
      ) values (
        $1, $2, $3, 'path', 'amba/*', 'critical', 'parameter:edit-critical', true
      )
      `,
      [randomUUID(), ORG, PROJECT]
    );

    await expect(
      submitStructuredEdits(
        db!,
        auth,
        {
          projectId: PROJECT,
          edits: [
            {
              fileId: uploaded.file.id,
              nodePath: "amba/i2c@XXXX0000",
              propertyName: "mixed_case_reg",
              rawText: RAW_HEX,
              reason: "agent critical deny"
            }
          ]
        },
        { actorType: "agent" }
      )
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403
    });
  });
});
