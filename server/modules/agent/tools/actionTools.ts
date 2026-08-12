import { ApiError } from "../../../shared/http/errors";
import type { Database } from "../../../shared/database/client";
import type { ObjectStore } from "../../logs/objectStore";
import type { DtsToolchainRunner } from "../../parameter-files/dtsToolchain";
import { parseDtsValue } from "../../dts/valueAst";
import { deleteDraft, getProjectParameterForUpdate } from "../../parameters/repository";
import { mustUseSemanticParameterIdentity } from "../../parameters/semanticParameterReads";
import { assertSensitiveNodeWriteAllowed } from "../../parameters/sensitiveNode";
import { submitParameterChanges } from "../../parameters/service";
import { loadBindingContext, resolveBindingHeadRevisionId } from "../../parameter-topology/writeLock";
import { createBindingDraft } from "../../parameter-topology/service";
import type { AgentToolExecutionContext, AgentToolDefinition } from "../toolRegistry";

type ToolOptions = {
  db: Database;
  objectStore?: ObjectStore;
  /** Injected by tests; production uses the real toolchain runner. */
  toolchain?: DtsToolchainRunner;
};

function readProjectId(contextProjectId: string | undefined, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : contextProjectId;
}

function submissionCitation(changeRequestId: string, projectId: string, targetValue: string) {
  return [
    {
      type: "parameter" as const,
      id: changeRequestId,
      label: `Change request ${changeRequestId}`,
      href: `/parameters/review?changeRequestId=${encodeURIComponent(changeRequestId)}`,
      snippet: `${targetValue} pending review for ${projectId}.`
    }
  ];
}

/**
 * Legacy-identity databases only (kept alive by CI for the identity-migration
 * suites, TD-079): the flat submission shape is still the accepted contract
 * there, and `parameterId` addresses the legacy flat parameter row.
 */
async function submitLegacyParameterChange(
  db: Database,
  context: AgentToolExecutionContext,
  input: { projectId: string; parameterId: string; targetValue: string; reason: string }
) {
  const parameter = await getProjectParameterForUpdate(db, {
    organizationId: context.auth.organization.id,
    projectId: input.projectId,
    parameterId: input.parameterId
  });
  if (parameter?.sourceNodePath) {
    await assertSensitiveNodeWriteAllowed(db, context.auth, {
      organizationId: context.auth.organization.id,
      projectId: input.projectId,
      nodePath: parameter.sourceNodePath,
      sourceFileName: parameter.sourceFileName,
      actorType: "agent",
      requestId: context.requestId
    });
  }

  const submission = await submitParameterChanges(
    db,
    context.auth,
    {
      projectId: input.projectId,
      items: [{ parameterId: input.parameterId, targetValue: input.targetValue, reason: input.reason }]
    },
    { requestId: context.requestId, actorType: "agent" }
  );
  const changeRequestId = submission.items[0]?.requestId ?? submission.id;
  return {
    summary: `Submitted parameter change request ${changeRequestId} for review.`,
    data: {
      changeRequestId,
      projectId: input.projectId,
      parameterId: input.parameterId,
      targetValue: input.targetValue
    },
    citations: submissionCitation(changeRequestId, input.projectId, input.targetValue)
  };
}

export function createActionTools(options: ToolOptions): AgentToolDefinition[] {
  return [
    {
      name: "action.submitParameterChange",
      label: "Submit parameter change",
      kind: "mutating",
      permission: "parameter:edit",
      requiresApproval: true,
      run: async (context, payload) => {
        const projectId = readProjectId(context.projectId, payload);
        const parameterId = typeof payload.parameterId === "string" ? payload.parameterId : undefined;
        const targetValue = typeof payload.targetValue === "string" ? payload.targetValue : undefined;
        const reason = typeof payload.reason === "string" && payload.reason.trim() ? payload.reason.trim() : undefined;

        if (!projectId || !parameterId || !targetValue || !reason) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "Project id, parameter id, target value, and reason are required for parameter change submission.",
            400,
            { projectId, parameterId, targetValue }
          );
        }
        const db = options.db;

        if (!(await mustUseSemanticParameterIdentity(db))) {
          return submitLegacyParameterChange(db, context, { projectId, parameterId, targetValue, reason });
        }

        // Post-cutover: semantic identity is the only accepted submission
        // contract, and `parameterId` is the project parameter binding id.
        const binding = await loadBindingContext(db, context.auth, parameterId);
        if (binding.project_id !== projectId) {
          throw new ApiError("NOT_FOUND", "Parameter binding was not found for this project.", 404, {
            projectId,
            parameterId
          });
        }
        // Early sensitive-node guard: refuse critical writes before any draft or
        // candidate revision is created. submitParameterChanges re-checks later.
        if (binding.node_locator) {
          await assertSensitiveNodeWriteAllowed(db, context.auth, {
            organizationId: context.auth.organization.id,
            projectId,
            nodePath: binding.node_locator,
            sourceFileName: undefined,
            actorType: "agent",
            requestId: context.requestId
          });
        }

        let parsedValue: ReturnType<typeof parseDtsValue>;
        try {
          parsedValue = parseDtsValue(binding.property_key || "value", targetValue);
        } catch (error) {
          throw new ApiError(
            "VALIDATION_FAILED",
            `targetValue must be DTS source text such as <3600>, "fast" or [01 02]: ${
              error instanceof Error ? error.message : "unrecognized value"
            }`,
            400,
            { parameterId, targetValue }
          );
        }

        const baseRevisionId = await resolveBindingHeadRevisionId(db, {
          organizationId: context.auth.organization.id,
          projectId,
          bindingId: parameterId
        });
        if (!baseRevisionId) {
          throw new ApiError(
            "CONFLICT",
            "No config revision is available for this parameter binding yet.",
            409,
            { projectId, parameterId }
          );
        }

        const draft = await createBindingDraft(
          db,
          context.auth,
          {
            projectId,
            bindingId: parameterId,
            baseRevisionId,
            targetValue: parsedValue.value,
            action: "set",
            reason
          },
          { objectStore: options.objectStore, toolchain: options.toolchain }
        );

        try {
          const submission = await submitParameterChanges(
            db,
            context.auth,
            {
              projectId,
              items: [
                {
                  draftId: draft.draftId,
                  editSubjectKind: "binding",
                  projectParameterBindingId: draft.projectParameterBindingId,
                  parameterSpecId: draft.parameterSpecId,
                  action: draft.action,
                  targetValue: draft.rawText,
                  reason
                }
              ]
            },
            { requestId: context.requestId, actorType: "agent" }
          );
          const changeRequestId = submission.items[0]?.requestId ?? submission.id;
          return {
            summary: `Submitted parameter change request ${changeRequestId} for review.`,
            data: {
              changeRequestId,
              projectId,
              parameterId,
              targetValue: draft.rawText,
              draftId: draft.draftId
            },
            citations: submissionCitation(changeRequestId, projectId, draft.rawText)
          };
        } catch (error) {
          // Best-effort cleanup so a failed submission does not leave an
          // agent-created draft parked in the user's workbench.
          try {
            await deleteDraft(db, {
              organizationId: context.auth.organization.id,
              userId: context.auth.user.id,
              draftId: draft.draftId
            });
          } catch {
            // keep the submission error as the caller-visible failure
          }
          throw error;
        }
      }
    }
  ];
}
