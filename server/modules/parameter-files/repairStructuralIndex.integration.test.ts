import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { repairDtsStructuralIndex } from "../../../scripts/repair-dts-structural-index";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { withTempDatabase } from "../../testing/tempDatabase";
import { resolveDtsNodeCompatible } from "../parameter-kernel/sensitiveNode";

it("repairs only a verified absent writeback index, atomically and safely on retry", async () => {
  await withTempDatabase({ prefix: "dtsindexrepair" }, async ({ db, connectionString }) => {
    const source = readFileSync(new URL("../../../src/config/dts-seed/aurora-board.dts", import.meta.url), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const input = { projectId: "repair-project", fileName: "aurora-board.dts", versionId: "repair-version", checksum,
      nodePath: "/amba/i2c@FF24E000/mt5788@2B" };
    await seedCoreGraph(db, { organization: { id: "repair-org" }, projects: [{ id: input.projectId }] });
    await db.query(`insert into project_parameter_files (id, organization_id, project_id, file_name, format)
      values ('repair-file', 'repair-org', $1, $2, 'dts')`, [input.projectId, input.fileName]);
    await db.query(`insert into project_parameter_file_versions
      (id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin)
      values ($1, 'repair-file', 3, 'fixture/locked', $2, $3, $4::jsonb, 'writeback')`,
    [input.versionId, checksum, Buffer.byteLength(source), JSON.stringify({ sourceText: source })]);
    const snapshot = async () => (await db.query(`select row_to_json(f) as file, row_to_json(v) as version
      from project_parameter_files f join project_parameter_file_versions v on v.file_id = f.id where v.id = $1`, [input.versionId])).rows;
    const original = await snapshot();
    const nodeCount = async () => Number((await db.query<{ count: string }>(
      "select count(*) from dts_nodes where file_version_id = $1", [input.versionId])).rows[0].count);
    const guarded = () => resolveDtsNodeCompatible(db, {
      organizationId: "repair-org", projectId: input.projectId, sourceFileName: input.fileName,
      sourceFileVersionId: input.versionId, sourcePath: { kind: "node-locator", value: input.nodePath },
    });
    await expect(guarded()).rejects.toMatchObject({ code: "CONFLICT", details: { code: "parameter-sensitive-node-identity-mismatch" } });
    expect(await repairDtsStructuralIndex(db, input)).toMatchObject({ status: "ready-dry-run", parsedNodes: 50, existingNodes: 0 });
    expect(await nodeCount()).toBe(0);

    for (const override of [{ projectId: "foreign-project" }, { fileName: "different.dts" }, { versionId: "missing" },
      { checksum: "0".repeat(64) }, { nodePath: "/other/mt5788@2B" }, { nodePath: "/amba/../mt5788@2B" }]) {
      await expect(repairDtsStructuralIndex(db, { ...input, ...override, apply: true })).rejects.toThrow("dts-index-repair-");
      expect(await nodeCount()).toBe(0);
    }
    await db.query("update project_parameter_file_versions set size_bytes = size_bytes + 1 where id = $1", [input.versionId]);
    await expect(repairDtsStructuralIndex(db, { ...input, apply: true })).rejects.toThrow("source-integrity-mismatch");
    for (const invalidSource of ["", "/dts-v1/; /include/ \"missing.dtsi\"", "/ { /delete-node/ old; };", "/ { invalid"]) {
      const hash = createHash("sha256").update(invalidSource).digest("hex");
      await db.query("update project_parameter_file_versions set checksum = $2, size_bytes = $3, parsed_index = $4::jsonb where id = $1",
        [input.versionId, hash, Buffer.byteLength(invalidSource), JSON.stringify({ sourceText: invalidSource })]);
      await expect(repairDtsStructuralIndex(db, { ...input, checksum: hash, apply: true })).rejects.toThrow();
      expect(await nodeCount()).toBe(0);
    }
    await db.query("update project_parameter_file_versions set checksum = $2, size_bytes = $3, parsed_index = $4::jsonb where id = $1",
      [input.versionId, checksum, Buffer.byteLength(source), JSON.stringify({ sourceText: source })]);
    await db.query(`create function fail_repair_audit() returns trigger language plpgsql as $$
      begin raise exception 'repair audit failure'; end $$;
      create trigger reject_repair_audit before insert on audit_events for each row execute function fail_repair_audit()`);
    await expect(repairDtsStructuralIndex(db, { ...input, apply: true })).rejects.toThrow("repair audit failure");
    expect(await nodeCount()).toBe(0);
    expect(await snapshot()).toEqual(original);
    await db.query("drop trigger reject_repair_audit on audit_events");

    const pool = createPostgresDatabase(connectionString);
    try {
      const reports = await Promise.all([
        repairDtsStructuralIndex(pool, { ...input, apply: true }),
        repairDtsStructuralIndex(pool, { ...input, apply: true }),
      ]);
      expect(reports.map(report => report.status).sort()).toEqual(["repaired", "skipped-existing-index"]);
    } finally { await pool.close(); }
    expect(await nodeCount()).toBe(50);
    await expect(guarded()).resolves.toBe("mt,mt5788");
    expect(await snapshot()).toEqual(original);
    const audit = await db.query<{ actor_type: string; actor_user_id: string | null; metadata: Record<string, unknown> }>(
      "select actor_type, actor_user_id, metadata from audit_events where kind = 'dts-structural-index-repaired'");
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_type: "system", actor_user_id: null,
      metadata: { checksum, nodes: 50, systemName: "repair-dts-structural-index" } });

    // Even a partial/ambiguous existing index is never replaced or reported repaired.
    await db.query("delete from dts_phandle_refs");
    await db.query("delete from dts_nodes where file_version_id = $1", [input.versionId]);
    await db.query("insert into dts_nodes (id, file_version_id, name, node_path) values ('partial', $1, 'other', 'other')", [input.versionId]);
    expect(await repairDtsStructuralIndex(db, { ...input, apply: true })).toMatchObject({ status: "skipped-existing-index", existingNodes: 1 });
    expect(await nodeCount()).toBe(1);
    await expect(guarded()).rejects.toMatchObject({ code: "CONFLICT" });
  });
}, 120_000);
