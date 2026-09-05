import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { Queryable } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { withTempDatabase } from "../../testing/tempDatabase";
import { resolveDtsNodeCompatible } from "./sensitiveNode";

const source = {
  organizationId: "identity-org-a",
  projectId: "identity-project-a",
  sourceFileName: "identity.dts",
  sourceFileVersionId: "identity-version-locked",
};
const mismatch = { code: "CONFLICT", details: { code: "parameter-sensitive-node-identity-mismatch" } };
const scopeMismatch = { code: "CONFLICT", details: { code: "parameter-sensitive-source-version-mismatch" } };

async function withSource(run: (db: Queryable) => Promise<void>) {
  await withTempDatabase({ prefix: "sensitiveidentity" }, async ({ db }) => {
    await seedCoreGraph(db, { organization: { id: source.organizationId }, projects: [{ id: source.projectId }] });
    await seedCoreGraph(db, { organization: { id: "identity-org-b" }, projects: [{ id: "identity-project-b" }] });
    await db.query(`insert into project_parameter_files (id, organization_id, project_id, file_name, format)
      values ('identity-file-a', $1, $2, $3, 'dts'),
             ('identity-file-b', 'identity-org-b', 'identity-project-b', $3, 'dts')`,
    [source.organizationId, source.projectId, source.sourceFileName]);
    await db.query(`insert into project_parameter_file_versions
      (id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin)
      values ($1, 'identity-file-a', 1, 'fixture/locked', 'fixture-locked', 1, '{}', 'upload'),
             ('identity-version-current', 'identity-file-a', 2, 'fixture/current', 'fixture-current', 1, '{}', 'upload'),
             ('identity-version-foreign', 'identity-file-b', 1, 'fixture/foreign', 'fixture-foreign', 1, '{}', 'upload')`,
    [source.sourceFileVersionId]);
    await db.query("update project_parameter_files set current_version_id = 'identity-version-current' where id = 'identity-file-a'");
    await run(db);
  });
}

async function node(db: Queryable, path: string, compatible: string | null, version = source.sourceFileVersionId) {
  // Persist both historical spellings directly in this disposable non-Catalog
  // DTS fixture. No schema alteration, Catalog materialization or audit mock.
  await db.query(`insert into dts_nodes (id, file_version_id, name, node_path, compatible)
    values ($1, $2, 'fixture-node', $3, $4)`, [randomUUID(), version, path, compatible]);
}

function resolve(db: Queryable, locator: string, overrides: Partial<typeof source> = {}) {
  return resolveDtsNodeCompatible(db, { ...source, ...overrides, sourcePath: { kind: "node-locator", value: locator } });
}

describe("R2 sensitive-node exact identity compatibility: real PostgreSQL resolver boundary", () => {
  it.each([
    ["soc/power", "soc/power"],
    ["soc/power", "/soc/power"],
    ["/soc/power", "soc/power"],
    ["/soc/power", "/soc/power"],
  ])("resolves persisted %s using locator %s without consulting current version", async (persisted, locator) => {
    await withSource(async (db) => {
      await node(db, persisted, "vendor,locked-oracle");
      await node(db, "soc/power", "vendor,current-must-not-win", "identity-version-current");
      await node(db, "/soc/power", "vendor,foreign-must-not-win", "identity-version-foreign");
      await expect(resolve(db, locator)).resolves.toBe("vendor,locked-oracle");
    });
  });

  it.each(["", "/"])("recognizes a single persisted root %j from the explicit root locator", async (persisted) => {
    await withSource(async (db) => {
      await node(db, persisted, "vendor,root-oracle");
      await expect(resolve(db, "/")).resolves.toBe("vendor,root-oracle");
      await expect(resolve(db, "")).rejects.toMatchObject(mismatch);
    });
  });

  it.each(["soc/power", "/soc/power"])("refuses both persisted spellings instead of selecting an arbitrary row for %s", async (locator) => {
    await withSource(async (db) => {
      await node(db, "soc/power", "vendor,relative");
      await node(db, "/soc/power", "vendor,absolute");
      await expect(resolve(db, locator)).rejects.toMatchObject(mismatch);
    });
  });

  it("refuses ambiguous root spellings even when their compatible values are identical", async () => {
    await withSource(async (db) => {
      await node(db, "", "vendor,same");
      await node(db, "/", "vendor,same");
      await expect(resolve(db, "/")).rejects.toMatchObject(mismatch);
    });
  });

  it("refuses duplicate physical rows with one exact spelling rather than hiding them with LIMIT 1", async () => {
    await withSource(async (db) => {
      await node(db, "soc/power", "vendor,same");
      await node(db, "soc/power", "vendor,same");
      await expect(resolve(db, "soc/power")).rejects.toMatchObject(mismatch);
    });
  });

  it("preserves exact nested identity and never inherits a parent or similarly named sibling", async () => {
    await withSource(async (db) => {
      await node(db, "/soc/left/power", "vendor,left");
      await node(db, "soc/right/power", "vendor,right");
      await node(db, "soc/left", "vendor,parent");
      await expect(resolve(db, "/soc/left/power")).resolves.toBe("vendor,left");
      await expect(resolve(db, "/soc/right/power")).resolves.toBe("vendor,right");
      await expect(resolve(db, "/soc/left/power/missing")).rejects.toMatchObject(mismatch);
      await expect(resolve(db, "/soc/missing/power")).rejects.toMatchObject(mismatch);
    });
  });

  it.each(["soc/power", "/soc/power"])("preserves a uniquely resolved NULL-compatible node stored as %s", async (persisted) => {
    await withSource(async (db) => {
      await node(db, persisted, null);
      await expect(resolve(db, "/soc/power")).resolves.toBeNull();
    });
  });

  it.each([
    { organizationId: "identity-org-b" },
    { projectId: "identity-project-b" },
    { sourceFileName: "different.dts" },
    { sourceFileVersionId: "identity-version-foreign" },
  ])("refuses substituted exact file scope %j", async (override) => {
    await withSource(async (db) => {
      await node(db, "soc/power", "vendor,locked");
      await node(db, "/soc/power", "vendor,foreign", "identity-version-foreign");
      await expect(resolve(db, "/soc/power", override)).rejects.toMatchObject(scopeMismatch);
    });
  });

  it("does not find a missing locked-version node in the mutable current version or another organization", async () => {
    await withSource(async (db) => {
      await node(db, "soc/power", "vendor,current", "identity-version-current");
      await node(db, "/soc/power", "vendor,foreign", "identity-version-foreign");
      await expect(resolve(db, "/soc/power")).rejects.toMatchObject(mismatch);
    });
  });

  it.each(["//soc/power", "/soc//power", "/soc/power/", "/soc/./power", "/soc/../power"])(
    "refuses malformed locator %s even if a malformed historical row happens to exist", async (locator) => {
      await withSource(async (db) => {
        await node(db, locator, "vendor,must-not-be-authorized");
        await expect(resolve(db, locator)).rejects.toMatchObject(mismatch);
      });
    }
  );
});
