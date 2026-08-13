import { randomUUID } from "node:crypto";

import { withAuditedWrite } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { parseDts, serializeDts } from "../dts";
import type { ObjectStore } from "../logs/objectStore";
import { canAdminParameters } from "../parameter-kernel/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { loadConfigSetSnapshot } from "./configSetSnapshot";
import { getConfigSetById } from "./configSetRepository";
import {
  createSubprocessDtcValidator,
  readDtsValidationMode,
  type DtcValidator,
  type ValidationMode
} from "./dtcValidator";
import { getFileVersionById, getProjectParameterFileById } from "./repository";
import type { ConfigSetRole, ParameterFileFormat } from "./types";

export type ExportServiceContext = AuditCorrelationContext;

export type ExportFileResult = {
  fileId: string;
  fileName: string;
  format: ParameterFileFormat;
  versionNumber: number;
  content: string;
};

export type ExportConfigSetManifestMember = {
  fileId: string;
  fileName: string;
  role: ConfigSetRole;
  sortOrder: number;
  versionNumber: number;
  format: ParameterFileFormat;
};

export type ExportConfigSetManifest = {
  configSetId: string;
  name: string;
  projectId: string;
  exportedAt: string;
  validation?: {
    ok: boolean;
    mode: ValidationMode;
    compiler: "dtc" | "unavailable";
    requiresConfirmation?: boolean;
  };
  members: ExportConfigSetManifestMember[];
};

export type ExportConfigSetFile = {
  name: string;
  format: ParameterFileFormat;
  content: string;
};

export type ExportConfigSetResult = {
  manifest: ExportConfigSetManifest;
  files: ExportConfigSetFile[];
};

export type ExportFileDeps = {
  objectStore: ObjectStore;
};

export type ExportConfigSetDeps = {
  objectStore: ObjectStore;
  validator?: DtcValidator;
};

function requireParameterFileAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" });
  }
}

function formatExportedContent(format: ParameterFileFormat, source: string): string {
  if (format === "dts") {
    return serializeDts(parseDts(source));
  }
  return source;
}

function computeRequiresConfirmation(result: {
  ok: boolean;
  mode: ValidationMode;
  compiler: "dtc" | "unavailable";
}) {
  if (result.mode === "off") {
    return false;
  }
  if (result.mode === "warn") {
    return true;
  }
  if (result.compiler === "unavailable" && result.ok) {
    return true;
  }
  return false;
}

async function loadVersionSource(objectStore: ObjectStore, storageKey: string): Promise<string> {
  const bytes = await objectStore.get(storageKey);
  return bytes.toString("utf8");
}

async function writeExportAudit(
  db: Database,
  auth: AuthContext,
  input: {
    action: "file" | "config-set";
    projectId: string | null;
    targetId: string;
    metadata: Record<string, unknown>;
  },
  context: ExportServiceContext = {}
) {
  // Exports have no domain write; the audit event is the only persistent effect,
  // so it gets an audited write of its own (ADR-0027). requestId fallback survives
  // only until export contexts become mandatory.
  await withAuditedWrite(db, auth, { requestId: context.requestId ?? randomUUID() }, async () => ({
    result: undefined,
    audit: {
      app: "parameters",
      kind: "export",
      action: input.action,
      severity: "Medium",
      projectId: input.projectId,
      targetType: input.action === "file" ? "project-parameter-file" : "dts-config-set",
      targetId: input.targetId,
      metadata: input.metadata
    }
  }));
}

export async function exportFile(
  db: Database,
  auth: AuthContext,
  fileId: string,
  deps: ExportFileDeps,
  context: ExportServiceContext = {}
): Promise<ExportFileResult> {
  requireParameterFileAdmin(auth);

  const file = await getProjectParameterFileById(db, {
    organizationId: auth.organization.id,
    fileId
  });
  if (!file) {
    throw new ApiError("NOT_FOUND", "Parameter file not found.", 404, { fileId });
  }
  if (!file.currentVersionId) {
    throw new ApiError("CONFLICT", "Parameter file has no current version to export.", 409, { fileId });
  }

  const version = await getFileVersionById(db, { versionId: file.currentVersionId });
  if (!version) {
    throw new ApiError("NOT_FOUND", "Parameter file version not found.", 404, {
      fileId,
      versionId: file.currentVersionId
    });
  }

  const source = await loadVersionSource(deps.objectStore, version.storageKey);
  const content = formatExportedContent(file.format, source);

  await writeExportAudit(
    db,
    auth,
    {
      action: "file",
      projectId: file.projectId,
      targetId: file.id,
      metadata: {
        fileName: file.fileName,
        format: file.format,
        versionNumber: version.versionNumber
      }
    },
    context
  );

  return {
    fileId: file.id,
    fileName: file.fileName,
    format: file.format,
    versionNumber: version.versionNumber,
    content
  };
}

export async function exportConfigSet(
  db: Database,
  auth: AuthContext,
  configSetId: string,
  deps: ExportConfigSetDeps,
  context: ExportServiceContext = {}
): Promise<ExportConfigSetResult> {
  requireParameterFileAdmin(auth);

  const configSet = await getConfigSetById(db, {
    organizationId: auth.organization.id,
    configSetId
  });
  if (!configSet) {
    throw new ApiError("NOT_FOUND", "Config set not found.", 404, { configSetId });
  }

  const snapshot = await loadConfigSetSnapshot(db, deps.objectStore, configSetId);
  const manifestMembers: ExportConfigSetManifestMember[] = [];
  const files: ExportConfigSetFile[] = [];
  const dtsFilesForValidation: Array<{ name: string; content: string }> = [];

  for (const member of snapshot.members) {
    const content = formatExportedContent(member.format, member.content);

    manifestMembers.push({
      fileId: member.fileId,
      fileName: member.fileName,
      role: member.role,
      sortOrder: member.sortOrder,
      versionNumber: member.versionNumber,
      format: member.format
    });

    files.push({
      name: member.fileName,
      format: member.format,
      content
    });

    if (member.format === "dts") {
      dtsFilesForValidation.push({ name: member.fileName, content });
    }
  }

  const validator = deps.validator ?? createSubprocessDtcValidator();
  const mode = readDtsValidationMode();
  const validation = await validator.validate(dtsFilesForValidation, { mode });
  const requiresConfirmation = computeRequiresConfirmation(validation);

  const manifest: ExportConfigSetManifest = {
    configSetId: configSet.id,
    name: configSet.name,
    projectId: configSet.projectId,
    exportedAt: new Date().toISOString(),
    validation: {
      ok: validation.ok,
      mode: validation.mode,
      compiler: validation.compiler,
      requiresConfirmation
    },
    members: manifestMembers
  };

  await writeExportAudit(
    db,
    auth,
    {
      action: "config-set",
      projectId: configSet.projectId,
      targetId: configSet.id,
      metadata: {
        name: configSet.name,
        memberCount: manifestMembers.length,
        validationOk: validation.ok,
        validationMode: validation.mode,
        compiler: validation.compiler
      }
    },
    context
  );

  return { manifest, files };
}
