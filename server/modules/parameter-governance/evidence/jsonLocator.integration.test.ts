import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import { createEphemeralTestDatabase } from "../../../testing/testDatabase";
import { makeTestAuthContext } from "../../../testing/authContext";
import { installConfigurationSourceFixture } from "../../../testing/parameterCatalog/configurationSource";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { CatalogReleaseId } from "../../parameter-catalog-contract";
import { loadPublishedCatalog } from "../../parameter-bindings/catalogProjectValueSync";
import { createEvidenceIngest, fingerprintCanonical } from "./index";
import type { IngestEvidenceCommand } from "./types";

it("accepts canonical JSON locators and rejects forged digests through the governance writer", async () => {
  const database = await createEphemeralTestDatabase("jsonlocator");
  const db = createPostgresDatabase(database.url);
  const writer = new pg.Pool({ connectionString: database.url, max: 1, options: "-c role=parameter_governance_writer_role" });
  try {
    await db.query("insert into organizations(id,name) values ('json-org','JSON')");
    await db.query("insert into users(id,organization_id,name,title,is_active) values ('json-user','json-org','JSON','Admin',true)");
    await db.query("insert into projects(id,organization_id,name,code) values ('json-project','json-org','JSON','JSON')");
    const auth = makeTestAuthContext({ userId: "json-user", organizationId: "json-org", permissions: ["parameter:view", "parameter:edit", "admin:access"] });
    await installConfigurationSourceFixture(db, auth, { subjectId: "json-subject", schemaId: "json-locator" });
    const pool = getRootPostgresPool(db);
    if (!pool) throw new Error("JSON locator test requires native PostgreSQL");
    const catalog = await loadPublishedCatalog(pool);
    if (!catalog) throw new Error("JSON fixture has no published Catalog");
    await db.query("insert into dts_config_set(id,organization_id,project_id,name) values ('json-set','json-org','json-project','JSON')");
    await db.query(`insert into project_parameter_files(id,organization_id,project_id,file_name,format,config_set_id,config_set_role)
      values ('json-file','json-org','json-project','settings.json','json','json-set','base')`);
    await db.query(`insert into project_parameter_file_versions(id,file_id,version_number,storage_key,checksum,size_bytes,origin)
      values ('json-version','json-file',1,'json-source','json-checksum',2,'upload')`);
    await db.query(`insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status)
      values ('json-revision','json-org','json-project','json-set',1,'resolved')`);
    await db.query(`insert into dts_config_revision_members(id,config_revision_id,file_id,file_version_id,role,sort_order)
      values ('json-member','json-revision','json-file','json-version','base',0)`);
    await db.query(`insert into parameter_catalog.project_parameter_source_occurrences
      (id,organization_id,project_id,config_set_id,file_id,occurrence_kind,configuration_instance_id,configuration_schema_subject_id,root_pointer,root_pointer_digest)
      values ('json-root','json-org','json-project','json-set','json-file','json','json-instance','json-subject','',$1)`,
    [`sha256:${createHash("sha256").update("").digest("hex")}`]);

    const ingest = createEvidenceIngest(writer);
    for (const pointer of ["", "/a~1b/~0/", '/温度/"\\é']) {
      const locator = { kind: "json-pointer", fileVersionId: "json-version", pointer };
      const command: IngestEvidenceCommand = {
        organizationId: "json-org", sourceIdentity: randomUUID(), catalogReleaseId: CatalogReleaseId(catalog.release.id),
        matcherRevision: "json-matcher", matcherOutput: { status: "matched" },
        provenance: { projectId: "json-project", logicalNodeId: null, configRevisionId: "json-revision", sourceOccurrenceId: "json-root", sourceLocator: locator },
      };
      const accepted = await ingest.ingest(command);
      if (!accepted.ok) throw new Error(JSON.stringify(accepted.error));
      expect(await ingest.ingest(command)).toMatchObject({ ok: true, value: { id: accepted.value.id, status: "replayed" } });
      const client = await writer.connect();
      try {
        await client.query("begin");
        await client.query(`insert into parameter_catalog.parameter_observations
          (id,organization_id,project_id,config_revision_id,source_identity,source_locator,catalog_release_id,
           matcher_revision,evidence_fingerprint,source_occurrence_id,parameter_locator_digest)
          values ($1,'json-org','json-project','json-revision',$2,$3::jsonb,$4,'json-matcher',$5,'json-root',$6)`,
        [randomUUID(),randomUUID(),JSON.stringify(locator),catalog.release.id,fingerprintCanonical(locator),`sha256:${"f".repeat(64)}`]);
        await expect(client.query("set constraints all immediate")).rejects.toMatchObject({ code: "23503", constraint: "parameter_observation_source_owner_fk" });
      } finally {
        await client.query("rollback");
        client.release();
      }
    }
  } finally {
    await writer.end();
    await db.close();
    await database.drop();
  }
}, 60_000);
