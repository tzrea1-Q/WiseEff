import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { listConfigSetMemberFiles } from "./baselineRepository";
import { getConfigSetById } from "./configSetRepository";
import {
  createSubprocessDtcValidator,
  readDtsValidationMode,
  type DtcDiagnostic,
  type DtcValidator,
  type ValidationMode
} from "./dtcValidator";
import { getFileVersionById, getProjectParameterFileById } from "./repository";

export type ValidationGateResult = {
  ok: boolean;
  mode: ValidationMode;
  requiresConfirmation: boolean;
  diagnostics: DtcDiagnostic[];
  compiler: "dtc" | "unavailable";
};

export type ValidationGateInput = {
  configSetId: string;
  mode?: ValidationMode;
};

export type ValidationGateDeps = {
  objectStore: ObjectStore;
  validator?: DtcValidator;
};

function countErrors(diagnostics: DtcDiagnostic[]) {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
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

async function writeValidationGateAudit(
  db: Queryable,
  auth: AuthContext,
  input: {
    configSetId: string;
    projectId: string | null;
    ok: boolean;
    mode: ValidationMode;
    compiler: "dtc" | "unavailable";
    diagnostics: DtcDiagnostic[];
    requiresConfirmation: boolean;
  },
  context: AuditCorrelationContext = {}
) {
  const errorCount = countErrors(input.diagnostics);
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: auth.organization.id,
    projectId: input.projectId,
    actorUserId: auth.user.id,
    actorType: "user",
    app: "parameters",
    kind: "validation.gate",
    action: "run",
    severity: input.ok ? "Medium" : "High",
    targetType: "dts-config-set",
    targetId: input.configSetId,
    metadata: {
      ok: input.ok,
      mode: input.mode,
      compiler: input.compiler,
      diagnosticCount: input.diagnostics.length,
      errorCount,
      requiresConfirmation: input.requiresConfirmation
    },
    traceId: context.requestId ?? randomUUID()
  });
}

export async function runValidationGate(
  db: Database,
  auth: AuthContext,
  input: ValidationGateInput,
  deps: ValidationGateDeps,
  context: AuditCorrelationContext = {}
): Promise<ValidationGateResult> {
  const configSet = await getConfigSetById(db, {
    organizationId: auth.organization.id,
    configSetId: input.configSetId
  });
  if (!configSet) {
    throw new ApiError("NOT_FOUND", "Config set not found.", 404, { configSetId: input.configSetId });
  }

  const members = await listConfigSetMemberFiles(db, input.configSetId);
  const validator = deps.validator ?? createSubprocessDtcValidator();
  const mode = input.mode ?? readDtsValidationMode();

  const dtsFiles: Array<{ name: string; content: string }> = [];
  for (const member of members) {
    if (!member.currentVersionId) {
      continue;
    }

    const file = await getProjectParameterFileById(db, {
      organizationId: auth.organization.id,
      fileId: member.fileId
    });
    if (!file || file.format !== "dts") {
      continue;
    }

    const version = await getFileVersionById(db, { versionId: member.currentVersionId });
    if (!version) {
      continue;
    }

    const content = await deps.objectStore.get(version.storageKey);
    dtsFiles.push({ name: member.fileName, content: content.toString("utf8") });
  }

  const validation = await validator.validate(dtsFiles, { mode });
  const requiresConfirmation = computeRequiresConfirmation(validation);

  await writeValidationGateAudit(
    db,
    auth,
    {
      configSetId: input.configSetId,
      projectId: configSet.projectId,
      ok: validation.ok,
      mode: validation.mode,
      compiler: validation.compiler,
      diagnostics: validation.diagnostics,
      requiresConfirmation
    },
    context
  );

  if (!validation.ok) {
    throw new ApiError("CONFLICT", "DTS validation failed.", 409, {
      code: "dts-validation-failed",
      diagnostics: validation.diagnostics,
      mode: validation.mode,
      compiler: validation.compiler
    });
  }

  return {
    ok: validation.ok,
    mode: validation.mode,
    requiresConfirmation,
    diagnostics: validation.diagnostics,
    compiler: validation.compiler
  };
}
