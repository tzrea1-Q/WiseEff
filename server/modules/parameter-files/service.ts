import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { canAdminParameters } from "../parameters/policy";
import { ingestConfigRevisionInTransaction } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest, ConfigRevisionManifestMember } from "../parameter-topology/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { listConfigSetMemberFiles } from "./baselineRepository";
import { getConfigSetById, getFileConfigSetMembership } from "./configSetRepository";
import { buildDtsParsedIndex, buildJsonParsedIndex } from "./parseIndex";
import { syncFileVersion } from "./syncService";
import {
  getFileVersionById,
  getProjectParameterFileById,
  getProjectParameterFileByName,
  insertFileVersion,
  insertProjectParameterFile,
  listProjectParameterFiles,
  setCurrentVersion
} from "./repository";
import { uploadProjectParameterFileInputSchema, type UploadProjectParameterFileInput } from "./schemas";
import { isDtsStructuralIngestEnabled } from "./structuralFlag";
import { ingestDtsFileVersion } from "./structuralIngest";
import type {
  ConfigSetRole,
  ParameterFileFormat,
  ProjectParameterFileDto,
  ProjectParameterFileVersionDto
} from "./types";
import { detectUnsupportedDtsConstructs, type UnsupportedConstruct } from "./unsupported";

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

const OVERLAY_ROLES = new Set<ConfigSetRole>(["overlay", "charging", "thermal", "misc"]);

/**
 * After a member file version is frozen, ingest a semantic config revision only when the
 * complete config-set manifest is available (base entry + every member has a current version).
 * Isolated DTS uploads without config-set membership are skipped.
 */
async function maybeIngestSemanticConfigRevision(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: {
    fileId: string;
    frozenVersionId: string;
    frozenSource: string;
  }
): Promise<void> {
  const membership = await getFileConfigSetMembership(db, {
    organizationId: auth.organization.id,
    fileId: input.fileId
  });
  if (!membership?.configSetId) {
    return;
  }

  const configSet = await getConfigSetById(db, {
    organizationId: auth.organization.id,
    configSetId: membership.configSetId
  });
  if (!configSet) {
    return;
  }

  const memberFiles = await listConfigSetMemberFiles(db, membership.configSetId);
  if (memberFiles.length === 0 || memberFiles.some((member) => !member.currentVersionId)) {
    return;
  }

  const members: ConfigRevisionManifestMember[] = [];
  for (const member of memberFiles) {
    const file = await getProjectParameterFileById(db, {
      organizationId: auth.organization.id,
      fileId: member.fileId
    });
    if (!file || file.format !== "dts") {
      continue;
    }

    const fileMembership = await getFileConfigSetMembership(db, {
      organizationId: auth.organization.id,
      fileId: member.fileId
    });
    const role = fileMembership?.configSetRole ?? "misc";
    const versionId = member.currentVersionId as string;
    const version = await getFileVersionById(db, { versionId });
    if (!version) {
      return;
    }

    const content =
      versionId === input.frozenVersionId
        ? input.frozenSource
        : (await objectStore.get(version.storageKey)).toString("utf8");

    members.push({
      fileId: member.fileId,
      fileVersionId: versionId,
      fileName: member.fileName,
      role,
      sortOrder: fileMembership?.configSetSortOrder ?? 0,
      content
    });
  }

  const baseMembers = members
    .filter((member) => member.role === "base")
    .sort((a, b) => a.sortOrder - b.sortOrder || a.fileName.localeCompare(b.fileName));
  if (baseMembers.length === 0) {
    // Incomplete manifest: overlays/includes without a base entry are not ingestible alone.
    return;
  }

  const overlayOrder = members
    .filter((member) => OVERLAY_ROLES.has(member.role as ConfigSetRole))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.fileName.localeCompare(b.fileName))
    .map((member) => member.fileName);

  const manifest: ConfigRevisionManifest = {
    organizationId: auth.organization.id,
    projectId: configSet.projectId,
    configSetId: configSet.id,
    entryFile: baseMembers[0].fileName,
    includeSearchPaths: ["."],
    overlayOrder,
    members
  };

  await ingestConfigRevisionInTransaction(db, manifest, auth);
}

export async function uploadProjectParameterFile(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: UploadProjectParameterFileInput,
  context: ParameterFileServiceContext = {}
): Promise<{
  file: ProjectParameterFileDto;
  version: ProjectParameterFileVersionDto;
  unsupportedConstructs?: UnsupportedConstruct[];
}> {
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

  const source = normalized.bytes.toString("utf8");
  // `/include/` is resolved by `resolveDtsConfigSet`; single-file upload no longer
  // hard-rejects it. Remaining hard-unsupported constructs (if any) are still collected.
  const unsupportedConstructs =
    format === "dts" ? detectUnsupportedDtsConstructs(source) : [];

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
    if (format === "dts" && isDtsStructuralIngestEnabled()) {
      await ingestDtsFileVersion(tx, version.id, source);
    }
    if (format === "dts") {
      await maybeIngestSemanticConfigRevision(tx, objectStore, auth, {
        fileId: file.id,
        frozenVersionId: version.id,
        frozenSource: source
      });
    }
    if (version.origin === "upload" && unsupportedConstructs.length === 0) {
      await syncFileVersion(tx, auth, { fileId: file.id, versionId: version.id });
    }
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
      version,
      ...(unsupportedConstructs.length > 0 ? { unsupportedConstructs } : {})
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
