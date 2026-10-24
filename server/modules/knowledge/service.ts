import { createHash, randomUUID } from "node:crypto";
import { isUtf8 } from "node:buffer";

import { asAuditTx, writeAuditEventInTx, type AuditSpec, type AuditTx } from "../audit/auditedWrite";
import type { AuditCorrelationContext, AuditSeverity } from "../audit/types";
import { assertKnowledgeInvocationMatches, knowledgeOrganizationId, type KnowledgeAccessContext as AuthContext } from "./scope";
import { createUserInvocation, type TrustedInvocationContext } from "../auth/trustedInvocation";

import { sanitizeFileName, type ObjectStore, type StoredObject } from "../logs/objectStore";
import { getLogRecord } from "../logs/service";
import { withLogInvocation } from "../logs/principal";
import { getReloadRunRecord } from "../dts-reload/service";
import { isRootDatabase, type Database, type Queryable, type RootDatabase } from "../../shared/database/client";
import { withKnowledgeAttachmentWrite } from "./attachmentWrites";
import { ApiError, serializeApiError } from "../../shared/http/errors";
import { readCatalogDefinitionForKnowledge, listCatalogDefinitionsForKnowledge } from "../parameter-catalog-api/productionWire";
import { buildLogAnalysisProvenanceNotice, buildLogDistillationDraft } from "./distillation";
import { buildReloadDistillationDraft, isReloadRunDistillable } from "./reloadDistillation";
import type { KnowledgeTextExtractor } from "./extraction";
import { KNOWLEDGE_MARKDOWN_CHARACTER_LIMIT, KNOWLEDGE_FILE_BYTE_LIMIT, KNOWLEDGE_TAG_LIMIT, knowledgeTagsSchema, type BatchKnowledgeEntriesInput } from "./schemas";
import { fuseKnowledgeSearchResults } from "./hybridSearch";
import type { KnowledgeEmbeddingClient } from "./indexing/embeddingClient";
import {
  enqueueAllPublishedEntries,
  countReferenceSuggestionRescanEntries,
  enqueueEntryIndexRefresh,
  hasKnowledgeVectorSupport,
  listIndexStatuses,
  type KnowledgeIndexStatusDto
} from "./indexing/repository";
import { scanKnowledgeReferenceSuggestions } from "./indexing/referenceSuggestionsEnsure";
import {
  countParameterReferencesForEntry,
  deleteDefinitionReference,
  deleteParameterReference,
  hasDefinitionReference,
  hasParameterReference,
  insertDefinitionReference,
  listPublishedEntriesReferencingDefinition,
  listPublishedEntriesReferencingSpec,
  resolveReferenceableSpec
} from "./parameterReferences";
import {
  canReadEntry,
  canGovernKnowledgeEntry,
  hasKnowledgeManage,
  requireKnowledgeEdit,
  requireKnowledgeGovern,
  requireKnowledgeManage,
  requireKnowledgeView
} from "./policy";
import {
  deriveRelatedKnowledgeQuery,
  RELATED_KNOWLEDGE_DEFAULT_LIMIT,
  RELATED_KNOWLEDGE_MAX_VECTOR_DISTANCE,
  RELATED_KNOWLEDGE_MIN_TEXT_SIMILARITY
} from "./relatedKnowledge";
import {
  deleteEntry,
  getEntryById,
  getEntryForUpdate,
  getFileById,
  getRevisionById,
  insertEntry,
  insertFile,
  insertRevision,
  listEntries,
  listRevisions,
  searchPublishedChunksByEmbedding,
  searchPublishedEntries,
  searchPublishedEntriesByTextSimilarity,
  setEntryHead,
  setEntrySearchText,
  setEntryStatus,
  updateFileExtraction
} from "./repository";
import type {
  KnowledgeEntryDto,
  KnowledgeOrigin,
  KnowledgeFileDto,
  KnowledgeRetrievalInfo,
  KnowledgeSearchResponseDto,
  KnowledgeSearchResultDto,
  KnowledgeSourceType,
  KnowledgeStatus,
  ListKnowledgeEntriesQuery
} from "./types";

export type KnowledgeServiceContext = AuditCorrelationContext & { importBatchId?: string; attachmentRoot?: RootDatabase };

export type KnowledgeFileUploadInput = {
  fileName: string;
  contentType: string;
  contentBase64: string;
};

export type CreateKnowledgeEntryInput =
  | { contentForm: "markdown"; title: string; tags: string[]; contentMarkdown: string; origin?: KnowledgeOrigin }
  | { contentForm: "file"; title: string; tags: string[]; file: KnowledgeFileUploadInput; origin?: KnowledgeOrigin };

export type UpdateKnowledgeEntryInput = {
  expectedHeadRevisionNumber: number;
  title?: string;
  tags?: string[];
  contentMarkdown?: string;
  file?: KnowledgeFileUploadInput;
};

/** Preserve routed provenance; legacy direct Home callers retain their existing User entry. */
export function knowledgeServiceInvocation(auth: AuthContext) {
  return auth.knowledgeInvocation ?? createUserInvocation(auth);
}

function knowledgeEntryNotFound(entryId: string) {
  return new ApiError("NOT_FOUND", "Knowledge entry was not found.", { entryId });
}

function revisionConflict(entryId: string, expected: number, current: number) {
  return new ApiError("CONFLICT", "Knowledge entry was changed by another save. Reload the latest revision and retry.", {
    code: "knowledge-revision-conflict",
    entryId,
    expectedHeadRevisionNumber: expected,
    currentHeadRevisionNumber: current
  });
}

function decodeFileUpload(input: KnowledgeFileUploadInput) {
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (bytes.byteLength === 0) {
    throw new ApiError("VALIDATION_FAILED", "Knowledge file content is empty.", { fileName: input.fileName });
  }
  if (bytes.byteLength > KNOWLEDGE_FILE_BYTE_LIMIT) {
    throw new ApiError("VALIDATION_FAILED", `Knowledge file exceeds the ${KNOWLEDGE_FILE_BYTE_LIMIT / 1024 / 1024}MB limit.`, {
      fileName: input.fileName,
      maxBytes: KNOWLEDGE_FILE_BYTE_LIMIT,
      sizeBytes: bytes.byteLength
    });
  }
  return bytes;
}

function buildSearchText(input: { title: string; tags: string[]; content: string | null }) {
  return [input.title, input.tags.join(" "), input.content ?? ""].join("\n").trim();
}

async function writeKnowledgeAudit(
  tx: AuditTx,
  invocation: TrustedInvocationContext,
  input: {
    kind: string;
    action: string;
    entryId: string;
    severity?: AuditSeverity;
    metadata?: Record<string, unknown>;
  },
  context: KnowledgeServiceContext = {}
) {
  // requestId fallback survives only until knowledge contexts become mandatory (ADR-0027).
  await writeAuditEventInTx(tx, invocation, { requestId: context.requestId ?? randomUUID() }, {
    app: "knowledge",
    kind: input.kind,
    action: input.action,
    severity: input.severity ?? "Medium",
    projectId: null,
    targetType: "knowledge-entry",
    targetId: input.entryId,
    metadata: input.metadata ?? {}
  });
}

/**
 * Runs text extraction for a stored file and records the outcome honestly on
 * the file row. When the file is still the entry's head content, the published
 * search text is refreshed so retrieval sees the extracted text.
 */
async function runFileExtraction(
  db: Database,
  extractor: KnowledgeTextExtractor,
  auth: AuthContext,
  input: { entryId: string; file: KnowledgeFileDto; bytes: Buffer }
): Promise<void> {
  const outcome = await extractor.extract({
    fileName: input.file.fileName,
    contentType: input.file.contentType,
    bytes: input.bytes
  });

  await db.transaction(async (tx) => {
    await updateFileExtraction(tx, auth, {
      fileId: input.file.id,
      extractionStatus: outcome.status,
      extractedText: outcome.status === "succeeded" ? outcome.text : null,
      pageOffsets: outcome.status === "succeeded" && input.file.contentType === "application/pdf" ? outcome.pageOffsets ?? null : null,
      extractionError: outcome.status === "failed" ? outcome.reason : null
    });

    if (outcome.status === "succeeded") {
      const entry = await getEntryForUpdate(tx, auth, input.entryId);
      if (entry && entry.file?.id === input.file.id) {
        await setEntrySearchText(tx, auth, {
          entryId: input.entryId,
          searchText: buildSearchText({ title: entry.title, tags: entry.tags, content: outcome.text })
        });
        if (entry.status !== "archived") {
          // The chunk projection reads the extracted text, so a published file
          // entry re-enqueues once extraction lands (covers the worker racing
          // ahead of a file replacement's extraction).
          await enqueueEntryIndexRefresh(tx, { entryId: input.entryId, organizationId: knowledgeOrganizationId(auth) });
        }
      }
    }
  });
}

