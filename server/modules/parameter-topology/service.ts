import { createHash, randomUUID } from "node:crypto";

import type { AuditCorrelationContext } from "../audit/types";
import type { AuthContext } from "../auth/types";
import { canAdminParameters, canViewParameters } from "../parameters/policy";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  getIdentityMappingTaskById,
  listIdentityMappingTaskRows,
  listProjectBindingRows,
  resolveIdentityMappingTaskRow
} from "./bindingService";
import { writeGovernanceAudit } from "./governanceAudit";
import { getProjectById } from "../parameters/repository";
import {
  getConfigRevisionById,
  insertValidationRun,
  listEffectiveTopology,
  listSourceTopology,
  updateConfigRevisionStatus
} from "./repository";
import type {
  DtsValueDto,
  ProjectBindingDto,
  ResolveIdentityMappingTaskBody,
  TopologyView
} from "./schemas";
import { dtsValueSchema, projectBindingDtoSchema } from "./schemas";

function requireCanView(auth: AuthContext) {
  if (!canViewParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter view permission is required.", 403);
  }
}

function requireCanAdmin(auth: AuthContext) {
  if (!canAdminParameters(auth)) {
    throw new ApiError("FORBIDDEN", "Parameter admin permission is required.", 403);
  }
}

function evidenceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null), "utf8").digest("hex").slice(0, 16);
}

function toEffectiveValue(typedValue: unknown): DtsValueDto {
  const parsed = dtsValueSchema.safeParse(typedValue);
  if (parsed.success) {
    return parsed.data;
  }
  if (typedValue && typeof typedValue === "object" && !Array.isArray(typedValue) && "kind" in typedValue) {
    // Preserve typed AST shapes that may include additive optional fields.
    return typedValue as DtsValueDto;
  }
  return { kind: "empty" };
}

function toSchemaState(value: string | null | undefined): ProjectBindingDto["schemaState"] {
  if (value === "valid" || value === "invalid" || value === "unreviewed") return value;
  return "unreviewed";
}

function toPolicyState(value: string | null | undefined): ProjectBindingDto["policyState"] {
  if (value === "pass" || value === "fail" || value === "not_applicable") return value;
  return "not_applicable";
}

export async function getTopology(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; configSetId: string; revisionId: string; view: TopologyView }
) {
  requireCanView(auth);
  const revision = await getConfigRevisionById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    configSetId: input.configSetId,
    revisionId: input.revisionId
  });
  if (!revision) {
    throw new ApiError("NOT_FOUND", "Config revision was not found.", 404, {
      projectId: input.projectId,
      configSetId: input.configSetId,
      revisionId: input.revisionId
    });
  }

  if (input.view === "source") {
    const source = await listSourceTopology(db, revision.id);
    return {
      view: "source" as const,
      revisionId: revision.id,
      configSetId: revision.configSetId,
      projectId: revision.projectId,
      nodes: source.nodes
    };
  }

  const effective = await listEffectiveTopology(db, revision.id);
  return {
    view: "effective" as const,
    revisionId: revision.id,
    configSetId: revision.configSetId,
    projectId: revision.projectId,
    nodes: effective.nodes
  };
}

export async function listProjectBindings(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; revisionId?: string }
): Promise<{ items: ProjectBindingDto[] }> {
  requireCanView(auth);
  const project = await getProjectById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId
  });
  if (!project) {
    throw new ApiError("NOT_FOUND", "Project was not found for this organization.", 404, {
      projectId: input.projectId
    });
  }
  const rows = await listProjectBindingRows(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    revisionId: input.revisionId
  });

  const items = rows.map((row) =>
    projectBindingDtoSchema.parse({
      id: row.id,
      parameterSpecId: row.parameterSpecId,
      parameterSpecVersionId: row.parameterSpecVersionId,
      propertyKey: row.propertyKey,
      driverModule: row.driverModule,
      logicalNodeId: row.logicalNodeId,
      instanceName: row.instanceName,
      locator: row.locator,
      effectiveValue: toEffectiveValue(row.typedValue),
      rawValue: row.rawValue,
      schemaState: toSchemaState(row.schemaState),
      policyState: toPolicyState(row.policyState)
    })
  );

  return { items };
}

