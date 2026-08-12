import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext, AuditSeverity } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { KnowledgeTextExtractor } from "./extraction";
import {
  canReadEntry,
  hasKnowledgeManage,
  requireKnowledgeEdit,
  requireKnowledgeGovern,
  requireKnowledgeManage,
  requireKnowledgeView
} from "./policy";
import {
  deleteEntry,
  getEntryById,
  getEntryForUpdate,
  getRevisionById,
  insertEntry,
  insertFile,
  insertRevision,
  listEntries,
  listRevisions,
  searchPublishedEntries,
  setEntryHead,
  setEntrySearchText,
  setEntryStatus,
  updateFileExtraction
} from "./repository";
import type {
  KnowledgeEntryDto,
  KnowledgeFileDto,
  KnowledgeStatus,
  ListKnowledgeEntriesQuery
} from "./types";

export type KnowledgeServiceContext = AuditCorrelationContext;

export type KnowledgeFileUploadInput = {
  fileName: string;
  contentType: string;
  contentBase64: string;
};

export type CreateKnowledgeEntryInput =
  | { contentForm: "markdown"; title: string; tags: string[]; contentMarkdown: string }
  | { contentForm: "file"; title: string; tags: string[]; file: KnowledgeFileUploadInput };

export type UpdateKnowledgeEntryInput = {
  expectedHeadRevisionNumber: number;
  title?: string;
  tags?: string[];
  contentMarkdown?: string;
  file?: KnowledgeFileUploadInput;
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function knowledgeEntryNotFound(entryId: string) {
  return new ApiError("NOT_FOUND", "Knowledge entry was not found.", 404, { entryId });
}

function revisionConflict(entryId: string, expected: number, current: number) {
  return new ApiError("CONFLICT", "Knowledge entry was changed by another save. Reload the latest revision and retry.", 409, {
    code: "knowledge-revision-conflict",
    entryId,
    expectedHeadRevisionNumber: expected,
    currentHeadRevisionNumber: current
  });
}

function decodeFileUpload(input: KnowledgeFileUploadInput) {
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (bytes.byteLength === 0) {
    throw new ApiError("VALIDATION_FAILED", "Knowledge file content is empty.", 400, { fileName: input.fileName });
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ApiError("VALIDATION_FAILED", "Knowledge file exceeds the 20MB limit.", 400, {
      fileName: input.fileName,
      maxBytes: MAX_FILE_BYTES,
      sizeBytes: bytes.byteLength
    });
  }
  return bytes;
}

function buildSearchText(input: { title: string; tags: string[]; content: string | null }) {
  return [input.title, input.tags.join(" "), input.content ?? ""].join("\n").trim();
}

async function writeKnowledgeAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    kind: string;
    action: string;
    entryId: string;
    severity?: AuditSeverity;
    metadata?: Record<string, unknown>;
  },
  context: KnowledgeServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: null,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "knowledge",
    kind: input.kind,
    action: input.action,
    severity: input.severity ?? "Medium",
    targetType: "knowledge-entry",
    targetId: input.entryId,
    metadata: input.metadata ?? {},
    traceId: context.requestId ?? randomUUID()
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
      extractionError: outcome.status === "failed" ? outcome.reason : null
    });

    if (outcome.status === "succeeded") {
      const entry = await getEntryForUpdate(tx, auth, input.entryId);
      if (entry && entry.file?.id === input.file.id) {
        await setEntrySearchText(tx, auth, {
          entryId: input.entryId,
          searchText: buildSearchText({ title: entry.title, tags: entry.tags, content: outcome.text })
        });
      }
    }
  });
}

