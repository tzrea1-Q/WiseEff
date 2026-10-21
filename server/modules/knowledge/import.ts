import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import type { z } from "zod";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { ObjectStore } from "../logs/objectStore";
import { AnalysisCaseArchiveError, analysisCaseArchiveLimits, readBoundedZipArchive } from "../logs/analysisCaseArchive";
import type { KnowledgeTextExtractor } from "./extraction";
import { canReadEntry, requireKnowledgeEdit } from "./policy";
import { importKnowledgeDocumentSchema, type importKnowledgeArchiveSchema } from "./schemas";
import { createKnowledgeEntry, type KnowledgeServiceContext } from "./service";

type BatchRow = { id: string; tags: string[]; document_count: number; total_bytes: string; completed_at: Date | null };
type ReadableEntryRow = { id: string; status: "draft" | "published" | "archived"; createdByUserId: string | null };
export type KnowledgeImportOutcome = {
  id: string; relativePath: string;
  status: "created" | "duplicate_skipped" | "unsupported_skipped" | "extraction_failed" | "rejected";
  entryId: string | null; error: string | null;
};

// The document seam also accepts a bounded archive reader's documents (#1330).
const contentTypes = new Map([
  ["pdf", "application/pdf"], ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["md", "text/markdown"], ["txt", "text/plain"]
]);

async function lockBatch(tx: Database, auth: AuthContext, id: string) {
  const result = await tx.query<BatchRow>(`select * from knowledge_import_batches
    where id = $1 and organization_id = $2 and created_by_user_id = $3 for update`,
  [id, auth.organization.id, auth.user.id]);
  if (!result.rows[0]) throw new ApiError("NOT_FOUND", "找不到导入批次。");
  return result.rows[0];
}

export async function openKnowledgeImport(db: Database, auth: AuthContext, tags: string[]) {
  requireKnowledgeEdit(auth);
  const id = randomUUID();
  await db.query(`insert into knowledge_import_batches (id, organization_id, created_by_user_id, tags)
    values ($1, $2, $3, $4)`, [id, auth.organization.id, auth.user.id, [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]]);
  return { id };
}

function requireBatchCapacity(batch: BatchRow, documentCount: number, totalBytes: number) {
  if (batch.completed_at) throw new ApiError("CONFLICT", "导入批次已完成。");
  if (batch.document_count + documentCount > 200) throw new ApiError("VALIDATION_FAILED", "每批最多导入 200 个文档。");
  if (Number(batch.total_bytes) + totalBytes > 100 * 1024 * 1024) {
    throw new ApiError("VALIDATION_FAILED", "每批文件总大小不能超过 100 MB。");
  }
}

export async function importKnowledgeArchive(
  db: Database, objectStore: ObjectStore, extractor: KnowledgeTextExtractor, auth: AuthContext,
  batchId: string, input: z.infer<typeof importKnowledgeArchiveSchema>, context: KnowledgeServiceContext = {}
): Promise<{ outcomes: KnowledgeImportOutcome[] }> {
  requireKnowledgeEdit(auth);
  const archiveBytes = Buffer.from(input.file.contentBase64, "base64");
  let members: Map<string, Buffer>;
  try {
    members = await readBoundedZipArchive(archiveBytes, {
      ...analysisCaseArchiveLimits, maxCompressedBytes: 100 * 1024 * 1024,
      maxUnpackedBytes: 100 * 1024 * 1024, maxFileBytes: 20 * 1024 * 1024
    });
  } catch (error) {
    if (error instanceof AnalysisCaseArchiveError) throw new ApiError("VALIDATION_FAILED", error.message);
    throw error;
  }
  // The bounded reader omits directories; inspect their metadata only after its preflight.
  const zip = await JSZip.loadAsync(archiveBytes);
  if (Object.values(zip.files).some((entry) => entry.name.replace(/\/$/, "").split("/").length > (entry.dir ? 20 : 21))) {
    throw new ApiError("VALIDATION_FAILED", "ZIP 文件夹最多嵌套 20 层。");
  }
  // Validate every member before persisting any, including paths the reader does not normalize.
  for (const path of members.keys()) {
    if (!importKnowledgeDocumentSchema.shape.relativePath.safeParse(path).success
      || !importKnowledgeDocumentSchema.shape.file.shape.fileName.safeParse(path.split("/").at(-1)).success) {
      throw new ApiError("VALIDATION_FAILED", "ZIP 文档路径无效。");
    }
  }
  // Keep the reader's bounded metadata allowance; OS junk does not consume batch document slots.
  const documents = [...members].filter(([path]) => !path.split("/").some((part) => part === "__MACOSX" || part === ".DS_Store"));
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, auth, batchId);
    // Keep the lock through all member imports so files and archives share one capacity check.
    requireBatchCapacity(batch, documents.length, documents.reduce((total, [, bytes]) => total + bytes.length, 0));
    // Acquire document duplicate locks in content order across batches, preserving report order.
    const ordered = documents.map(([relativePath, bytes], index) => ({ relativePath, bytes, index,
      checksum: createHash("sha256").update(bytes).digest("hex") })).sort((a, b) => a.checksum.localeCompare(b.checksum));
    const outcomes: KnowledgeImportOutcome[] = [];
    for (const { relativePath, bytes, index } of ordered) {
      outcomes[index] = await importKnowledgeDocument(tx, objectStore, extractor, auth, batchId, {
        relativePath, file: { fileName: relativePath.split("/").at(-1)!, contentType: "application/octet-stream", contentBase64: bytes.toString("base64") }
      }, context);
    }
    return { outcomes };
  });
}

