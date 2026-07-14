import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { buildDtsParsedIndex, buildJsonParsedIndex } from "./parseIndex";
import { getFileVersionById, getProjectParameterFileByName, insertFileVersion, setCurrentVersion } from "./repository";
import type { ParameterFileFormat } from "./types";

type WritebackSource = {
  sourceFileName: string | null;
  sourceNodePath: string | null;
};

export type WritebackMergedParameterValueInput = {
  projectId: string;
  parameterDefinitionId: string;
  mergedValue: string;
};

export type WritebackServiceContext = AuditCorrelationContext;

function splitNodePath(nodePath: string) {
  return nodePath.split("/").map((segment) => segment.trim()).filter(Boolean);
}

function parseMergedValue(newValue: string): unknown {
  const trimmed = newValue.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return newValue;
  }
}

function setNestedJsonLeaf(target: Record<string, unknown>, pathSegments: string[], value: unknown) {
  if (pathSegments.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "Parameter source node path is empty.", 400);
  }

  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const segment = pathSegments[index];
    const next = cursor[segment];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      throw new ApiError("CONFLICT", "Cannot write back to non-object JSON path segment.", 409, {
        segment,
        nodePath: pathSegments.join("/")
      });
    }
    cursor = next as Record<string, unknown>;
  }

  cursor[pathSegments[pathSegments.length - 1]] = value;
}

