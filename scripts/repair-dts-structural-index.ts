import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";
import { parseDts, resolveDts } from "../server/modules/dts";
import { replaceDtsStructuralModel } from "../server/modules/parameter-files/structuralRepository";
import { createSystemInvocation } from "../server/modules/auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx } from "../server/modules/audit/auditedWrite";

type RepairInput = {
  projectId: string;
  fileName: string;
  versionId: string;
  checksum: string;
  nodePath: string;
  apply?: boolean;
};

/** Maintenance-only: reconstruct an absent index from one verified, immutable writeback. */
export async function repairDtsStructuralIndex(db: Database, input: RepairInput) {
  const nodePath = input.nodePath.startsWith("/") ? input.nodePath.slice(1) : input.nodePath;
  if (![input.projectId, input.fileName, input.versionId].every(value => value.trim()) ||
      !/^[a-f0-9]{64}$/.test(input.checksum) ||
      (input.nodePath !== "/" && nodePath.split("/").some(part => !part || part === "." || part === ".."))) {
    throw new Error("dts-index-repair-invalid-input");
  }
  return db.transaction(async tx => {
    await tx.query(input.apply
      ? "set transaction isolation level read committed"
      : "set transaction isolation level repeatable read, read only");
    await tx.query("set local lock_timeout = '5s'");
    await tx.query("set local statement_timeout = '30s'");
    const result = await tx.query<{
      organization_id: string; format: string; origin: string;
      checksum: string; size_bytes: string; source_text: unknown;
    }>(`
      select f.organization_id, f.format, v.origin, v.checksum, v.size_bytes,
        v.parsed_index -> 'sourceText' as source_text
      from project_parameter_file_versions v
      join project_parameter_files f on f.id = v.file_id
      where v.id = $1 and f.project_id = $2 and f.file_name = $3
      ${input.apply ? "for update of v" : ""}`,
    [input.versionId, input.projectId, input.fileName]);
    const version = result.rows[0];
    if (!version || version.format !== "dts" || version.origin !== "writeback") {
      throw new Error("dts-index-repair-source-scope-mismatch");
    }
    const source = version.source_text;
    if (typeof source !== "string" || Buffer.byteLength(source, "utf8") !== Number(version.size_bytes) ||
        version.checksum !== input.checksum || createHash("sha256").update(source).digest("hex") !== input.checksum) {
      throw new Error("dts-index-repair-source-integrity-mismatch");
    }
    const doc = parseDts(source);
    // Single-file recovery does not infer external include/overlay or deletion semantics.
    const pending = [...doc.topLevel];
    if (doc.directives.some(directive => directive.unsupported)) throw new Error("dts-index-repair-unsupported-source");
    while (pending.length) {
      for (const child of pending.pop()!.children) {
        if (child.kind === "node") pending.push(child);
        else if (child.kind !== "property") throw new Error("dts-index-repair-unsupported-source");
      }
    }
    const resolved = resolveDts(doc);
    if (!resolved.nodes.length || resolved.nodes.filter(node => node.nodePath === nodePath || node.nodePath === `/${nodePath}`).length !== 1) {
      throw new Error("dts-index-repair-target-identity-mismatch");
    }
    // Separate statement AFTER the lock: a waiting repair must see the first repair's commit.
    const existing = await tx.query<{ count: number }>(
      "select count(*)::int as count from dts_nodes where file_version_id = $1", [input.versionId]);
    const report = {
      projectId: input.projectId, fileName: input.fileName, versionId: input.versionId,
      checksum: input.checksum, existingNodes: existing.rows[0].count, parsedNodes: resolved.nodes.length,
    };
    if (report.existingNodes > 0) return { ...report, status: "skipped-existing-index" };
    if (!input.apply) return { ...report, status: "ready-dry-run" };
    const counts = await replaceDtsStructuralModel(tx, input.versionId, resolved, source);
    const traceId = randomUUID();
    await writeTrustedAuditEventInTx(asAuditTx(tx), {
      invocation: createSystemInvocation({ kind: "job", name: "repair-dts-structural-index" }),
      organizationId: version.organization_id, projectId: input.projectId,
      app: "parameters", kind: "dts-structural-index-repaired", action: "rebuild-index",
      severity: "Medium", targetType: "parameter-file-version", targetId: input.versionId,
      metadata: { checksum: input.checksum, ...counts }, traceId,
    });
    return { ...report, status: "repaired", counts, traceId };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [projectId, fileName, versionId, checksum, nodePath, mode, ...extra] = process.argv.slice(2);
  if (!process.env.DATABASE_URL || !projectId || !fileName || !versionId || !checksum || !nodePath ||
      (mode !== undefined && mode !== "--apply") || extra.length) {
    console.error("Usage: repair-dts-structural-index.ts PROJECT FILE VERSION SHA256 NODE_PATH [--apply] (DATABASE_URL required)");
    process.exitCode = 2;
  } else {
    const db = createPostgresDatabase(process.env.DATABASE_URL);
    try {
      console.log(JSON.stringify(await repairDtsStructuralIndex(db, { projectId, fileName, versionId, checksum, nodePath, apply: mode === "--apply" })));
    } catch (error) {
      console.error(error instanceof Error && error.message.startsWith("dts-index-repair-") ? error.message : "dts-index-repair-failed");
      process.exitCode = 1;
    } finally { await db.close(); }
  }
}