function prepareKnowledgeEntry(input: CreateKnowledgeEntryInput) {
  if (input.contentForm === "markdown") return { ...input, sourceChecksum: null };
  const bytes = decodeFileUpload(input.file);
  const sourceChecksum = createHash("sha256").update(bytes).digest("hex");
  if (!/\.(md|txt)$/i.test(input.file.fileName)) return { ...input, bytes, sourceChecksum };
  if (!isUtf8(bytes)) {
    throw new ApiError("VALIDATION_FAILED", "文本文件必须使用有效的 UTF-8 编码，请转换编码后重新上传。", {
      reason: "knowledge-upload-invalid-utf8"
    });
  }
  const contentMarkdown = bytes.toString("utf8");
  if (contentMarkdown.length > KNOWLEDGE_MARKDOWN_CHARACTER_LIMIT) {
    throw new ApiError("VALIDATION_FAILED", `正文超过知识库 ${KNOWLEDGE_MARKDOWN_CHARACTER_LIMIT.toLocaleString("en-US")} 字符上限，请精简后重新上传。`, {
      reason: "knowledge-markdown-too-long", maxCharacters: KNOWLEDGE_MARKDOWN_CHARACTER_LIMIT
    });
  }
  return { contentForm: "markdown" as const, title: input.title, tags: input.tags, contentMarkdown, origin: "uploaded" as const, sourceChecksum };
}

export async function createKnowledgeEntry(
  db: Database,
  objectStore: ObjectStore,
  extractor: KnowledgeTextExtractor,
  auth: AuthContext,
  rawInput: CreateKnowledgeEntryInput,
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  const invocation = knowledgeServiceInvocation(auth);
  requireKnowledgeEdit(auth);

  const input = prepareKnowledgeEntry(rawInput);
  const sourceChecksum = input.sourceChecksum;

  const entryId = randomUUID();
  const revisionId = randomUUID();

  if (input.contentForm === "markdown") {
    await db.transaction(async (tx) => {
      await insertEntry(tx, auth, {
        id: entryId,
        title: input.title,
        contentForm: "markdown",
        origin: input.origin ?? "authored",
        tags: input.tags,
        sourceType: "human",
        sourceSessionId: null,
        sourceLogId: null,
        sourceReloadRunId: null,
        searchText: buildSearchText({ title: input.title, tags: input.tags, content: input.contentMarkdown })
      });
      await insertRevision(tx, auth, {
        id: revisionId,
        entryId,
        revisionNumber: 1,
        title: input.title,
        tags: input.tags,
        contentMarkdown: input.contentMarkdown,
        sourceChecksum,
        fileId: null,
        restoredFromRevisionId: null
      });
      await setEntryHead(tx, auth, {
        entryId,
        headRevisionId: revisionId,
        headRevisionNumber: 1,
        title: input.title,
        tags: input.tags,
        searchText: buildSearchText({ title: input.title, tags: input.tags, content: input.contentMarkdown })
      });
      await writeKnowledgeAudit(
        asAuditTx(tx),
        invocation,
        {
          kind: "knowledge-entry-create",
          action: "create",
          entryId,
          metadata: { contentForm: "markdown", title: input.title, tagCount: input.tags.length, revisionNumber: 1,
            ...(context.importBatchId ? { importBatchId: context.importBatchId } : {}) }
        },
        context
      );
    });

    const entry = await getEntryById(db, auth, entryId);
    if (!entry) throw knowledgeEntryNotFound(entryId);
    return entry;
  }

  const bytes = input.bytes;
  const fileId = randomUUID();
  const storedFile = await withKnowledgeAttachmentWrite(db, isRootDatabase(db) ? db : context.attachmentRoot, objectStore, {
    organizationId: knowledgeOrganizationId(auth), fileName: `knowledge-${randomUUID()}-${input.file.fileName}`,
    contentType: input.file.contentType, bytes
  }, async (tx, put) => {
    const stored = await put();
    stored.fileName = sanitizeFileName(input.file.fileName);
    await insertEntry(tx, auth, {
      id: entryId,
      title: input.title,
      contentForm: "file",
      origin: input.origin ?? "uploaded",
      tags: input.tags,
      sourceType: "human",
      sourceSessionId: null,
      sourceLogId: null,
      sourceReloadRunId: null,
      searchText: buildSearchText({ title: input.title, tags: input.tags, content: null })
    });
    const file = await insertFile(tx, auth, {
      id: fileId,
      entryId,
      storageKey: stored.storageKey,
      fileName: stored.fileName,
      contentType: input.file.contentType,
      sizeBytes: stored.fileSizeBytes,
      checksum: stored.checksumSha256
    });
    await insertRevision(tx, auth, {
      id: revisionId,
      entryId,
      revisionNumber: 1,
      title: input.title,
      tags: input.tags,
      contentMarkdown: null,
      fileId,
      restoredFromRevisionId: null
    });
    await setEntryHead(tx, auth, {
      entryId,
      headRevisionId: revisionId,
      headRevisionNumber: 1,
      title: input.title,
      tags: input.tags,
      searchText: buildSearchText({ title: input.title, tags: input.tags, content: null })
    });
    await writeKnowledgeAudit(
      asAuditTx(tx),
      invocation,
      {
        kind: "knowledge-entry-create",
        action: "create",
        entryId,
        metadata: {
          contentForm: "file",
          title: input.title,
          tagCount: input.tags.length,
          revisionNumber: 1,
          fileName: stored.fileName,
          sizeBytes: stored.fileSizeBytes,
          ...(context.importBatchId ? { importBatchId: context.importBatchId } : {})
        }
      },
      context
    );
    return file;
  });

  // Extraction runs after the entry is durable; failures land on the file row.
  await runFileExtraction(db, extractor, auth, { entryId, file: storedFile, bytes });

  const entry = await getEntryById(db, auth, entryId);
  if (!entry) throw knowledgeEntryNotFound(entryId);
  return entry;
}

/**
 * Shared markdown-draft creation for the distillation paths (Phase 3). Unlike
 * `createKnowledgeEntry` it carries explicit source attribution and writes its
 * audit evidence through the ADR-0027 seam inside the same transaction.
 */
async function createMarkdownDraftWithSource(
  db: Database,
  auth: AuthContext,
  invocation: TrustedInvocationContext,
  input: {
    title: string;
    tags: string[];
    contentMarkdown: string;
    sourceType: KnowledgeSourceType;
    origin: KnowledgeOrigin;
    sourceSessionId: string | null;
    sourceLogId: string | null;
    sourceReloadRunId: string | null;
    audit: Pick<AuditSpec, "kind" | "action" | "metadata">;
  },
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  const entryId = randomUUID();
  const revisionId = randomUUID();
  const searchText = buildSearchText({ title: input.title, tags: input.tags, content: input.contentMarkdown });

  await db.transaction(async (tx) => {
    await insertEntry(tx, auth, {
      id: entryId,
      title: input.title,
      contentForm: "markdown",
      tags: input.tags,
      sourceType: input.sourceType,
      origin: input.origin,
      sourceSessionId: input.sourceSessionId,
      sourceLogId: input.sourceLogId,
      sourceReloadRunId: input.sourceReloadRunId,
      searchText
    });
    await insertRevision(tx, auth, {
      id: revisionId,
      entryId,
      revisionNumber: 1,
      title: input.title,
      tags: input.tags,
      contentMarkdown: input.contentMarkdown,
      fileId: null,
      restoredFromRevisionId: null
    });
    await setEntryHead(tx, auth, {
      entryId,
      headRevisionId: revisionId,
      headRevisionNumber: 1,
      title: input.title,
      tags: input.tags,
      searchText
    });
    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId: context.requestId ?? randomUUID() }, {
      app: "knowledge",
      kind: input.audit.kind,
      action: input.audit.action,
      severity: "Medium",
      projectId: null,
      targetType: "knowledge-entry",
      targetId: entryId,
      metadata: input.audit.metadata
    });
  });

  const entry = await getEntryById(db, auth, entryId);
  if (!entry) throw knowledgeEntryNotFound(entryId);
  return entry;
}