export async function importKnowledgeDocument(
  db: Database, objectStore: ObjectStore, extractor: KnowledgeTextExtractor, auth: AuthContext,
  batchId: string, input: z.infer<typeof importKnowledgeDocumentSchema>, context: KnowledgeServiceContext = {}
): Promise<KnowledgeImportOutcome> {
  requireKnowledgeEdit(auth);
  const bytes = Buffer.from(input.file.contentBase64, "base64");
  if (bytes.length > 20 * 1024 * 1024) throw new ApiError("VALIDATION_FAILED", "文件超过 20 MB 上限。");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, auth, batchId);
    requireBatchCapacity(batch, 1, bytes.length);
    const outcome: KnowledgeImportOutcome = { id: randomUUID(), relativePath: input.relativePath,
      status: "unsupported_skipped", entryId: null, error: null };
    const extension = /\.([^.]+)$/.exec(input.file.fileName)?.[1]?.toLowerCase() ?? "";
    const contentType = contentTypes.get(extension);
    if (contentType) {
      // Serialize identical imports within an organization, including across batches.
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${auth.organization.id}:${checksum}`]);
      const matches = await tx.query<ReadableEntryRow>(`
        select e.id, e.status, e.created_by_user_id as "createdByUserId"
        from knowledge_entries e join knowledge_revisions r on r.id = e.head_revision_id and r.organization_id = e.organization_id
        left join knowledge_files f on f.id = r.file_id and f.organization_id = e.organization_id
        where e.organization_id = $1 and (r.source_checksum = $2 or f.checksum = $2)
        order by e.created_at, e.id`, [auth.organization.id, checksum]);
      const match = matches.rows.find((entry) => canReadEntry(auth, entry));
      if (match) {
        outcome.status = "duplicate_skipped";
        outcome.entryId = match.id;
      } else {
        const folderTags = input.relativePath.split("/").slice(0, -1).map((part) => part.trim().slice(0, 60)).filter(Boolean);
        const tags = [...new Set([...batch.tags, ...folderTags])].slice(0, 20);
        try {
          // A savepoint keeps a refused document from poisoning the batch transaction.
          const entry = await tx.transaction((documentTx) => createKnowledgeEntry(documentTx, objectStore, extractor, auth, {
            contentForm: "file", title: input.file.fileName.slice(0, 200), tags,
            file: { ...input.file, contentType }
          }, { ...context, importBatchId: batchId }));
          outcome.entryId = entry.id;
          outcome.status = entry.file?.extractionStatus === "failed" ? "extraction_failed" : "created";
          outcome.error = entry.file?.extractionError ?? null;
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== "VALIDATION_FAILED") throw error;
          outcome.status = "rejected";
          outcome.error = error.message;
        }
      }
    }
    await tx.query(`insert into knowledge_import_documents (id, batch_id, relative_path, size_bytes, status, entry_id, error, organization_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [outcome.id, batchId, input.relativePath, bytes.length, outcome.status, outcome.entryId, outcome.error, auth.organization.id]);
    await tx.query(`update knowledge_import_batches set document_count = document_count + 1, total_bytes = total_bytes + $1
      where id = $2 and organization_id = $3`, [bytes.length, batchId, auth.organization.id]);
    return outcome;
  });
}

export async function readKnowledgeImport(db: Database, auth: AuthContext, batchId: string, complete = false, context: KnowledgeServiceContext = {}) {
  requireKnowledgeEdit(auth);
  return db.transaction(async (tx) => {
    const batch = await lockBatch(tx, auth, batchId);
    const result = await tx.query<KnowledgeImportOutcome>(`select id, relative_path as "relativePath", status, entry_id as "entryId", error
      from knowledge_import_documents where batch_id = $1 and organization_id = $2 order by created_at, id`, [batchId, auth.organization.id]);
    const counts = { created: 0, duplicate_skipped: 0, unsupported_skipped: 0, extraction_failed: 0, rejected: 0 };
    for (const outcome of result.rows) counts[outcome.status]++;
    if (complete && !batch.completed_at) {
      await tx.query("update knowledge_import_batches set completed_at = now() where id = $1 and organization_id = $2", [batchId, auth.organization.id]);
      await writeAuditEventInTx(asAuditTx(tx), createUserInvocation(auth), { requestId: context.requestId ?? randomUUID() }, {
        app: "knowledge", kind: "knowledge-import-complete", action: "import", severity: "Medium", projectId: null,
        targetType: "knowledge-import-batch", targetId: batchId,
        metadata: { importBatchId: batchId, documentCount: batch.document_count, totalBytes: Number(batch.total_bytes), counts }
      });
    }
    const entries = await tx.query<ReadableEntryRow>(`select id, status, created_by_user_id as "createdByUserId"
      from knowledge_entries where organization_id = $1 and id = any($2::uuid[])`,
    [auth.organization.id, result.rows.flatMap((outcome) => outcome.entryId ? [outcome.entryId] : [])]);
    const readableIds = new Set(entries.rows.filter((entry) => canReadEntry(auth, entry)).map((entry) => entry.id));
    for (const outcome of result.rows) if (outcome.entryId && !readableIds.has(outcome.entryId)) outcome.entryId = null;
    return { id: batchId, tags: batch.tags, completed: complete || Boolean(batch.completed_at),
      documentCount: batch.document_count, totalBytes: Number(batch.total_bytes), counts, outcomes: result.rows };
  });
}