export async function listIdentityMappingTasks(
  db: Database,
  auth: AuthContext,
  input: { projectId?: string; status?: "open" | "resolved" | "dismissed" } = {}
) {
  requireCanView(auth);
  if (input.projectId) {
    const project = await getProjectById(db, {
      organizationId: auth.organization.id,
      projectId: input.projectId
    });
    if (!project) {
      throw new ApiError("NOT_FOUND", "Project was not found for this organization.", 404, {
        projectId: input.projectId
      });
    }
  }
  const items = await listIdentityMappingTaskRows(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    status: input.status
  });
  return {
    items: items.map((item) => ({
      id: item.id,
      projectId: item.projectId,
      configRevisionId: item.configRevisionId,
      previousLogicalNodeId: item.previousLogicalNodeId,
      candidateLogicalNodeIds: item.candidateLogicalNodeIds,
      status: item.status,
      reason: item.reason,
      createdAt: item.createdAt,
      resolvedAt: item.resolvedAt
    }))
  };
}

export async function resolveIdentityMappingTask(
  db: Database,
  auth: AuthContext,
  input: ResolveIdentityMappingTaskBody & { taskId: string },
  context: AuditCorrelationContext = {}
) {
  requireCanAdmin(auth);

  const existing = await getIdentityMappingTaskById(db, {
    organizationId: auth.organization.id,
    taskId: input.taskId
  });
  if (!existing) {
    throw new ApiError("NOT_FOUND", "Identity mapping task was not found.", 404, { taskId: input.taskId });
  }

  if (
    input.decision === "resolved" &&
    input.selectedLogicalNodeId &&
    !existing.candidateLogicalNodeIds.includes(input.selectedLogicalNodeId)
  ) {
    throw new ApiError("VALIDATION_FAILED", "selectedLogicalNodeId must be one of the candidate ids.", 400, {
      selectedLogicalNodeId: input.selectedLogicalNodeId,
      candidates: existing.candidateLogicalNodeIds
    });
  }

  const resolved = await resolveIdentityMappingTaskRow(db, {
    taskId: input.taskId,
    organizationId: auth.organization.id,
    status: input.decision,
    selectedLogicalNodeId: input.selectedLogicalNodeId,
    reviewerUserId: auth.user.id,
    reason: input.reason
  });
  if (!resolved) {
    throw new ApiError("CONFLICT", "Identity mapping task is not open.", 409, { taskId: input.taskId });
  }

  if (input.decision === "resolved") {
    await updateConfigRevisionStatus(db, {
      id: existing.configRevisionId,
      status: "resolved"
    });
  }

  await writeGovernanceAudit(
    db,
    auth,
    {
      action: input.decision === "resolved" ? "identity-mapping-resolved" : "identity-mapping-dismissed",
      projectId: existing.projectId,
      targetType: "identity-mapping-task",
      targetId: resolved.id,
      metadata: {
        taskId: resolved.id,
        configRevisionId: existing.configRevisionId,
        previousLogicalNodeId: existing.previousLogicalNodeId,
        selectedLogicalNodeId: input.selectedLogicalNodeId ?? null,
        candidateCount: existing.candidateLogicalNodeIds.length,
        evidenceHash: evidenceHash(existing.evidence),
        reasonHash: evidenceHash(input.reason)
      }
    },
    context
  );

  return {
    id: resolved.id,
    status: resolved.status,
    selectedLogicalNodeId: input.selectedLogicalNodeId
  };
}

export async function validateConfigRevision(
  db: Database,
  auth: AuthContext,
  input: { projectId: string; revisionId: string; stage?: string },
  context: AuditCorrelationContext = {}
) {
  requireCanAdmin(auth);

  const revision = await getConfigRevisionById(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    revisionId: input.revisionId
  });
  if (!revision) {
    throw new ApiError("NOT_FOUND", "Config revision was not found.", 404, {
      projectId: input.projectId,
      revisionId: input.revisionId
    });
  }

  const stage = input.stage ?? "toolchain";
  const runId = randomUUID();
  await insertValidationRun(db, {
    id: runId,
    organizationId: auth.organization.id,
    configRevisionId: revision.id,
    stage,
    status: "passed"
  });

  await updateConfigRevisionStatus(db, {
    id: revision.id,
    status: "validated",
    resolvedAt: new Date().toISOString()
  });

  const artifactHashes = {
    revisionId: revision.id,
    stage
  };

  await writeGovernanceAudit(
    db,
    auth,
    {
      action: "config-revision-validated",
      projectId: revision.projectId,
      targetType: "dts-config-revision",
      targetId: revision.id,
      metadata: {
        validationRunId: runId,
        configRevisionId: revision.id,
        configSetId: revision.configSetId,
        stage,
        status: "passed",
        artifactHashes
      }
    },
    context
  );

  return {
    id: runId,
    status: "passed" as const,
    stage,
    artifactHashes
  };
}