/**
 * Distils a completed log-analysis record into a pre-filled knowledge DRAFT
 * (design D15). The caller needs `knowledge:edit` to create the draft and must
 * be able to read the source record (`logs:view` + organization scope, enforced
 * by the logs service). The draft follows every Phase 1 rule: revision 1 is
 * created, the write is audited, and it stays invisible to retrieval until a
 * human publishes it.
 */
export async function distillKnowledgeFromLog(
  db: Database,
  auth: AuthContext,
  input: { logId: string },
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  requireKnowledgeEdit(auth);

  const log = await getLogRecord(db, auth.knowledgeInvocation ? withLogInvocation(auth, auth.knowledgeInvocation) : auth, input.logId);
  if (log.status !== "complete") {
    throw new ApiError("VALIDATION_FAILED", "Only completed log analyses can be distilled into knowledge.", {
      logId: input.logId,
      status: log.status
    });
  }

  const draft = buildLogDistillationDraft(log);
  return createMarkdownDraftWithSource(
    db,
    auth,
    knowledgeServiceInvocation(auth),
    {
      ...draft,
      origin: "distilled",
      sourceType: "human",
      sourceSessionId: null,
      sourceLogId: log.id,
      sourceReloadRunId: null,
      audit: {
        kind: "knowledge-entry-distill",
        action: "distill",
        metadata: {
          logId: log.id,
          fileName: log.fileName,
          severity: log.severity,
          title: draft.title,
          ...(log.analysisSource !== undefined ? { analysisSource: log.analysisSource } : {}),
          ...(log.degradedReason !== undefined ? { degradedReason: log.degradedReason } : {})
        }
      }
    },
    context
  );
}

/**
 * Distils a terminal DTS reload run into a pre-filled knowledge DRAFT
 * (design deferred roadmap item 3). The caller needs `knowledge:edit` to
 * create the draft and must be able to read the source run — the same gate
 * the reload history routes enforce (`debugging:view` or
 * `debugging:dts-reload`, organization-scoped, via `getReloadRunRecord`).
 * Only post-device-write terminals distil (verified / unverifiable /
 * contradicted / failed): the honest outcome is part of the knowledge value,
 * while pre-deploy states have no outcome to distil yet. The draft follows
 * every Phase 1 rule: revision 1, audited write, invisible to retrieval
 * until a human publishes it.
 */
export async function distillKnowledgeFromReloadRun(
  db: Database,
  auth: AuthContext,
  input: { runId: string },
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  requireKnowledgeEdit(auth);

  const run = await getReloadRunRecord(db, auth, input.runId, auth.knowledgeInvocation);
  if (!isReloadRunDistillable(run.status)) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Only terminal reload runs (verified, unverifiable, contradicted, or failed) can be distilled into knowledge.",
      { runId: input.runId, status: run.status }
    );
  }

  const draft = buildReloadDistillationDraft(run);
  return createMarkdownDraftWithSource(
    db,
    auth,
    knowledgeServiceInvocation(auth),
    {
      ...draft,
      origin: "distilled",
      sourceType: "human",
      sourceSessionId: null,
      sourceLogId: null,
      sourceReloadRunId: run.id,
      audit: {
        kind: "knowledge-entry-distill",
        action: "distill",
        metadata: {
          reloadRunId: run.id,
          projectId: run.projectId,
          status: run.status,
          purpose: run.purpose,
          title: draft.title
        }
      }
    },
    context
  );
}

/**
 * Agent-facing draft creation for `action.createKnowledgeDraft` (design D2/D14):
 * runs under the calling user's AuthContext (`knowledge:edit` enforced), records
 * the creating session and user so the publisher-accountability rule works, and
 * only ever creates a NEW draft — agents never modify existing entries.
 */
export async function createAgentKnowledgeDraft(
  db: Database,
  auth: AuthContext,
  input: {
    title: string;
    tags: string[];
    contentMarkdown: string;
    sessionId: string;
    sourceLogId?: string;
    sourceReloadRunId?: string;
  },
  invocation: TrustedInvocationContext,
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  assertKnowledgeInvocationMatches(auth, invocation, "Agent knowledge draft");
  requireKnowledgeEdit(auth);

  let sourceLogId: string | null = null;
  let contentMarkdown = input.contentMarkdown;
  if (input.sourceLogId) {
    // Linking is a read of the analysis record: same logs:view + org scope gate.
    const log = await getLogRecord(db, auth.knowledgeInvocation ? withLogInvocation(auth, auth.knowledgeInvocation) : auth, input.sourceLogId);
    sourceLogId = log.id;
    const notice = buildLogAnalysisProvenanceNotice(log);
    if (notice && !contentMarkdown.startsWith(notice)) {
      contentMarkdown = `${notice}\n\n${contentMarkdown}`;
    }
  }

  let sourceReloadRunId: string | null = null;
  if (input.sourceReloadRunId) {
    // Linking is a read of the run: same reload read gate + org scope as the API path.
    const run = await getReloadRunRecord(db, auth, input.sourceReloadRunId, auth.knowledgeInvocation);
    sourceReloadRunId = run.id;
  }

  return createMarkdownDraftWithSource(
    db,
    auth,
    invocation,
    {
      title: input.title,
      tags: input.tags,
      contentMarkdown,
      sourceType: "agent",
      origin: "agent-drafted",
      sourceSessionId: input.sessionId,
      sourceLogId,
      sourceReloadRunId,
      audit: {
        kind: "knowledge-entry-agent-draft",
        action: "agent-draft-create",
        metadata: {
          sessionId: input.sessionId,
          title: input.title,
          sourceLogId,
          sourceReloadRunId,
          tagCount: input.tags.length
        }
      }
    },
    context
  );
}

/**
 * Archive-reject for the agent-draft publish queue: the reviewer (entry owner
 * with `knowledge:edit`, or `knowledge:manage`) moves an agent-sourced draft to
 * `archived` without ever publishing it. Human drafts keep the normal
 * draft → published lifecycle and cannot be rejected through this path.
 */
export async function rejectAgentKnowledgeDraft(
  db: Database,
  auth: AuthContext,
  entryId: string,
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  const invocation = knowledgeServiceInvocation(auth);
  await db.transaction(async (tx) => {
    const entry = await getEntryForUpdate(tx, auth, entryId);
    if (!entry || !canReadEntry(auth, entry)) {
      throw knowledgeEntryNotFound(entryId);
    }
    requireKnowledgeGovern(auth, entry);

    if (entry.status !== "draft" || entry.sourceType !== "agent") {
      throw new ApiError("VALIDATION_FAILED", "Only agent-sourced drafts can be archive-rejected.", {
        entryId,
        status: entry.status,
        sourceType: entry.sourceType
      });
    }

    // A draft was never indexed (published-only retrieval), so no index refresh
    // is enqueued here — the entry goes straight to archived.
    await setEntryStatus(tx, auth, { entryId, status: "archived" });
    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId: context.requestId ?? randomUUID() }, {
      app: "knowledge",
      kind: "knowledge-entry-reject",
      action: "reject",
      severity: "Medium",
      projectId: null,
      targetType: "knowledge-entry",
      targetId: entryId,
      metadata: {
        title: entry.title,
        sourceSessionId: entry.sourceSessionId,
        sourceLogId: entry.sourceLogId,
        sourceReloadRunId: entry.sourceReloadRunId
      }
    });
  });

  const entry = await getEntryById(db, auth, entryId);
  if (!entry) throw knowledgeEntryNotFound(entryId);
  return entry;
}

