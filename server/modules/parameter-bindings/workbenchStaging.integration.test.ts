import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations, migrationsDir, adminConnectionString } from "../../testing/tempDatabase";
import { installDriverSourceFixture } from "../../testing/parameterCatalog/driverSource";
import { makeTestAuthContext } from "../../testing/authContext";
import { requestJson } from "../../test/testClient";
import { createLocalObjectStore } from "../logs/objectStore";
import { createConfigSet, addConfigSetFile } from "../parameter-files/configSetService";
import type { ProjectParameterBinding } from "../../../src/domain/parameter-topology/types";

it.each([false, true])("assembled workbench API preserves exact source identity and pending staging (label override: %s)", async (labelOverride) => {
  const databaseName = `t1062_http_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: adminConnectionString() });
  await admin.connect();
  await admin.query(`create database "${databaseName}"`);
  const db = createPostgresDatabase(adminConnectionString(databaseName));
  const root = await mkdtemp(join(tmpdir(), "t1062-http-"));
  const auth = makeTestAuthContext({ userId: "t1062-user", organizationId: "t1062-org",
    permissions: ["parameter:view", "parameter:edit", "admin:access"] });
  try {
    await applyMigrations(db, migrationsDir);
    await db.query("insert into organizations(id,name) values ('t1062-org','Workbench')");
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('t1062-user','t1062-org','Editor','Admin',true)");
    await db.query("insert into projects(id,organization_id,name,code,status) values ('t1062-project','t1062-org','Workbench','T1062','initialized')");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('t1062-admin','t1062-user','t1062-org','admin')");
    await installDriverSourceFixture(db, auth, { subjectId: "csub_acme_power", compatible: "acme,power",
      businessName: "Power", driverName: "Acme", idempotencyKey: "t1062-registration", reason: "Workbench fixture" });
    const config = await createConfigSet(db, auth, { projectId: "t1062-project", name: "default" });
    const server = createWiseEffServer({ db, objectStore: createLocalObjectStore(root), auth: { mode: "development" } });
    const headers = { "x-wiseeff-user": "t1062-user" };
    const source = '/dts-v1/;\n/ { first: device@0 { compatible = "acme,power"; iin_max = <10>; }; second: device@1 { compatible = "acme,power"; iin_max = <20>; }; };\n'
      + (labelOverride ? '&first { iin_max = <30>; };\n' : "");
    const upload = async () => requestJson<{ item: { id: string } }>(server,
      "/api/v1/projects/t1062-project/parameter-files", { method: "POST", headers,
        body: JSON.stringify({ fileName: "workbench.dts", contentBase64: Buffer.from(source).toString("base64") }) });
    const file = await upload();
    expect(file.status).toBe(201);
    await addConfigSetFile(db, auth, { configSetId: config.id, fileId: file.body.item.id, role: "base", sortOrder: 0 });
    expect((await upload()).status).toBe(201);
    const list = () => requestJson<{ items: ProjectParameterBinding[] }>(server,
      "/api/v2/projects/t1062-project/parameter-bindings", { headers });
    const before = await list();
    expect(before.status).toBe(200);
    expect(before.body.items).toHaveLength(2);
    expect(before.body.items).toContainEqual(expect.objectContaining({ rawValue: labelOverride ? "<30>" : "<10>" }));
    expect(before.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceFileId: file.body.item.id, sourceNodePath: "device@0", sourceOccurrenceId: expect.any(String) }),
      expect.objectContaining({ sourceFileId: file.body.item.id, sourceNodePath: "device@1", sourceOccurrenceId: expect.any(String) })
    ]));
    const fileVersion = (await db.query<{ current_version_id: string }>("select current_version_id from project_parameter_files where id=$1", [file.body.item.id])).rows[0]!;
    const structure = await requestJson<{ nodes: Array<{ nodePath: string; properties: Array<{ name: string }> }> }>(server,
      `/api/v1/projects/t1062-project/parameter-files/${file.body.item.id}/versions/${fileVersion.current_version_id}/structure`, { headers });
    expect(structure.status).toBe(200);
    for (const item of before.body.items) {
      expect(structure.body.nodes).toContainEqual(expect.objectContaining({ nodePath: item.sourceNodePath,
        properties: expect.arrayContaining([expect.objectContaining({ name: item.propertyKey })]) }));
    }
    const binding = before.body.items.find((item) => item.sourceNodePath === "device@1")!;
    const revision = (await db.query<{ id: string }>("select id from dts_config_revisions where project_id='t1062-project' order by created_at desc limit 1")).rows[0]!;
    const staged = await requestJson<{ item: unknown }>(server,
      `/api/v2/projects/t1062-project/parameter-bindings/${binding.id}/drafts`, { method: "POST", headers,
        body: JSON.stringify({ baseRevisionId: revision.id, reason: "Stage second occurrence", action: "set",
          targetValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "21", value: "21" }]] } }) });
    expect(staged.status).toBe(201);
    expect(staged.body.item).toMatchObject({ draftId: expect.stringMatching(/^pvdr_/), pending: true,
      projectParameterBindingId: binding.id, currentValueId: binding.currentValueId,
      writeTarget: { role: "canonical-project-value-draft" } });
    expect((await list()).body.items).toEqual(before.body.items);
  } finally {
    await db.close();
    await admin.query(`drop database "${databaseName}"`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
