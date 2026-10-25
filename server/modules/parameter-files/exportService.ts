import { parameterOrganizationId, parameterInvocation } from "../parameters/operatingScope";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { type ConfigSetSourcePackage } from "../contracts/dtoSchemas/configSetPackage";
import { loadSharedDtsiClosure, composeDtsBuildInputs } from "../shared-dtsi/dependencies";
import { loadSourceBindingCohort, loadSourceBindingCohortReadOnly, loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { rethrowSourceTransactionError } from "./sourceVersion";
import { loadCanonicalSourceSnapshot } from "./canonicalSource";
import { loadSnapshot } from "./sourceRevisionService";
import { CatalogSubjectId } from "../parameter-catalog-contract";

import { createUserInvocation, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { withAuditedWrite } from "../audit/auditedWrite";
import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { parseDts, serializeDts } from "../dts";
import type { ObjectStore } from "../logs/objectStore";
import { canAdminParameters } from "../parameter-kernel/policy";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { loadConfigSetSnapshot } from "./configSetSnapshot";
import { createDtsToolchainRunner } from "./dtsToolchain";
import { getConfigSetById } from "./configSetRepository";
import {
  createSubprocessDtcValidator,
  readDtsValidationMode,
  type DtcValidator,
  type ValidationMode
} from "./dtcValidator";
import { getFileVersionById, getProjectParameterFileById } from "./repository";
import type { ConfigSetRole, ParameterFileFormat, ConfigSetMemberFileDto } from "./types";

export type ExportServiceContext = AuditCorrelationContext;

export type ExportFileResult = {
  fileId: string;
  fileName: string;
  format: ParameterFileFormat;
  versionNumber: number;
  content: string;
};

export type ExportConfigSetManifestMember = {
  sharedReference?: ConfigSetMemberFileDto["sharedReference"];
  fileVersionId?: string;
  fileId: string;
  fileName: string;
  role: ConfigSetRole;
  sortOrder: number;
  versionNumber: number;
  format: ParameterFileFormat;
};

export type ExportConfigSetManifest = {
  sourcePackage?: ConfigSetSourcePackage;
  preprocessing?: import("../dts/cppSources").DtsPreprocessingReceipt;
  declaredBuildInputs?: import("../contracts/dtoSchemas/dtsPreprocessing").DtsBuildInputs;
  entryFile?: string | null;
  includeSearchPaths?: string[];
  overlayOrder?: string[];
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
    throw new ApiError("FORBIDDEN", "Forbidden.", { permission: "admin:access" });
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
  invocation: TrustedInvocationContext,
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
  await withAuditedWrite(db, invocation, { requestId: context.requestId ?? randomUUID() }, async () => ({
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
    organizationId: parameterOrganizationId(auth),
    fileId
  });
  if (!file) {
    throw new ApiError("NOT_FOUND", "Parameter file not found.", { fileId });
  }
  if (!file.currentVersionId) {
    throw new ApiError("CONFLICT", "Parameter file has no current version to export.", { fileId });
  }

  const version = await getFileVersionById(db, { versionId: file.currentVersionId });
  if (!version) {
    throw new ApiError("NOT_FOUND", "Parameter file version not found.", {
      fileId,
      versionId: file.currentVersionId
    });
  }

  const source = await loadVersionSource(deps.objectStore, version.storageKey);
  const content = formatExportedContent(file.format, source);

  await writeExportAudit(
    db,
    parameterInvocation(auth) ?? createUserInvocation(auth),
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
    organizationId: parameterOrganizationId(auth),
    configSetId
  });
  if (!configSet) {
    throw new ApiError("NOT_FOUND", "Config set not found.", { configSetId });
  }

  const snapshot = await loadConfigSetSnapshot(db, deps.objectStore, configSetId);
  if (snapshot.skipped.length) throw new ApiError("CONFLICT", "配置包含没有当前源码的文件，请修复后重新导出。");
  const hasSharedReferences = snapshot.members.some(member => member.sharedReference);
  const manifestMembers: ExportConfigSetManifestMember[] = [];
  const files: ExportConfigSetFile[] = [];
  const dtsFilesForValidation: Array<{ name: string; content: string }> = [];

  for (const member of snapshot.members) {
    const content = member.content;
    const sourceName = snapshot.sourceMembers?.find(row => row.fileId === member.fileId)?.sourceName ?? member.fileName;

    manifestMembers.push({
      ...(member.sharedReference ? { sharedReference: member.sharedReference } : {}),
      ...(hasSharedReferences ? { fileVersionId: member.versionId } : {}),
      fileId: member.fileId,
      fileName: member.fileName,
      role: member.role,
      sortOrder: member.sortOrder,
      versionNumber: member.versionNumber,
      format: member.format
    });

    files.push({
      name: sourceName,
      format: member.format,
      content
    });

    if (member.format === "dts") {
      dtsFilesForValidation.push({ name: sourceName, content });
    }
  }

  const validator = deps.validator ?? createSubprocessDtcValidator();
  const mode = readDtsValidationMode();
  const complete = (hasSharedReferences || snapshot.preprocessing || snapshot.sourceMembers) && snapshot.entryFile ? await createDtsToolchainRunner().validate({entryFile:snapshot.entryFile,
    includeSearchPaths:snapshot.includeSearchPaths,defines:snapshot.preprocessing?.defines,overlayOrder:snapshot.overlayOrder,
    formerRootOverlayFiles:snapshot.formerRootOverlayFiles,
    files:new Map(dtsFilesForValidation.map(file=>[file.name,{content:file.content}]))},{mode:mode==="block"?"release":mode}) : null;
  const validation = complete ? {ok:complete.ok,mode,compiler:complete.compiler.dtc?"dtc" as const:"unavailable" as const,diagnostics:complete.diagnostics}
    : await validator.validate(dtsFilesForValidation, { mode });
  const requiresConfirmation = computeRequiresConfirmation(validation);

  const loadReferences = async (reader: Queryable) => (await reader.query<{ resourceId: string; versionId: string; mountPath: string }>(`select resource_id as "resourceId",revision_id as "versionId",mount_path as "mountPath"
    from public.project_shared_dtsi_references where organization_id=$1 and project_id=$2 and config_set_id=$3 and is_direct order by created_at,id`,
    [parameterOrganizationId(auth),configSet.projectId,configSetId])).rows;
  const references = await loadReferences(db);
  const resources = await loadSharedDtsiClosure(db as Database, auth, references);
  const declaredBuildInputs = snapshot.declaredBuildInputs ?? {includeSearchPaths:snapshot.includeSearchPaths,defines:snapshot.preprocessing?.defines??{}};
  const jsonSources: ConfigSetSourcePackage["jsonSources"] = [];
  let catalog: Awaited<ReturnType<typeof loadSnapshot>> | undefined;
  const scope = {organizationId:parameterOrganizationId(auth),projectId:configSet.projectId,configSetId};
  const bindings = await loadSourceBindingCohortReadOnly(db, scope);
  for (const binding of bindings) {
    const pin = await loadOwnedProjectValueSourcePin(db,{organizationId:parameterOrganizationId(auth),projectId:configSet.projectId,bindingId:binding.bindingId,projectValueId:binding.oldValueId});
    if (pin?.format !== "json") continue;
    catalog ??= await loadSnapshot(db);
    const {manifest} = await loadCanonicalSourceSnapshot(db,deps.objectStore,{organizationId:parameterOrganizationId(auth),projectId:configSet.projectId,
      bindingId:binding.bindingId,projectValueId:binding.oldValueId});
    if (manifest.format !== "json") continue;
    const sourceName = manifest.members.find(row=>row.fileId===manifest.fileId)!.sourceName;
    const subject = manifest.configurationSchemaSubjectId && catalog?.getSubject(CatalogSubjectId(manifest.configurationSchemaSubjectId));
    const pointer = (manifest.locator as Record<string,unknown>).pointer;
    if (!subject || subject.status!=="found" || subject.subject.kind!=="configuration-schema" || typeof pointer!=="string")
      throw new ApiError("CONFLICT","JSON 来源缺少当前可验证的配置模型，请先修复来源再导出。");
    let source = jsonSources.find(row=>row.sourceName===sourceName && row.rootPointer===(manifest.rootPointer??"") && row.configurationSchemaId===subject.subject.canonicalKey);
    if (!source) { source={sourceName,rootPointer:manifest.rootPointer??"",configurationSchemaId:String(subject.subject.canonicalKey),mappings:[]};jsonSources.push(source); }
    source.mappings.push({definitionId:manifest.definitionId,pointer});
  }
  const sourcePackage: ConfigSetSourcePackage = {schemaVersion:"wiseeff-config-set/v1",entryFile:snapshot.entryFile,
    includeSearchPaths:snapshot.includeSearchPaths,overlayOrder:snapshot.overlayOrder,formerRootOverlayFiles:snapshot.formerRootOverlayFiles??[],declaredBuildInputs,
    resolvedBuildInputs:composeDtsBuildInputs(declaredBuildInputs,resources),...(snapshot.preprocessing?{preprocessing:snapshot.preprocessing}:{}),
    members:snapshot.members.map((member,index)=>({sourceName:files[index]!.name,format:member.format,
      role:snapshot.sourceMembers?.find(row=>row.fileId===member.fileId)?.role??member.role,sortOrder:member.sortOrder,
      checksum:`sha256:${createHash("sha256").update(member.content).digest("hex")}`,
      ...(member.sharedReference?{shared:{resourceId:member.sharedReference.resourceId,versionId:member.sharedReference.versionId,memberId:member.sharedReference.memberId}}:{})})),
    sharedClosure:resources.map(resource=>({resourceId:resource.resourceId,versionId:resource.versionId,mountPath:resource.mountPath,
      direct:resource.direct,digest:resource.digest,manifest:resource.item.manifest})),jsonSources};

  const manifest: ExportConfigSetManifest = {
    sourcePackage,
    ...(hasSharedReferences || snapshot.preprocessing ? { entryFile: snapshot.entryFile, includeSearchPaths: snapshot.includeSearchPaths, overlayOrder: snapshot.overlayOrder,
      ...(snapshot.preprocessing?{preprocessing:snapshot.preprocessing}:{}),...(snapshot.declaredBuildInputs?{declaredBuildInputs:snapshot.declaredBuildInputs}:{}) } : {}),
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

  // Object reads and compilation await outside the source locks. Refuse a
  // package if its original bytes, build inputs, references or JSON pins moved.
  try { await db.transaction(async tx => {
    await tx.query(`select id from public.dts_config_set where organization_id=$1 and project_id=$2 and id=$3 for share nowait`,
      [scope.organizationId,scope.projectId,configSetId]);
    await tx.query(`select id from public.project_parameter_files where organization_id=$1 and project_id=$2 and config_set_id=$3 order by id for share nowait`,
      [scope.organizationId,scope.projectId,configSetId]);
    const currentBindings = await loadSourceBindingCohort(tx,scope);
    if (!isDeepStrictEqual(snapshot,await loadConfigSetSnapshot(tx,deps.objectStore,configSetId))
      || !isDeepStrictEqual(references,await loadReferences(tx)) || !isDeepStrictEqual(bindings,currentBindings)) {
      throw new ApiError("CONFLICT","配置来源在导出期间已变化，请重新导出。",{reason:"configuration-export-stale"});
    }
  }); } catch (error) { rethrowSourceTransactionError(error); }

  await writeExportAudit(
    db,
    parameterInvocation(auth) ?? createUserInvocation(auth),
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