export async function updateKnowledgeEntry(
  db: Database,
  objectStore: ObjectStore,
  extractor: KnowledgeTextExtractor,
  auth: AuthContext,
  entryId: string,
  input: UpdateKnowledgeEntryInput,
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  const invocation = knowledgeServiceInvocation(auth);
  if (!hasKnowledgeManage(auth)) requireKnowledgeEdit(auth);

  const uploadedBytes = input.file ? decodeFileUpload(input.file) : null;
  let storedForExtraction: { file: KnowledgeFileDto; bytes: Buffer } | null = null;

  const save = async (tx: Database, put?: () => Promise<StoredObject>) => {
    const entry = await getEntryForUpdate(tx, auth, entryId);
    if (!entry || !canReadEntry(auth, entry)) {
      throw knowledgeEntryNotFound(entryId);
    }
    requireKnowledgeGovern(auth, entry);

    if (entry.headRevisionNumber !== input.expectedHeadRevisionNumber) {
      throw revisionConflict(entryId, input.expectedHeadRevisionNumber, entry.headRevisionNumber);
    }
    if (entry.contentForm === "markdown" && input.file !== undefined) {
      throw new ApiError("VALIDATION_FAILED", "Markdown entries do not accept file replacements.", { entryId });
    }
    if (entry.contentForm === "file" && input.contentMarkdown !== undefined) {
      throw new ApiError("VALIDATION_FAILED", "File entries do not accept markdown content. Replace the file instead.", {
        entryId
      });
    }

    const nextTitle = input.title ?? entry.title;
    const nextTags = input.tags ?? entry.tags;
    const nextRevisionNumber = entry.headRevisionNumber + 1;
    const revisionId = randomUUID();

    if (entry.contentForm === "markdown") {
      const nextContent = input.contentMarkdown ?? entry.contentMarkdown ?? "";
      await insertRevision(tx, auth, {
        id: revisionId,
        entryId,
        revisionNumber: nextRevisionNumber,
        title: nextTitle,
        tags: nextTags,
        contentMarkdown: nextContent,
        fileId: null,
        restoredFromRevisionId: null
      });
      await setEntryHead(tx, auth, {
        entryId,
        headRevisionId: revisionId,
        headRevisionNumber: nextRevisionNumber,
        title: nextTitle,
        tags: nextTags,
        searchText: buildSearchText({ title: nextTitle, tags: nextTags, content: nextContent })
      });
    } else {
      let nextFileId = entry.file?.id ?? null;
      let searchContent: string | null =
        entry.file && entry.file.extractionStatus === "succeeded" ? await getFileByIdForSearch(tx, auth, entry.file.id) : null;
      if (input.file) {
        if (!put || !uploadedBytes) throw new Error("Knowledge attachment custody unavailable");
        const stored = await put();
        stored.fileName = sanitizeFileName(input.file.fileName);
        const file = await insertFile(tx, auth, {
          id: randomUUID(),
          entryId,
          storageKey: stored.storageKey,
          fileName: stored.fileName,
          contentType: input.file.contentType,
          sizeBytes: stored.fileSizeBytes,
          checksum: stored.checksumSha256
        });
        nextFileId = file.id;
        searchContent = null;
        storedForExtraction = { file, bytes: uploadedBytes };
      }
      await insertRevision(tx, auth, {
        id: revisionId,
        entryId,
        revisionNumber: nextRevisionNumber,
        title: nextTitle,
        tags: nextTags,
        contentMarkdown: null,
        fileId: nextFileId,
        restoredFromRevisionId: null
      });
      await setEntryHead(tx, auth, {
        entryId,
        headRevisionId: revisionId,
        headRevisionNumber: nextRevisionNumber,
        title: nextTitle,
        tags: nextTags,
        searchText: buildSearchText({ title: nextTitle, tags: nextTags, content: searchContent })
      });
    }

    await writeKnowledgeAudit(
      asAuditTx(tx),
      invocation,
      {
        kind: "knowledge-entry-update",
        action: "update",
        entryId,
        metadata: {
          contentForm: entry.contentForm,
          status: entry.status,
          title: nextTitle,
          revisionNumber: nextRevisionNumber,
          fileReplaced: Boolean(input.file)
        }
      },
      context
    );
  };
  if (input.file && uploadedBytes) {
    await withKnowledgeAttachmentWrite(db, isRootDatabase(db) ? db : context.attachmentRoot, objectStore, {
      organizationId: knowledgeOrganizationId(auth), fileName: `knowledge-${randomUUID()}-${input.file.fileName}`,
      contentType: input.file.contentType, bytes: uploadedBytes
    }, save);
  } else await db.transaction(tx => save(tx));

  if (storedForExtraction !== null) {
    const pendingExtraction = storedForExtraction as { file: KnowledgeFileDto; bytes: Buffer };
    await runFileExtraction(db, extractor, auth, {
      entryId,
      file: pendingExtraction.file,
      bytes: pendingExtraction.bytes
    });
  }

  const entry = await getEntryById(db, auth, entryId);
  if (!entry) throw knowledgeEntryNotFound(entryId);
  return entry;
}

async function transitionKnowledgeEntry(
  db: Database,
  auth: AuthContext,
  invocation: TrustedInvocationContext,
  entryId: string,
  input: {
    fromStatuses: KnowledgeStatus[];
    toStatus: KnowledgeStatus;
    kind: string;
    action: string;
  },
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  await db.transaction(async (tx) => {
    const entry = await getEntryForUpdate(tx, auth, entryId);
    if (!entry || !canReadEntry(auth, entry)) {
      throw knowledgeEntryNotFound(entryId);
    }
    requireKnowledgeGovern(auth, entry);

    if (!input.fromStatuses.includes(entry.status)) {
      throw new ApiError(
        "VALIDATION_FAILED",
        `Illegal knowledge status transition: ${entry.status} -> ${input.toStatus}.`,
        { reason: "knowledge-illegal-status-transition", entryId, currentStatus: entry.status, nextStatus: input.toStatus }
      );
    }

    await setEntryStatus(tx, auth, { entryId, status: input.toStatus });
    // Publish and restore add the entry to the retrieval index; archive removes
    // it (the worker deletes chunks for any non-published entry).
    await enqueueEntryIndexRefresh(tx, { entryId, organizationId: knowledgeOrganizationId(auth) });
    await writeKnowledgeAudit(
      asAuditTx(tx),
      invocation,
      {
        kind: input.kind,
        action: input.action,
        entryId,
        metadata: { previousStatus: entry.status, nextStatus: input.toStatus, title: entry.title }
      },
      context
    );
  });

  const entry = await getEntryById(db, auth, entryId);
  if (!entry) throw knowledgeEntryNotFound(entryId);
  return entry;
}

/** Publishing is the single trust gate into retrieval (D13). */
export async function publishKnowledgeEntry(
  db: Database,
  auth: AuthContext,
  entryId: string,
  context: KnowledgeServiceContext = {}
) {
  return transitionKnowledgeEntry(
    db,
    auth,
    knowledgeServiceInvocation(auth),
    entryId,
    { fromStatuses: ["draft"], toStatus: "published", kind: "knowledge-entry-publish", action: "publish" },
    context
  );
}

export async function archiveKnowledgeEntry(
  db: Database,
  auth: AuthContext,
  entryId: string,
  context: KnowledgeServiceContext = {}
) {
  return transitionKnowledgeEntry(
    db,
    auth,
    knowledgeServiceInvocation(auth),
    entryId,
    { fromStatuses: ["draft", "published"], toStatus: "archived", kind: "knowledge-entry-archive", action: "archive" },
    context
  );
}

