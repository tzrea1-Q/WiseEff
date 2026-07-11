import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { canAdminParameters } from "../parameters/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { buildDtsParsedIndex, buildJsonParsedIndex } from "./parseIndex";
import {
  getProjectParameterFileByName,
  insertFileVersion,
  insertProjectParameterFile,
  listProjectParameterFiles,
  setCurrentVersion
} from "./repository";
import { uploadProjectParameterFileInputSchema, type UploadProjectParameterFileInput } from "./schemas";
import type { ParameterFileFormat, ProjectParameterFileDto, ProjectParameterFileVersionDto } from "./types";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type ParameterFileServiceContext = AuditCorrelationContext;

type StoredVersionRef = {
  storageKey: string;
};

function requireParameterFileAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" });
  }
}

export function detectFormat(fileName: string): ParameterFileFormat {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".dts" || extension === ".dtsi") return "dts";
  throw new ApiError("VALIDATION_FAILED", "Unsupported parameter file extension.", 400, {
    fileName,
    supportedExtensions: [".json", ".dts", ".dtsi"]
  });
}

function contentTypeForFormat(format: ParameterFileFormat) {
  return format === "json" ? "application/json" : "text/plain";
}

function parseUploadInput(input: UploadProjectParameterFileInput): UploadProjectParameterFileInput {
  const parsed = uploadProjectParameterFileInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", "Invalid project parameter file upload input.", 400, {
      issues: parsed.error.issues
    });
  }
  return parsed.data;
}

function buildParsedIndex(format: ParameterFileFormat, bytes: Buffer) {
  const source = bytes.toString("utf8");
  try {
    return format === "json" ? buildJsonParsedIndex(source) : buildDtsParsedIndex(source);
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Failed to parse project parameter file content.", 400, {
      format
    });
  }
}

async function createParameterFileUploadAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    file: ProjectParameterFileDto;
    version: ProjectParameterFileVersionDto;
  },
  context: ParameterFileServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameters",
    kind: "parameter-file-upload",
    action: "upload",
    severity: "Medium",
    targetType: "project-parameter-file",
    targetId: input.file.id,
    metadata: {
      fileName: input.file.fileName,
      format: input.file.format,
      versionNumber: input.version.versionNumber,
      sizeBytes: input.version.sizeBytes
    },
    traceId: context.requestId ?? randomUUID()
  });
}

export async function uploadProjectParameterFile(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: UploadProjectParameterFileInput,
  context: ParameterFileServiceContext = {}
): Promise<{ file: ProjectParameterFileDto; version: ProjectParameterFileVersionDto }> {
  requireParameterFileAdmin(auth);
  const normalized = parseUploadInput(input);
  const format = detectFormat(normalized.fileName);
  const sizeBytes = normalized.bytes.byteLength;
  if (sizeBytes > MAX_FILE_BYTES) {
    throw new ApiError("VALIDATION_FAILED", "Project parameter file exceeds the 2MB limit.", 400, {
      maxBytes: MAX_FILE_BYTES,
      sizeBytes
    });
  }

  const parsedIndex = buildParsedIndex(format, normalized.bytes);

  return db.transaction(async (tx) => {
    const existing = await getProjectParameterFileByName(tx, {
      organizationId: auth.organization.id,
      projectId: normalized.projectId,
      fileName: normalized.fileName
    });
    const stored = await objectStore.put({
      organizationId: auth.organization.id,
      fileName: normalized.fileName,
      contentType: contentTypeForFormat(format),
      bytes: normalized.bytes
    });

    const file =
      existing ??
      (await insertProjectParameterFile(tx, {
        id: randomUUID(),
        organizationId: auth.organization.id,
        projectId: normalized.projectId,
        fileName: normalized.fileName,
        format
      }));

    const version = await insertFileVersion(tx, {
      id: randomUUID(),
      fileId: file.id,
      versionNumber: (file.currentVersionNumber ?? 0) + 1,
      storageKey: stored.storageKey,
      checksum: stored.checksumSha256,
      sizeBytes: stored.fileSizeBytes,
      parsedIndex,
      origin: "upload",
      createdByUserId: auth.user.id
    });

    await setCurrentVersion(tx, { fileId: file.id, versionId: version.id });
    await createParameterFileUploadAudit(
      tx,
      auth,
      {
        projectId: normalized.projectId,
        file: { ...file, currentVersionId: version.id, currentVersionNumber: version.versionNumber },
        version
      },
      context
    );

    return {
      file: { ...file, currentVersionId: version.id, currentVersionNumber: version.versionNumber },
      version
    };
  });
}

export function getProjectParameterFileContent(objectStore: ObjectStore, version: StoredVersionRef) {
  return objectStore.get(version.storageKey);
}

export async function listProjectParameterFilesForAuth(
  db: Queryable,
  auth: AuthContext,
  projectId: string
) {
  requireParameterFileAdmin(auth);
  return listProjectParameterFiles(db, {
    organizationId: auth.organization.id,
    projectId
  });
}
