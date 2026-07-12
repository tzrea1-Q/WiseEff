import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase } from "../../testing/testDatabase";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { registerParameterFileRoutes } from "./routes";

function makeAuth(): AuthContext {
  return {
    user: {
      id: "user-pf-int",
      organizationId: "org-pf-int",
      name: "Riley Chen",
      email: "riley-pf-int@example.com",
      title: "Admin",
      isActive: true
    },
    organization: { id: "org-pf-int", name: "ChargeLab PF" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "admin:access"]
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
      if (!value) {
        throw new Error(`Missing object for storage key: ${storageKey}`);
      }
      return Buffer.from(value);
    }
  };
}

async function seedBaseline(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ('org-pf-int', 'ChargeLab PF')
     on conflict (id) do update set name = excluded.name`
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ('user-pf-int', 'org-pf-int', 'Riley Chen', 'riley-pf-int@example.com', 'Admin', true)
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      name = excluded.name,
      email = excluded.email,
      title = excluded.title,
      is_active = excluded.is_active
    `
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ('project-pf-int', 'org-pf-int', 'Aurora', 'AUR', 'initialized')
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      name = excluded.name,
      code = excluded.code,
      status = excluded.status
    `
  );
  await db.query(
    `
    insert into parameter_definitions (
      id, organization_id, name, description, explanation, config_format,
      module, default_range, unit, risk
    )
    values (
      'pd-pf-int', 'org-pf-int', 'temp_max', 'max temperature', 'battery max temperature',
      'ENV:TEMP_MAX=number', 'battery', '0-120', 'C', 'High'
    )
    on conflict (id) do update set
      organization_id = excluded.organization_id,
      name = excluded.name,
      module = excluded.module
    `
  );
  await db.query(
    `
    insert into project_parameter_values (
      id, organization_id, project_id, parameter_definition_id,
      current_value, recommended_value, value_version, updated_by_user_id
    )
    values (
      'ppv-pf-int', 'org-pf-int', 'project-pf-int', 'pd-pf-int',
      '80', '80', 1, 'user-pf-int'
    )
    on conflict (id) do update set
      current_value = excluded.current_value,
      recommended_value = excluded.recommended_value,
      value_version = excluded.value_version
    `
  );
}

describe("parameter file integration", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedBaseline(db);
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("upload + sync creates file_sync draft for battery/temp_max: 80 -> 85", async () => {
    const router = createRouter();
    registerParameterFileRoutes(router, {
      db,
      objectStore: createMemoryObjectStore(),
      getCurrentAuthContext: () => makeAuth()
    });
    const server = createHttpServer(router);
    const bytes = Buffer.from('{"battery":{"temp_max":85}}', "utf8");

    const uploadResponse = await requestJson<{
      item: { id: string };
      version: { id: string; versionNumber: number };
    }>(server, "/api/v1/projects/project-pf-int/parameter-files", {
      method: "POST",
      body: JSON.stringify({
        fileName: "config.json",
        contentBase64: bytes.toString("base64")
      })
    });

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.version.versionNumber).toBe(1);

    const syncResponse = await requestJson<{
      item: { draftsCreated: number; unchanged: number; unmatched: number; skipped: boolean };
    }>(server, `/api/v1/projects/project-pf-int/parameter-files/${uploadResponse.body.item.id}/sync`, {
      method: "POST",
      body: JSON.stringify({ versionId: uploadResponse.body.version.id })
    });

    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body.item).toEqual({
      draftsCreated: 1,
      unchanged: 0,
      unmatched: 0,
      skipped: false
    });

    const drafts = await db.query<{
      id: string;
      target_value: string;
      reason: string;
      origin: "manual" | "file_sync";
      origin_file_version_id: string | null;
    }>(
      `
      select id, target_value, reason, origin, origin_file_version_id
      from parameter_drafts
      where organization_id = $1
        and project_id = $2
        and project_parameter_value_id = $3
      `,
      ["org-pf-int", "project-pf-int", "ppv-pf-int"]
    );
    expect(drafts.rowCount).toBe(1);
    expect(drafts.rows[0]).toEqual(
      expect.objectContaining({
        id: "ppv-pf-int-user-pf-int-file-sync",
        target_value: "85",
        origin: "file_sync",
        origin_file_version_id: uploadResponse.body.version.id
      })
    );
    expect(drafts.rows[0].reason).toContain("Synced from config.json:battery/temp_max");

    const parameter = await db.query<{
      current_value: string;
      source_file_name: string | null;
      source_node_path: string | null;
    }>(
      `
      select current_value, source_file_name, source_node_path
      from project_parameter_values
      where id = 'ppv-pf-int'
      `
    );
    expect(parameter.rows[0]).toEqual({
      current_value: "80",
      source_file_name: "config.json",
      source_node_path: "battery/temp_max"
    });
  });
});