export async function batchKnowledgeEntries(
  db: Database,
  objectStore: ObjectStore,
  extractor: KnowledgeTextExtractor,
  auth: AuthContext,
  invocation: TrustedInvocationContext,
  input: BatchKnowledgeEntriesInput,
  context: KnowledgeServiceContext = {}
) {
  requireKnowledgeView(auth);
  const requestId = context.requestId ?? randomUUID();
  assertKnowledgeInvocationMatches(auth, invocation, "Knowledge batch");
  const results: {
    entryId: string; title: string | null; status: "succeeded" | "refused" | "failed";
    entry: KnowledgeEntryDto | null; error: { code: string; message: string; reason?: string } | null;
  }[] = [];
  for (const entryId of input.entryIds) {
    let title: string | null = null;
    try {
      const current = await getKnowledgeEntry(db, auth, entryId);
      title = current.title;
      requireKnowledgeGovern(auth, current);
      let entry: KnowledgeEntryDto;
      if (input.action === "publish") {
        entry = await transitionKnowledgeEntry(db, auth, invocation, entryId,
          { fromStatuses: ["draft"], toStatus: "published", kind: "knowledge-entry-publish", action: "publish" }, { ...context, requestId });
      } else if (input.action === "archive") {
        entry = await transitionKnowledgeEntry(db, auth, invocation, entryId,
          { fromStatuses: ["draft", "published"], toStatus: "archived", kind: "knowledge-entry-archive", action: "archive" }, { ...context, requestId });
      } else if (input.action === "accept_suggestions") {
        await db.transaction(async (tx) => {
          await requireReferenceEditableEntry(tx, auth, entryId);
          const definitions = await listCatalogDefinitionsForKnowledge(db, auth, requestId);
          const suggestions = await listPendingReferenceSuggestions(tx, auth, definitions.map((d) => d.id), entryId);
          for (const suggestion of suggestions) {
            await addKnowledgeDefinitionReferenceInTx(db, tx, auth, invocation,
              { entryId, definitionId: suggestion.definitionId, fromSuggestion: true }, { ...context, requestId });
          }
        });
        entry = { ...await getKnowledgeEntry(db, auth, entryId), pendingSuggestionCount: 0 };
      } else {
        const tags = input.action === "add_tags"
          ? [...new Set([...current.tags, ...input.tags])]
          : current.tags.filter((tag) => !input.tags.includes(tag));
        if (!knowledgeTagsSchema.safeParse(tags).success) {
          throw new ApiError("VALIDATION_FAILED", `标签合并后超过每条 ${KNOWLEDGE_TAG_LIMIT} 个标签的上限。`);
        }
        entry = await updateKnowledgeEntry(db, objectStore, extractor, auth, entryId, {
          expectedHeadRevisionNumber: current.headRevisionNumber, tags
        }, { ...context, requestId });
      }
      results.push({ entryId, title: entry.title, status: "succeeded", entry, error: null });
    } catch (failure) {
      const { code, message } = serializeApiError(failure, requestId).error;
      const reason = failure instanceof ApiError && typeof failure.details.reason === "string" ? failure.details.reason : undefined;
      results.push({ entryId, title, status: code === "FORBIDDEN" || code === "NOT_FOUND" ? "refused" : "failed",
        entry: null, error: { code, message, ...(reason ? { reason } : {}) } });
    }
  }
  let summaryError: string | null = null;
  try {
    await db.transaction(async (tx) => {
      await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId }, {
        app: "knowledge", kind: "knowledge-batch", action: input.action, severity: "Medium", projectId: null,
        targetType: "knowledge-batch", targetId: randomUUID(),
        metadata: { action: input.action, results: results.map(({ entryId, status, error }) => ({ entryId, status, error })) }
      });
    });
  } catch {
    // Per-entry writes and their audits have already committed; always return their outcomes.
    summaryError = "条目结果已保留，批次汇总审计写入失败。请联系管理员，勿重复提交已成功的条目。";
  }
  return { results, summaryError };
}

export async function restoreKnowledgeEntry(
  db: Database,
  auth: AuthContext,
  entryId: string,
  context: KnowledgeServiceContext = {}
) {
  return transitionKnowledgeEntry(
    db,
    auth,
    knowledgeServiceInvocation(auth),
    entryId,
    { fromStatuses: ["archived"], toStatus: "published", kind: "knowledge-entry-restore", action: "restore" },
    context
  );
}

export async function hardDeleteKnowledgeEntry(
  db: Database,
  auth: AuthContext,
  entryId: string,
  context: KnowledgeServiceContext = {}
): Promise<void> {
  const invocation = knowledgeServiceInvocation(auth);
  requireKnowledgeManage(auth);

  await db.transaction(async (tx) => {
    const entry = await getEntryForUpdate(tx, auth, entryId);
    if (!entry) {
      throw knowledgeEntryNotFound(entryId);
    }

    // The delete cascades reference rows; the audit records how many went with it.
    const parameterReferenceCount = await countParameterReferencesForEntry(tx, auth, entryId);
    await deleteEntry(tx, auth, entryId);
    await writeKnowledgeAudit(
      asAuditTx(tx),
      invocation,
      {
        kind: "knowledge-entry-delete",
        action: "delete",
        entryId,
        severity: "High",
        metadata: {
          title: entry.title,
          contentForm: entry.contentForm,
          status: entry.status,
          headRevisionNumber: entry.headRevisionNumber,
          parameterReferenceCount
        }
      },
      context
    );
  });
}

/**
 * Guard shared by the reference edit endpoints: same governance rule as entry
 * editing (`knowledge:edit` own / `knowledge:manage` any). Archived entries
 * allow content corrections but keep their parameter references read-only.
 */
async function requireReferenceEditableEntry(tx: Queryable, auth: AuthContext, entryId: string) {
  const entry = await getEntryForUpdate(tx, auth, entryId);
  if (!entry || !canReadEntry(auth, entry)) {
    throw knowledgeEntryNotFound(entryId);
  }
  requireKnowledgeGovern(auth, entry);
  if (entry.status === "archived") {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Archived knowledge entries cannot change parameter references. Restore the entry first.",
      { entryId, status: entry.status }
    );
  }
  return entry;
}

/**
 * Adds a structural reference from a knowledge entry to a parameter
 * definition (deferred roadmap item 2). Binds to `parameter_specs.id`, the
 * stable surrogate (ADR-0017); referencing a deprecated definition is allowed
 * — the lifecycle is displayed honestly rather than gated (ADR-0011).
 * Idempotent: re-adding an existing pair changes nothing and writes no audit.
 */
export async function addKnowledgeParameterReference(
  db: Database,
  auth: AuthContext,
  input: { entryId: string; specId: string },
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  await db.transaction(async (tx) => {
    await requireReferenceEditableEntry(tx, auth, input.entryId);
    if (await hasParameterReference(tx, auth, input)) return;
    throw new ApiError("CONFLICT", "Legacy Spec references are read-only; add a Catalog Definition reference instead.", {
      reason: "legacy-reference-write-disabled",
      entryId: input.entryId,
      specId: input.specId,
      requestId: context.requestId
    });
  });
  const entry = await getEntryById(db, auth, input.entryId);
  if (!entry) throw knowledgeEntryNotFound(input.entryId);
  return entry;
}

export async function addKnowledgeDefinitionReference(
  db: Database,
  auth: AuthContext,
  invocation: TrustedInvocationContext,
  input: { entryId: string; definitionId: string; fromSuggestion?: boolean },
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  assertKnowledgeInvocationMatches(auth, invocation, "Knowledge definition reference");
  await db.transaction((tx) => addKnowledgeDefinitionReferenceInTx(db, tx, auth, invocation, input, context));
  const entry = await getEntryById(db, auth, input.entryId);
  if (!entry) throw knowledgeEntryNotFound(input.entryId);
  return entry;
}