export async function createKnowledgeEntry(
  db: Database,
  objectStore: ObjectStore,
  extractor: KnowledgeTextExtractor,
  auth: AuthContext,
  input: CreateKnowledgeEntryInput,
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  requireKnowledgeEdit(auth);

  const entryId = randomUUID();
  const revisionId = randomUUID();

  if (input.contentForm === "markdown") {
    await db.transaction(async (tx) => {
      await insertEntry(tx, auth, {
        id: entryId,
        title: input.title,
        contentForm: "markdown",
        tags: input.tags,
        sourceType: "human",
        sourceSessionId: null,
        searchText: buildSearchText({ title: input.title, tags: input.tags, content: input.contentMarkdown })
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
        searchText: buildSearchText({ title: input.title, tags: input.tags, content: input.contentMarkdown })
      });
      await writeKnowledgeAudit(
        tx,
        auth,
        {
          kind: "knowledge-entry-create",
          action: "create",
          entryId,
          metadata: { contentForm: "markdown", title: input.title, tagCount: input.tags.length, revisionNumber: 1 }
        },
        context
      );
    });

    const entry = await getEntryById(db, auth, entryId);
    if (!entry) throw knowledgeEntryNotFound(entryId);
    return entry;
  }

  const bytes = decodeFileUpload(input.file);
  const stored = await objectStore.put({
    organizationId: auth.organization.id,
    fileName: input.file.fileName,
    contentType: input.file.contentType,
    bytes
  });

  const fileId = randomUUID();
  const storedFile = await db.transaction(async (tx) => {
    await insertEntry(tx, auth, {
      id: entryId,
      title: input.title,
      contentForm: "file",
      tags: input.tags,
      sourceType: "human",
      sourceSessionId: null,
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
      tx,
      auth,
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
          sizeBytes: stored.fileSizeBytes
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

export async function updateKnowledgeEntry(
  db: Database,
  objectStore: ObjectStore,
  extractor: KnowledgeTextExtractor,
  auth: AuthContext,
  entryId: string,
  input: UpdateKnowledgeEntryInput,
  context: KnowledgeServiceContext = {}
): Promise<KnowledgeEntryDto> {
  requireKnowledgeEdit(auth);

  let uploadedBytes: Buffer | null = null;
  let storedForExtraction: { file: KnowledgeFileDto; bytes: Buffer } | null = null;

  await db.transaction(async (tx) => {
    const entry = await getEntryForUpdate(tx, auth, entryId);
    if (!entry || !canReadEntry(auth, entry)) {
      throw knowledgeEntryNotFound(entryId);
    }
    requireKnowledgeGovern(auth, entry);

    if (entry.status === "archived") {
      throw new ApiError("VALIDATION_FAILED", "Archived knowledge entries cannot be edited. Restore the entry first.", 400, {
        entryId,
        status: entry.status
      });
    }
    if (entry.headRevisionNumber !== input.expectedHeadRevisionNumber) {
      throw revisionConflict(entryId, input.expectedHeadRevisionNumber, entry.headRevisionNumber);
    }
    if (entry.contentForm === "markdown" && input.file !== undefined) {
      throw new ApiError("VALIDATION_FAILED", "Markdown entries do not accept file replacements.", 400, { entryId });
    }
    if (entry.contentForm === "file" && input.contentMarkdown !== undefined) {
      throw new ApiError("VALIDATION_FAILED", "File entries do not accept markdown content. Replace the file instead.", 400, {
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
        uploadedBytes = decodeFileUpload(input.file);
        const stored = await objectStore.put({
          organizationId: auth.organization.id,
          fileName: input.file.fileName,
          contentType: input.file.contentType,
          bytes: uploadedBytes
        });
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
      tx,
      auth,
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
  });

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
        400,
        { entryId, currentStatus: entry.status, nextStatus: input.toStatus }
      );
    }

    await setEntryStatus(tx, auth, { entryId, status: input.toStatus });
    await writeKnowledgeAudit(
      tx,
      auth,
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
    entryId,
    { fromStatuses: ["published"], toStatus: "archived", kind: "knowledge-entry-archive", action: "archive" },
    context
  );
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
  requireKnowledgeManage(auth);

  await db.transaction(async (tx) => {
    const entry = await getEntryForUpdate(tx, auth, entryId);
    if (!entry) {
      throw knowledgeEntryNotFound(entryId);
    }

    await deleteEntry(tx, auth, entryId);
    await writeKnowledgeAudit(
      tx,
      auth,
      {
        kind: "knowledge-entry-delete",
        action: "delete",
        entryId,
        severity: "High",
        metadata: {
          title: entry.title,
          contentForm: entry.contentForm,
          status: entry.status,
          headRevisionNumber: entry.headRevisionNumber
        }
      },
      context
    );
  });
}

export async function listKnowledgeEntries(db: Queryable, auth: AuthContext, query: ListKnowledgeEntriesQuery = {}) {
  requireKnowledgeView(auth);
  return listEntries(db, auth, {
    ...query,
    visibleDraftOwnerUserId: hasKnowledgeManage(auth) ? undefined : auth.user.id
  });
}

export async function getKnowledgeEntry(db: Queryable, auth: AuthContext, entryId: string): Promise<KnowledgeEntryDto> {
  requireKnowledgeView(auth);
  const entry = await getEntryById(db, auth, entryId);
  if (!entry || !canReadEntry(auth, entry)) {
    throw knowledgeEntryNotFound(entryId);
  }
  return entry;
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
  requireKnowledgeEdit(auth);

  await db.transaction(async (tx) => {
    const entry = await getEntryForUpdate(tx, auth, entryId);
    if (!entry || !canReadEntry(auth, entry)) {
      throw knowledgeEntryNotFound(entryId);
    }
    requireKnowledgeGovern(auth, entry);

    if (entry.status === "archived") {
      throw new ApiError("VALIDATION_FAILED", "Archived knowledge entries cannot be edited. Restore the entry first.", 400, {
        entryId,
        status: entry.status
      });
    }
    if (entry.headRevisionNumber !== input.expectedHeadRevisionNumber) {
      throw revisionConflict(entryId, input.expectedHeadRevisionNumber, entry.headRevisionNumber);
    }

    const revision = await getRevisionById(tx, auth, entryId, revisionId);
    if (!revision) {
      throw new ApiError("NOT_FOUND", "Knowledge revision was not found.", 404, { entryId, revisionId });
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
      tx,
      auth,
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
    [auth.organization.id, fileId]
  );
  const row = result.rows[0];
  return row && row.extraction_status === "succeeded" ? row.extracted_text : null;
}

export async function getKnowledgeFileContent(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  entryId: string
): Promise<{ file: KnowledgeFileDto; bytes: Buffer }> {
  const entry = await getKnowledgeEntry(db, auth, entryId);
  if (entry.contentForm !== "file" || !entry.file) {
    throw new ApiError("VALIDATION_FAILED", "Knowledge entry has no file content.", 400, { entryId });
  }

  return {
    file: entry.file,
    bytes: await objectStore.get(entry.file.storageKey)
  };
}

export async function searchKnowledge(db: Queryable, auth: AuthContext, query: { q: string; limit?: number }) {
  requireKnowledgeView(auth);
  return searchPublishedEntries(db, auth, query);
}