function findMatchingBrace(source: string, startAt: number): number {
  let depth = 0;
  for (let index = startAt; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findNamedBlock(source: string, blockName: string, fromIndex: number, toIndex: number) {
  const escaped = blockName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b\\s*\\{`, "g");
  pattern.lastIndex = fromIndex;

  while (true) {
    const match = pattern.exec(source);
    if (!match || match.index >= toIndex) {
      return null;
    }
    const openBraceIndex = pattern.lastIndex - 1;
    if (openBraceIndex >= toIndex) {
      return null;
    }
    const closeBraceIndex = findMatchingBrace(source, openBraceIndex);
    if (closeBraceIndex === -1 || closeBraceIndex >= toIndex) {
      return null;
    }
    return {
      contentStart: openBraceIndex + 1,
      contentEnd: closeBraceIndex
    };
  }
}

function patchByFormat(content: string, format: ParameterFileFormat, nodePath: string, newValue: string): Buffer {
  if (format === "json") {
    return patchJsonValue(content, nodePath, newValue);
  }
  if (format === "dts") {
    return patchDtsProperty(content, nodePath, newValue);
  }
  throw new ApiError("VALIDATION_FAILED", "Unsupported parameter file format for writeback.", 400, { format });
}

function contentTypeForFormat(format: ParameterFileFormat) {
  return format === "json" ? "application/json" : "text/plain";
}

async function loadWritebackSource(
  db: Queryable,
  auth: AuthContext,
  input: Pick<WritebackMergedParameterValueInput, "projectId" | "parameterDefinitionId">
): Promise<WritebackSource | null> {
  const result = await db.query<{
    source_file_name: string | null;
    source_node_path: string | null;
  }>(
    `
    select source_file_name, source_node_path
    from project_parameter_values
    where organization_id = $1
      and project_id = $2
      and parameter_definition_id = $3
    limit 1
    `,
    [auth.organization.id, input.projectId, input.parameterDefinitionId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    sourceFileName: row.source_file_name,
    sourceNodePath: row.source_node_path
  };
}

async function createWritebackAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    projectId: string;
    parameterDefinitionId: string;
    nodePath: string;
    fileId: string;
    fileName: string;
    versionNumber: number;
  },
  context: WritebackServiceContext = {}
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameters",
    kind: "parameter-writeback-to-file",
    action: "writeback",
    severity: "Medium",
    targetType: "project-parameter-file",
    targetId: input.fileId,
    metadata: {
      fileName: input.fileName,
      parameterDefinitionId: input.parameterDefinitionId,
      sourceNodePath: input.nodePath,
      versionNumber: input.versionNumber
    },
    traceId: context.requestId ?? randomUUID()
  });
}

export function patchJsonValue(content: string, nodePath: string, newValue: string): Buffer {
  const parsed = JSON.parse(content) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError("VALIDATION_FAILED", "JSON parameter file root must be an object.", 400);
  }

  const pathSegments = splitNodePath(nodePath);
  setNestedJsonLeaf(parsed as Record<string, unknown>, pathSegments, parseMergedValue(newValue));
  return Buffer.from(JSON.stringify(parsed, null, 2), "utf8");
}

export function patchDtsProperty(content: string, nodePath: string, newValue: string): Buffer {
  const pathSegments = splitNodePath(nodePath);
  if (pathSegments.length < 2) {
    throw new ApiError("VALIDATION_FAILED", "DTS writeback requires module/property node path.", 400, { nodePath });
  }

  const propertyName = pathSegments[pathSegments.length - 1];
  const modulePath = pathSegments.slice(0, -1);

  let scopeStart = 0;
  let scopeEnd = content.length;
  for (const segment of modulePath) {
    const block = findNamedBlock(content, segment, scopeStart, scopeEnd);
    if (!block) {
      throw new ApiError("CONFLICT", "Unable to locate DTS module path for writeback.", 409, {
        nodePath,
        missingSegment: segment
      });
    }
    scopeStart = block.contentStart;
    scopeEnd = block.contentEnd;
  }

  const blockContent = content.slice(scopeStart, scopeEnd);
  const escapedProperty = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyPattern = new RegExp(`(\\b${escapedProperty}\\b\\s*=\\s*)([^;\\n\\r]*)(\\s*;?)`);
  if (!propertyPattern.test(blockContent)) {
    throw new ApiError("CONFLICT", "Unable to locate DTS property for writeback.", 409, {
      nodePath,
      propertyName
    });
  }

  const updatedBlock = blockContent.replace(propertyPattern, (_full, prefix: string, _oldValue: string, suffix: string) => {
    return `${prefix}${newValue}${suffix}`;
  });
  return Buffer.from(`${content.slice(0, scopeStart)}${updatedBlock}${content.slice(scopeEnd)}`, "utf8");
}

export async function writebackMergedParameterValue(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: WritebackMergedParameterValueInput,
  context: WritebackServiceContext = {}
): Promise<{ skipped: true } | { skipped: false; fileId: string; versionId: string; versionNumber: number }> {
  const source = await loadWritebackSource(db, auth, input);
  if (!source) {
    throw new ApiError("NOT_FOUND", "Project parameter value for writeback was not found.", 404, {
      projectId: input.projectId,
      parameterDefinitionId: input.parameterDefinitionId
    });
  }
  if (!source.sourceFileName || !source.sourceNodePath) {
    return { skipped: true };
  }

  const file = await getProjectParameterFileByName(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    fileName: source.sourceFileName
  });
  if (!file) {
    throw new ApiError("NOT_FOUND", "Source project parameter file was not found for writeback.", 404, {
      sourceFileName: source.sourceFileName
    });
  }
  if (!file.currentVersionId) {
    throw new ApiError("CONFLICT", "Project parameter file has no current version for writeback.", 409, {
      fileId: file.id
    });
  }

  const currentVersion = await getFileVersionById(db, { versionId: file.currentVersionId });
  if (!currentVersion || currentVersion.fileId !== file.id) {
    throw new ApiError("NOT_FOUND", "Current project parameter file version was not found for writeback.", 404, {
      versionId: file.currentVersionId
    });
  }

  const currentBytes = await objectStore.get(currentVersion.storageKey);
  const patchedBytes = patchByFormat(currentBytes.toString("utf8"), file.format, source.sourceNodePath, input.mergedValue);
  const parsedIndex =
    file.format === "json"
      ? buildJsonParsedIndex(patchedBytes.toString("utf8"))
      : buildDtsParsedIndex(patchedBytes.toString("utf8"));
  const stored = await objectStore.put({
    organizationId: auth.organization.id,
    fileName: file.fileName,
    contentType: contentTypeForFormat(file.format),
    bytes: patchedBytes
  });

  const version = await insertFileVersion(db, {
    id: randomUUID(),
    fileId: file.id,
    versionNumber: (file.currentVersionNumber ?? 0) + 1,
    storageKey: stored.storageKey,
    checksum: stored.checksumSha256,
    sizeBytes: stored.fileSizeBytes,
    parsedIndex,
    origin: "writeback",
    createdByUserId: auth.user.id
  });

  await setCurrentVersion(db, { fileId: file.id, versionId: version.id });
  await createWritebackAudit(
    db,
    auth,
    {
      projectId: input.projectId,
      parameterDefinitionId: input.parameterDefinitionId,
      nodePath: source.sourceNodePath,
      fileId: file.id,
      fileName: file.fileName,
      versionNumber: version.versionNumber
    },
    context
  );

  return {
    skipped: false,
    fileId: file.id,
    versionId: version.id,
    versionNumber: version.versionNumber
  };
}