async function addKnowledgeDefinitionReferenceInTx(
  db: Database, tx: Database, auth: AuthContext, invocation: TrustedInvocationContext,
  input: { entryId: string; definitionId: string; fromSuggestion?: boolean }, context: KnowledgeServiceContext
) {
  const entry = await requireReferenceEditableEntry(tx, auth, input.entryId);
  if (input.fromSuggestion) {
    const suggestion = await tx.query<{ status: string }>(
      "select status from knowledge_reference_suggestions where organization_id = $1 and entry_id = $2 and definition_id = $3 for update",
      [knowledgeOrganizationId(auth), input.entryId, input.definitionId]
    );
    if (!suggestion.rows[0] || !["pending", "accepted"].includes(suggestion.rows[0].status)) {
      throw new ApiError("CONFLICT", "Reference suggestion is not pending.", { reason: "suggestion-not-pending" });
    }
    await tx.query(
      "update knowledge_reference_suggestions set status = 'accepted', updated_at = now() where organization_id = $1 and entry_id = $2 and definition_id = $3",
      [knowledgeOrganizationId(auth), input.entryId, input.definitionId]
    );
  }
  if (await hasDefinitionReference(tx, auth, input)) return;
  // Read through the authenticated Catalog boundary using the root Database.
  const definition = await readCatalogDefinitionForKnowledge(db, auth, input.definitionId, context.requestId);
  if (definition.lifecycle === "retired") {
    throw new ApiError("CONFLICT", "Retired Catalog Definitions cannot receive new knowledge references.", {
      reason: "definition-retired",
      definitionId: input.definitionId,
      requestId: context.requestId
    });
  }
  const inserted = await insertDefinitionReference(tx, auth, {
    id: randomUUID(),
    entryId: input.entryId,
    definitionId: input.definitionId
  });
  if (!inserted) return;

  await writeKnowledgeAudit(
    asAuditTx(tx),
    invocation,
    {
      kind: "knowledge-definition-reference-add",
      action: "definition-reference-add",
      entryId: input.entryId,
      metadata: {
        title: entry.title,
        definitionId: input.definitionId,
        propertyKey: definition.propertyKey,
        driverModule: definition.subject.canonicalName,
        lifecycle: definition.lifecycle,
        ...(input.fromSuggestion ? { fromSuggestion: true } : {})
      }
    },
    context
  );
}

/** Shared pending predicate for detail, counts/filter and transactional batch acceptance. */
async function listPendingReferenceSuggestions(db: Queryable, auth: AuthContext, definitionIds: string[] | null, entryId?: string) {
  const result = await db.query<{
    entryId: string;
    definitionId: string; propertyKey: string; mentionCount: number; snippet: string;
    page: number | null; detectedRevisionId: string;
  }>(
    `select s.entry_id as "entryId", s.definition_id as "definitionId", s.property_key as "propertyKey", s.mention_count as "mentionCount",
            s.snippet, s.page, s.detected_revision_id as "detectedRevisionId"
     from knowledge_reference_suggestions s
     join knowledge_entries e on e.organization_id = s.organization_id and e.id = s.entry_id
     where s.organization_id = $1 and ($2::uuid is null or s.entry_id = $2) and s.status = 'pending'
       and e.status <> 'archived' and ($3::text[] is null or s.definition_id = any($3::text[]))
       and ($4::boolean or (e.responsible_user_id = $5 and $6::boolean))
       and not exists (select 1 from knowledge_definition_references r
         where r.organization_id = s.organization_id and r.entry_id = s.entry_id and r.definition_id = s.definition_id)
     order by s.mention_count desc, s.property_key, s.definition_id`,
    [knowledgeOrganizationId(auth), entryId ?? null, definitionIds,
      canGovernKnowledgeEntry(auth, { createdByUserId: null }), auth.user.id,
      canGovernKnowledgeEntry(auth, { createdByUserId: auth.user.id })]
  );
  return result.rows;
}

export async function listKnowledgeReferenceSuggestions(db: Database, auth: AuthContext, entryId: string, requestId: string) {
  requireKnowledgeView(auth);
  const entry = await getEntryById(db, auth, entryId);
  if (!entry || !canReadEntry(auth, entry)) throw knowledgeEntryNotFound(entryId);
  requireKnowledgeGovern(auth, entry);
  if (entry.status === "archived") return [];
  const definitions = new Map((await listCatalogDefinitionsForKnowledge(db, auth, requestId)).map((definition) => [definition.id, definition]));
  const pending = await listPendingReferenceSuggestions(db, auth, [...definitions.keys()], entryId);
  return pending.flatMap(({ entryId: _entryId, ...row }) => {
    const definition = definitions.get(row.definitionId);
    return !definition || definition.lifecycle === "retired" ? [] : [{ ...row,
      displayName: definition.currentRevision.displayName, driverModule: definition.subject.canonicalName, lifecycle: definition.lifecycle
    }];
  });
}

export async function dismissKnowledgeReferenceSuggestion(
  db: Database, auth: AuthContext, invocation: TrustedInvocationContext,
  input: { entryId: string; definitionId: string }, context: KnowledgeServiceContext = {}
) {
  assertKnowledgeInvocationMatches(auth, invocation, "Knowledge reference suggestion dismissal");
  await db.transaction(async (tx) => {
    await requireReferenceEditableEntry(tx, auth, input.entryId);
    const changed = await tx.query(
      `update knowledge_reference_suggestions set status = 'dismissed', updated_at = now()
       where organization_id = $1 and entry_id = $2 and definition_id = $3 and status = 'pending'
       returning definition_id`, [knowledgeOrganizationId(auth), input.entryId, input.definitionId]
    );
    if (!changed.rowCount) return;
    await writeKnowledgeAudit(asAuditTx(tx), invocation, {
      kind: "knowledge-reference-suggestion-dismiss", action: "reference-suggestion-dismiss", entryId: input.entryId,
      metadata: { definitionId: input.definitionId }
    }, context);
  });
}

export async function removeKnowledgeParameterReference(
  db: Database,
  auth: AuthContext,
  input: { entryId: string; specId: string },
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  const invocation = knowledgeServiceInvocation(auth);
  await db.transaction(async (tx) => {
    const entry = await requireReferenceEditableEntry(tx, auth, input.entryId);

    const removed = await deleteParameterReference(tx, auth, {
      entryId: input.entryId,
      specId: input.specId
    });
    if (!removed) {
      throw new ApiError("NOT_FOUND", "Parameter reference was not found on this entry.", {
        entryId: input.entryId,
        specId: input.specId
      });
    }

    await writeKnowledgeAudit(
      asAuditTx(tx),
      invocation,
      {
        kind: "knowledge-parameter-reference-remove",
        action: "parameter-reference-remove",
        entryId: input.entryId,
        metadata: { title: entry.title, specId: input.specId }
      },
      context
    );
  });

  const entry = await getEntryById(db, auth, input.entryId);
  if (!entry) throw knowledgeEntryNotFound(input.entryId);
  return entry;
}

export async function removeKnowledgeDefinitionReference(
  db: Database,
  auth: AuthContext,
  input: { entryId: string; definitionId: string },
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  const invocation = knowledgeServiceInvocation(auth);
  await db.transaction(async (tx) => {
    const entry = await requireReferenceEditableEntry(tx, auth, input.entryId);
    const removed = await deleteDefinitionReference(tx, auth, input);
    if (!removed) return;

    await writeKnowledgeAudit(
      asAuditTx(tx),
      invocation,
      {
        kind: "knowledge-definition-reference-remove",
        action: "definition-reference-remove",
        entryId: input.entryId,
        metadata: { title: entry.title, definitionId: input.definitionId }
      },
      context
    );
  });

  const entry = await getEntryById(db, auth, input.entryId);
  if (!entry) throw knowledgeEntryNotFound(input.entryId);
  return entry;
}

/**
 * Parameter-side read (定义详情 相关知识): published entries referencing one
 * definition. Published-only invariant — drafts/archived never appear here
 * regardless of who looks. Pure read: `knowledge:view` plus organization
 * scope, no audit, matching `searchKnowledge`. Specs outside the caller's
 * scope (unknown or another tenant's) are 404, same as the spec detail API.
 */
export async function findRelatedKnowledgeForSpec(
  db: Queryable,
  auth: AuthContext,
  input: { specId: string; limit?: number }
): Promise<{ items: KnowledgeSearchResultDto[] }> {
  requireKnowledgeView(auth);

  const spec = await resolveReferenceableSpec(db, knowledgeOrganizationId(auth), input.specId);
  if (!spec) {
    throw new ApiError("NOT_FOUND", "Parameter definition was not found.", { specId: input.specId });
  }

  return {
    items: await listPublishedEntriesReferencingSpec(db, auth, { specId: spec.specId, limit: input.limit })
  };
}

