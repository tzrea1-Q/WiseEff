import pg from "pg";
import { expect, it } from "vitest";

import { applyMigrations, migrationsDir, withTempDatabase } from "../../../testing/tempDatabase";
import { sha256Digest } from "./integrationHarness";
import { catalogCompilerContractFingerprint, catalogCompilerOwnerContractFingerprint } from "../../catalog-kernel/compiler/contract";
import { getValidatedPreviewSnapshot } from "./store";

it("upgrades populated artifacts without losing any existing source kind", async () => {
  await withTempDatabase({ prefix: "md_source_upgrade", migrate: false }, async ({ db, connectionString }) => {
    await applyMigrations(db, migrationsDir, { through: "0316_configuration_source_file_version_lookup.sql" });
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      for (const [index, kind] of ["typed-changeset", "vendor-yaml", "repository-bundle", "adopted-preexisting"].entries()) {
        const digest = sha256Digest(`legacy-${index}`);
        await client.query(`insert into catalog_publication.release_artifacts
          (id, artifact_digest, bytes_checksum, artifact_bytes, source_kind, target_release_id, target_release_digest, toolchain)
          values ($1, $2, $3, $4, $5, $6, $2, '{}'::jsonb)`,
        [`cart_legacy_${index}`, digest, sha256Digest(`bytes-${index}`), Buffer.from(`bytes-${index}`), kind, `crel_legacy_${index}`]);
      }
      await applyMigrations(db, migrationsDir, { through: "0369_catalog_preview_selector_history.sql" });
      const oldValidator = ["catalog-subject-rename/v1", catalogCompilerContractFingerprint, catalogCompilerOwnerContractFingerprint].join("/");
      await client.query(`insert into catalog_publication.preview_snapshots
        (artifact_id, artifact_digest, validator_version, bytes_checksum, has_subject_rules, target_bytes, target_checksum)
        select id, artifact_digest, $1, bytes_checksum, false, artifact_bytes, bytes_checksum
        from catalog_publication.release_artifacts where id = 'cart_legacy_0'`, [oldValidator]);
      await applyMigrations(db, migrationsDir);
      expect((await db.query("select has_dts_examples from catalog_publication.preview_snapshots")).rows).toEqual([{ has_dts_examples: false }]);
      expect(await getValidatedPreviewSnapshot(db, sha256Digest("legacy-0"))).toEqual({ ok: false, error: { kind: "not-found", entity: "artifact" } });
      const rows = await client.query<{ source_kind: string }>(`select source_kind from catalog_publication.release_artifacts order by id`);
      expect(rows.rows.map((row) => row.source_kind)).toEqual(["typed-changeset", "vendor-yaml", "repository-bundle", "adopted-preexisting"]);
    } finally {
      await client.end();
    }
  });
}, 120_000);
