import { randomUUID } from "node:crypto";

import { createAuditEvent } from "../audit/repository";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { listConfigSetMemberFiles } from "./baselineRepository";
import { getConfigSetById, getFileConfigSetMembership } from "./configSetRepository";
import {
  readDtsValidationMode,
  type DtcDiagnostic,
  type DtcValidator,
  type ValidationMode
} from "./dtcValidator";
import {
  createDtsToolchainRunner,
  toToolchainMode,
  type DtsToolchainRunner,
  type DtsToolchainResult
} from "./dtsToolchain";
import { getFileVersionById, getProjectParameterFileById } from "./repository";

export type ValidationGateResult = {
  ok: boolean;
  mode: ValidationMode;
  requiresConfirmation: boolean;
  diagnostics: DtcDiagnostic[];
  compiler: "dtc" | "unavailable" | DtsToolchainResult["compiler"];
  artifacts?: DtsToolchainResult["artifacts"];
  failureCode?: DtsToolchainResult["failureCode"];
};

export type ValidationGateInput = {
  configSetId: string;
  mode?: ValidationMode;
  /** When true (releaseBaseline), warn/off are rejected before validation. */
  forRelease?: boolean;
};

export type ValidationGateDeps = {
  objectStore: ObjectStore;
  /** Legacy file-by-file stub/injector retained for unit tests. */
  validator?: DtcValidator;
  /** Preferred complete config-set toolchain runner. */
  toolchain?: DtsToolchainRunner;
};

function countErrors(diagnostics: DtcDiagnostic[]) {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
}

function computeRequiresConfirmation(result: {
  ok: boolean;
  mode: ValidationMode;
  compiler: ValidationGateResult["compiler"];
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
  if (
    typeof result.compiler === "object" &&
    result.ok &&
    (!result.compiler.dtc || !result.compiler.fdtoverlay || !result.compiler.dtschema)
  ) {
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
    compiler: ValidationGateResult["compiler"];
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

function toGateDiagnostics(result: DtsToolchainResult): DtcDiagnostic[] {
  return result.diagnostics.map((diagnostic) => ({
    file: diagnostic.file,
    line: diagnostic.line,
    severity: diagnostic.severity,
    message: diagnostic.message
  }));
}

function compilerSummary(result: DtsToolchainResult): ValidationGateResult["compiler"] {
  if (!result.compiler.dtc && !result.compiler.fdtoverlay && !result.compiler.dtschema) {
    return "unavailable";
  }
  return result.compiler;
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

  const mode = input.mode ?? readDtsValidationMode();

  if (input.forRelease && (mode === "warn" || mode === "off")) {
    throw new ApiError(
      "CONFLICT",
      "Release baseline rejects warn/off DTS validation; fail-closed release mode is required.",
      409,
      { code: "dts-release-mode-required", mode }
    );
  }

  const members = await listConfigSetMemberFiles(db, input.configSetId);

  // Prefer injected legacy validator for focused unit tests.
  if (deps.validator) {
    const validator = deps.validator;
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

  const toolchain = deps.toolchain ?? createDtsToolchainRunner();
  const files = new Map<string, { content: string }>();
  const overlays: Array<{ name: string; sortOrder: number }> = [];
  let entryFile: string | null = null;
  let entrySort = Number.POSITIVE_INFINITY;

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

    const membership = await getFileConfigSetMembership(db, {
      organizationId: auth.organization.id,
      fileId: member.fileId
    });
    const role = membership?.configSetRole ?? "misc";
    const sortOrder = membership?.configSetSortOrder ?? 0;
    const content = (await deps.objectStore.get(version.storageKey)).toString("utf8");
    files.set(member.fileName, { content });

    if (role === "base" && sortOrder <= entrySort) {
      entryFile = member.fileName;
      entrySort = sortOrder;
    } else if (role === "overlay") {
      overlays.push({ name: member.fileName, sortOrder });
    }
  }

  if (!entryFile) {
    // Fall back to first file when roles are not annotated (legacy config sets).
    entryFile = [...files.keys()][0] ?? null;
  }

  if (!entryFile || files.size === 0) {
    // Release/baseline must never soft-pass an empty Config Set.
    if (input.forRelease || mode === "block") {
      const diagnostics: DtcDiagnostic[] = [
        {
          file: "<config-set>",
          severity: "error",
          message: "Config set has no DTS members to validate."
        }
      ];
      await writeValidationGateAudit(
        db,
        auth,
        {
          configSetId: input.configSetId,
          projectId: configSet.projectId,
          ok: false,
          mode,
          compiler: "unavailable",
          diagnostics,
          requiresConfirmation: false
        },
        context
      );
      throw new ApiError("CONFLICT", "Empty config set cannot be released.", 409, {
        code: "dts-empty-config-set",
        diagnostics,
        mode,
        compiler: "unavailable"
      });
    }

    const empty: ValidationGateResult = {
      ok: true,
      mode,
      requiresConfirmation: mode === "warn",
      diagnostics: [],
      compiler: "unavailable"
    };
    await writeValidationGateAudit(
      db,
      auth,
      {
        configSetId: input.configSetId,
        projectId: configSet.projectId,
        ok: empty.ok,
        mode: empty.mode,
        compiler: empty.compiler,
        diagnostics: empty.diagnostics,
        requiresConfirmation: empty.requiresConfirmation
      },
      context
    );
    return empty;
  }

  overlays.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const toolchainMode = input.forRelease ? "release" : toToolchainMode(mode);
  const toolchainResult = await toolchain.validate(
    {
      entryFile,
      includeSearchPaths: [],
      overlayOrder: overlays.map((item) => item.name),
      files
    },
    { mode: toolchainMode }
  );

  const diagnostics = toGateDiagnostics(toolchainResult);
  const gateMode: ValidationMode =
    mode === "warn" || mode === "off" || mode === "block" ? mode : "block";
  const mapped: ValidationGateResult = {
    ok: toolchainResult.ok,
    mode: gateMode,
    requiresConfirmation: computeRequiresConfirmation({
      ok: toolchainResult.ok,
      mode: gateMode,
      compiler: compilerSummary(toolchainResult)
    }),
    diagnostics,
    compiler: compilerSummary(toolchainResult),
    artifacts: toolchainResult.artifacts,
    failureCode: toolchainResult.failureCode
  };

  await writeValidationGateAudit(
    db,
    auth,
    {
      configSetId: input.configSetId,
      projectId: configSet.projectId,
      ok: mapped.ok,
      mode: mapped.mode,
      compiler: mapped.compiler,
      diagnostics: mapped.diagnostics,
      requiresConfirmation: mapped.requiresConfirmation
    },
    context
  );

  if (!mapped.ok) {
    throw new ApiError("CONFLICT", "DTS validation failed.", 409, {
      code: "dts-validation-failed",
      diagnostics: mapped.diagnostics,
      mode: mapped.mode,
      compiler: mapped.compiler,
      failureCode: mapped.failureCode,
      artifacts: mapped.artifacts
    });
  }

  return mapped;
}