export async function findRelatedKnowledgeForDefinition(
  db: Database,
  auth: AuthContext,
  input: { definitionId: string; limit?: number }
): Promise<{ items: KnowledgeSearchResultDto[] }> {
  requireKnowledgeView(auth);
  await readCatalogDefinitionForKnowledge(db, auth, input.definitionId);
  return {
    items: await listPublishedEntriesReferencingDefinition(db, auth, {
      definitionId: input.definitionId,
      limit: input.limit
    })
  };
}

export async function listKnowledgeEntries(db: Database, auth: AuthContext, query: ListKnowledgeEntriesQuery = {}, requestId: string = randomUUID()) {
  requireKnowledgeView(auth);
  if (query.governable && !hasKnowledgeManage(auth)) requireKnowledgeEdit(auth);
  const pending = canGovernKnowledgeEntry(auth, { createdByUserId: auth.user.id })
    ? await listPendingReferenceSuggestions(db, auth, null) : [];
  const definitions = new Set(pending.length ? (await listCatalogDefinitionsForKnowledge(db, auth, requestId)).map((d) => d.id) : []);
  const counts = new Map<string, number>();
  for (const row of pending) if (definitions.has(row.definitionId)) counts.set(row.entryId, (counts.get(row.entryId) ?? 0) + 1);
  const entries = await listEntries(db, auth, {
    ...query,
    ...(query.pendingSuggestions ? { pendingEntryIds: [...counts.keys()] } : {}),
    visibleDraftOwnerUserId: hasKnowledgeManage(auth) ? undefined : auth.user.id
  });
  return entries.map((entry) => canGovernKnowledgeEntry(auth, entry)
    ? { ...entry, pendingSuggestionCount: counts.get(entry.id) ?? 0 } : entry);
}

export async function getKnowledgeEntry(db: Queryable, auth: AuthContext, entryId: string): Promise<KnowledgeEntryDto> {
  requireKnowledgeView(auth);
  const entry = await getEntryById(db, auth, entryId);
  if (!entry || !canReadEntry(auth, entry)) {
    throw knowledgeEntryNotFound(entryId);
  }
  return entry;
}

/** Binding screens retain missing identities, but never expose private entry metadata. */
export async function getKnowledgeBinding(db: Queryable, auth: AuthContext, entryId: string) {
  requireKnowledgeView(auth);
  const entry = await getEntryById(db, auth, entryId);
  return { entry: entry && canReadEntry(auth, entry) ? entry : null, deleted: !entry };
}

export async function listKnowledgeRevisions(db: Queryable, auth: AuthContext, entryId: string) {
  await getKnowledgeEntry(db, auth, entryId);
  return listRevisions(db, auth, entryId);
}

export async function restoreKnowledgeRevision(
  db: Database,
  auth: AuthContext,
  entryId: string,
  revisionId: string,
  input: { expectedHeadRevisionNumber: number },
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  const invocation = knowledgeServiceInvocation(auth);
  requireKnowledgeEdit(auth);

  await db.transaction(async (tx) => {
    const entry = await getEntryForUpdate(tx, auth, entryId);
    if (!entry || !canReadEntry(auth, entry)) {
      throw knowledgeEntryNotFound(entryId);
    }
    requireKnowledgeGovern(auth, entry);

    if (entry.status === "archived") {
      throw new ApiError("VALIDATION_FAILED", "Archived knowledge entries cannot be edited. Restore the entry first.", {
        reason: "knowledge-entry-archived",
        entryId,
        status: entry.status
      });
    }
    if (entry.headRevisionNumber !== input.expectedHeadRevisionNumber) {
      throw revisionConflict(entryId, input.expectedHeadRevisionNumber, entry.headRevisionNumber);
    }

    const revision = await getRevisionById(tx, auth, entryId, revisionId);
    if (!revision) {
      throw new ApiError("NOT_FOUND", "Knowledge revision was not found.", { entryId, revisionId });
    }

    const nextRevisionNumber = entry.headRevisionNumber + 1;
    const newRevisionId = randomUUID();
    await insertRevision(tx, auth, {
      id: newRevisionId,
      entryId,
      revisionNumber: nextRevisionNumber,
      title: revision.title,
      tags: revision.tags,
      contentMarkdown: revision.contentMarkdown,
      fileId: revision.fileId,
      restoredFromRevisionId: revision.id
    });

    let searchContent: string | null = revision.contentMarkdown;
    if (entry.contentForm === "file" && revision.fileId) {
      const revisionFile = await getFileByIdForSearch(tx, auth, revision.fileId);
      searchContent = revisionFile;
    }
    await setEntryHead(tx, auth, {
      entryId,
      headRevisionId: newRevisionId,
      headRevisionNumber: nextRevisionNumber,
      title: revision.title,
      tags: revision.tags,
      searchText: buildSearchText({ title: revision.title, tags: revision.tags, content: searchContent })
    });

    await writeKnowledgeAudit(
      asAuditTx(tx),
      invocation,
      {
        kind: "knowledge-revision-restore",
        action: "restore-revision",
        entryId,
        metadata: {
          restoredFromRevisionId: revision.id,
          restoredFromRevisionNumber: revision.revisionNumber,
          revisionNumber: nextRevisionNumber,
          title: revision.title
        }
      },
      context
    );
  });

  const entry = await getEntryById(db, auth, entryId);
  if (!entry) throw knowledgeEntryNotFound(entryId);
  return entry;
}

async function getFileByIdForSearch(tx: Queryable, auth: AuthContext, fileId: string): Promise<string | null> {
  const result = await tx.query<{ extracted_text: string | null; extraction_status: string }>(
    `
    select extracted_text, extraction_status
    from knowledge_files
    where organization_id = $1
      and id = $2
    limit 1
    `,
    [knowledgeOrganizationId(auth), fileId]
  );
  const row = result.rows[0];
  return row && row.extraction_status === "succeeded" ? row.extracted_text : null;
}

export async function getKnowledgeFileContent(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  entryId: string,
  revisionId?: string
): Promise<{ file: KnowledgeFileDto; bytes: Buffer }> {
  const entry = await getKnowledgeEntry(db, auth, entryId);
  // Same current-entry authorization as listKnowledgeRevisions; never bypass it for a pinned file.
  const revision = revisionId ? await getRevisionById(db, auth, entryId, revisionId) : null;
  if (revisionId && !revision) {
    throw new ApiError("NOT_FOUND", "Knowledge revision was not found.", { entryId, revisionId });
  }
  const file = revision ? (revision.fileId ? await getFileById(db, auth, revision.fileId) : null) : entry.file;
  if (entry.contentForm !== "file" || !file) {
    throw new ApiError("VALIDATION_FAILED", "Knowledge entry has no file content.", { entryId });
  }

  return {
    file,
    bytes: await objectStore.get(file.storageKey)
  };
}

/**
 * Hybrid retrieval behind the existing search endpoint: when embeddings are
 * configured AND pgvector is available, the vector ranking is fused with the
 * FTS/trigram ranking via reciprocal-rank fusion; otherwise the Phase 1
 * FTS-only path runs unchanged. The response reports the mode that actually
 * ran so the UI can state it honestly.
 */
