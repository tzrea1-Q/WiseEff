import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { ingestDtsFileVersion } from "./structuralIngest";
import { searchDtsStructuralModel } from "./dtsSearchRepository";
import { searchProjectDts } from "./dtsSearchService";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "dts-teaching-sample.dts");
const sample = readFileSync(fixturePath, "utf8");

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("searchDtsStructuralModel", () => {
  let db: InMemoryTestDatabase | undefined;
  let versionId: string;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    versionId = randomUUID();

    await db.query(
      `insert into organizations (id, name) values ('org-dts-search', 'DtsSearch')
       on conflict (id) do update set name = excluded.name`,
    );
    await db.query(
      `insert into projects (id, organization_id, name, code, status)
       values ('proj-dts-search', 'org-dts-search', 'P', 'P', 'initialized')
       on conflict (id) do update set name = excluded.name`,
    );
    await db.query(
      `insert into project_parameter_files (id, organization_id, project_id, file_name, format, enabled)
       values ('file-dts-search', 'org-dts-search', 'proj-dts-search', 'teaching-sample.dts', 'dts', true)`,
    );
    await db.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
       ) values ($1, 'file-dts-search', 1, 'k', 'c', 1, '{}'::jsonb, 'upload')`,
      [versionId],
    );
    await db.query(
      `update project_parameter_files set current_version_id = $1 where id = 'file-dts-search'`,
      [versionId],
    );

    await ingestDtsFileVersion(db, versionId, sample);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("hits path / address / label / compatible / value for the teaching fixture via current_version_id", async () => {
    const byPath = await searchDtsStructuralModel(db!, {
      organizationId: "org-dts-search",
      projectId: "proj-dts-search",
      q: "chip@6E",
      by: "path",
    });
    expect(byPath.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileId: "file-dts-search",
          fileName: "teaching-sample.dts",
          versionId,
          nodePath: "amba/i2c@XXXX0000/chip@6E",
        }),
      ]),
    );

    const byAddress = await searchDtsStructuralModel(db!, {
      organizationId: "org-dts-search",
      projectId: "proj-dts-search",
      q: "6E",
      by: "address",
    });
    expect(byAddress.hits.some((hit) => hit.nodePath === "amba/i2c@XXXX0000/chip@6E")).toBe(true);

    const byCompatible = await searchDtsStructuralModel(db!, {
      organizationId: "org-dts-search",
      projectId: "proj-dts-search",
      q: "vendor,chip123",
      by: "compatible",
    });
    expect(byCompatible.hits.some((hit) => hit.nodePath === "amba/i2c@XXXX0000/chip@6E")).toBe(true);

    const byLabel = await searchDtsStructuralModel(db!, {
      organizationId: "org-dts-search",
      projectId: "proj-dts-search",
      q: "demo_bool",
      by: "label",
    });
    expect(byLabel.hits.some((hit) => hit.nodePath === "demo_bool")).toBe(true);

    const byValue = await searchDtsStructuralModel(db!, {
      organizationId: "org-dts-search",
      projectId: "proj-dts-search",
      q: "true",
      by: "value",
    });
    expect(byValue.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodePath: "demo_bool",
          propertyName: "weak_source_sleep_enabled",
          snippet: expect.any(String),
        }),
      ]),
    );

    const viaService = await searchProjectDts(db!, {
      organizationId: "org-dts-search",
      projectId: "proj-dts-search",
      q: "chip@6E",
      by: "path",
    });
    expect(viaService.hits).toEqual(byPath.hits);
  });

  it("isolates results by organization and only searches current_version_id", async () => {
    const otherVersionId = randomUUID();
    await db!.query(
      `insert into organizations (id, name) values ('org-other-search', 'Other')
       on conflict (id) do update set name = excluded.name`,
    );
    await db!.query(
      `insert into projects (id, organization_id, name, code, status)
       values ('proj-other-search', 'org-other-search', 'O', 'O', 'initialized')
       on conflict (id) do update set name = excluded.name`,
    );
    await db!.query(
      `insert into project_parameter_files (id, organization_id, project_id, file_name, format, enabled)
       values ('file-other-search', 'org-other-search', 'proj-other-search', 'other.dts', 'dts', true)`,
    );
    await db!.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
       ) values ($1, 'file-other-search', 1, 'k2', 'c2', 1, '{}'::jsonb, 'upload')`,
      [otherVersionId],
    );
    await db!.query(
      `update project_parameter_files set current_version_id = $1 where id = 'file-other-search'`,
      [otherVersionId],
    );
    await ingestDtsFileVersion(db!, otherVersionId, sample);

    const staleVersionId = randomUUID();
    await db!.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin
       ) values ($1, 'file-dts-search', 2, 'k-stale', 'c-stale', 1, '{}'::jsonb, 'upload')`,
      [staleVersionId],
    );
    // Stale version has a uniquely named node only present there — must not appear in search.
    await ingestDtsFileVersion(
      db!,
      staleVersionId,
      `/dts-v1/;\n/ {\n\tstale_only_node@FF {\n\t\tcompatible = "stale,only";\n\t};\n};\n`,
    );

    const crossOrg = await searchDtsStructuralModel(db!, {
      organizationId: "org-dts-search",
      projectId: "proj-dts-search",
      q: "chip@6E",
      by: "path",
    });
    expect(crossOrg.hits.every((hit) => hit.fileId === "file-dts-search")).toBe(true);
    expect(crossOrg.hits.every((hit) => hit.versionId === versionId)).toBe(true);

    const staleHit = await searchDtsStructuralModel(db!, {
      organizationId: "org-dts-search",
      projectId: "proj-dts-search",
      q: "stale_only_node",
      by: "path",
    });
    expect(staleHit.hits).toEqual([]);
  });
});