export async function searchKnowledge(
  db: Queryable,
  auth: AuthContext,
  query: { q: string; limit?: number },
  options: { embeddingClient?: KnowledgeEmbeddingClient } = {}
): Promise<KnowledgeSearchResponseDto> {
  requireKnowledgeView(auth);

  const limit = query.limit ?? 20;
  const ftsItems = await searchPublishedEntries(db, auth, query);
  const vectorAvailable = await hasKnowledgeVectorSupport(db).catch(() => false);
  const embeddingConfigured = Boolean(options.embeddingClient);

  if (!vectorAvailable || !options.embeddingClient) {
    return {
      items: ftsItems,
      retrieval: { mode: "fts_only", vectorAvailable, embeddingConfigured }
    };
  }

  try {
    const [queryEmbedding] = await options.embeddingClient.embed([query.q.trim()]);
    const vectorItems = await searchPublishedChunksByEmbedding(db, auth, {
      embedding: queryEmbedding,
      limit
    });
    return {
      items: fuseKnowledgeSearchResults({ fts: ftsItems, vector: vectorItems, limit }),
      retrieval: { mode: "semantic_fts", vectorAvailable, embeddingConfigured }
    };
  } catch (error) {
    // Per-query degradation stays honest: the FTS results are still valid.
    return {
      items: ftsItems,
      retrieval: {
        mode: "fts_only",
        vectorAvailable,
        embeddingConfigured,
        degradedReason: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

/**
 * Related-knowledge recommendations for a completed log-analysis record
 * (design deferred roadmap item 1). Pure read: the caller needs
 * `knowledge:view`, and reading the source record enforces `logs:view` plus
 * organization scope through the logs service — no audit event, matching
 * `searchKnowledge`. The similarity query derives from the stored
 * conclusion/impact text only; retrieval reuses the hybrid machinery
 * (trigram ranking fused with vector ranking when embeddings run, trigram-only
 * otherwise) with relevance cutoffs so unrelated entries are dropped rather
 * than padded in, and the response reports the mode that actually ran.
 */
export async function findRelatedKnowledgeForLog(
  db: Queryable,
  auth: AuthContext,
  input: { logId: string; limit?: number },
  options: { embeddingClient?: KnowledgeEmbeddingClient } = {}
): Promise<KnowledgeSearchResponseDto> {
  requireKnowledgeView(auth);

  const log = await getLogRecord(db, auth.knowledgeInvocation ? withLogInvocation(auth, auth.knowledgeInvocation) : auth, input.logId);
  if (log.status !== "complete") {
    throw new ApiError("VALIDATION_FAILED", "Only completed log analyses have related knowledge.", {
      logId: input.logId,
      status: log.status
    });
  }

  const limit = input.limit ?? RELATED_KNOWLEDGE_DEFAULT_LIMIT;
  const query = deriveRelatedKnowledgeQuery(log);
  const vectorAvailable = await hasKnowledgeVectorSupport(db).catch(() => false);
  const embeddingConfigured = Boolean(options.embeddingClient);

  if (!query) {
    return {
      items: [],
      retrieval: {
        mode: vectorAvailable && embeddingConfigured ? "semantic_fts" : "fts_only",
        vectorAvailable,
        embeddingConfigured
      }
    };
  }

  const textItems = await searchPublishedEntriesByTextSimilarity(db, auth, {
    q: query,
    minSimilarity: RELATED_KNOWLEDGE_MIN_TEXT_SIMILARITY,
    limit
  });

  if (!vectorAvailable || !options.embeddingClient) {
    return { items: textItems, retrieval: { mode: "fts_only", vectorAvailable, embeddingConfigured } };
  }

  try {
    const [queryEmbedding] = await options.embeddingClient.embed([query]);
    const vectorItems = await searchPublishedChunksByEmbedding(db, auth, {
      embedding: queryEmbedding,
      limit,
      maxDistance: RELATED_KNOWLEDGE_MAX_VECTOR_DISTANCE
    });
    return {
      items: fuseKnowledgeSearchResults({ fts: textItems, vector: vectorItems, limit }),
      retrieval: { mode: "semantic_fts", vectorAvailable, embeddingConfigured }
    };
  } catch (error) {
    // Per-query degradation stays honest: the trigram results are still valid.
    return {
      items: textItems,
      retrieval: {
        mode: "fts_only",
        vectorAvailable,
        embeddingConfigured,
        degradedReason: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

/**
 * Read surface for the Xiaoze knowledge.getDocument tool: strictly published
 * entries only (D13) — drafts stay invisible to agents even for their owner.
 */
export async function getPublishedKnowledgeDocument(
  db: Queryable,
  auth: AuthContext,
  entryId: string
): Promise<{ entry: KnowledgeEntryDto; contentText: string }> {
  const entry = await getKnowledgeEntry(db, auth, entryId);
  if (entry.status !== "published") {
    throw knowledgeEntryNotFound(entryId);
  }

  let contentText = entry.contentMarkdown ?? "";
  if (entry.contentForm === "file" && entry.file) {
    contentText =
      entry.file.extractionStatus === "succeeded"
        ? (await getFileByIdForSearch(db, auth, entry.file.id)) ?? ""
        : "";
  }
  return { entry, contentText };
}

export type KnowledgeIndexHealthDto = {
  retrieval: KnowledgeRetrievalInfo;
  items: Array<KnowledgeIndexStatusDto & { title: string; entryStatus: string }>;
};

/** Index health is a governance surface: knowledge:manage only. */
export async function getKnowledgeIndexHealth(
  db: Queryable,
  auth: AuthContext,
  options: { embeddingClient?: KnowledgeEmbeddingClient } = {}
): Promise<KnowledgeIndexHealthDto> {
  requireKnowledgeManage(auth);
  const vectorAvailable = await hasKnowledgeVectorSupport(db).catch(() => false);
  const embeddingConfigured = Boolean(options.embeddingClient);
  return {
    retrieval: {
      mode: vectorAvailable && embeddingConfigured ? "semantic_fts" : "fts_only",
      vectorAvailable,
      embeddingConfigured
    },
    items: await listIndexStatuses(db, knowledgeOrganizationId(auth))
  };
}

export async function retryKnowledgeEntryIndex(
  db: Database,
  auth: AuthContext,
  entryId: string,
  context: KnowledgeServiceContext = {}
): Promise<void> {
  const invocation = knowledgeServiceInvocation(auth);
  requireKnowledgeManage(auth);
  await db.transaction(async (tx) => {
    const entry = await getEntryById(tx, auth, entryId);
    if (!entry) {
      throw knowledgeEntryNotFound(entryId);
    }
    await enqueueEntryIndexRefresh(tx, { entryId, organizationId: knowledgeOrganizationId(auth) });
    await writeKnowledgeAudit(
      asAuditTx(tx),
      invocation,
      {
        kind: "knowledge-index-retry",
        action: "index-retry",
        entryId,
        metadata: { title: entry.title, status: entry.status }
      },
      context
    );
  });
}

/** Rebuild-all maintenance action (e.g. after changing the embedding model). */
export async function rebuildKnowledgeIndex(
  db: Database,
  auth: AuthContext,
  invocation: TrustedInvocationContext,
  context: KnowledgeServiceContext = {}
): Promise<{ enqueued: number }> {
  assertKnowledgeInvocationMatches(auth, invocation, "Knowledge index rebuild");
  requireKnowledgeManage(auth);
  let enqueued = 0;
  await db.transaction(async (tx) => {
    enqueued = await enqueueAllPublishedEntries(tx, knowledgeOrganizationId(auth));
    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId: context.requestId ?? randomUUID() }, {
      app: "knowledge",
      kind: "knowledge-index-rebuild",
      action: "index-rebuild",
      severity: "Medium",
      projectId: null,
      targetType: "knowledge-index",
      targetId: knowledgeOrganizationId(auth),
      metadata: { enqueued }
    });
  });
  return { enqueued };
}

export async function rescanKnowledgeReferenceSuggestions(
  db: Database, auth: AuthContext, invocation: TrustedInvocationContext,
  context: KnowledgeServiceContext = {}
): Promise<{ enqueued: number }> {
  assertKnowledgeInvocationMatches(auth, invocation, "Knowledge reference suggestions rescan");
  requireKnowledgeManage(auth);
  const requestId = context.requestId ?? randomUUID();
  const result = await db.transaction(async (tx) => {
    const enqueued = await countReferenceSuggestionRescanEntries(tx, knowledgeOrganizationId(auth));
    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId }, {
      app: "knowledge",
      kind: "knowledge-reference-suggestions-rescan",
      action: "reference-suggestions-rescan",
      severity: "Medium",
      projectId: null,
      targetType: "knowledge-reference-suggestions",
      targetId: knowledgeOrganizationId(auth),
      metadata: { enqueued }
    });
    return { enqueued };
  });
  void scanKnowledgeReferenceSuggestions(db, { organizationId: knowledgeOrganizationId(auth), requestId }).catch((error) => {
    console.error("[knowledge-reference-suggestions] Organization rescan failed:", { requestId, error });
  });
  return result;
}
