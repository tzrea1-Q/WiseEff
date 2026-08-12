import { ApiError } from "../../../shared/http/errors";
import type { Database } from "../../../shared/database/client";
import { getProjectParameterForUpdate } from "../../parameters/repository";
import { assertSensitiveNodeWriteAllowed } from "../../parameters/sensitiveNode";
import { submitParameterChanges } from "../../parameters/service";
import type { AgentToolDefinition } from "../toolRegistry";

type ToolOptions = {
  db: Database;
};

function readProjectId(contextProjectId: string | undefined, payload: Record<string, unknown>) {
  return typeof payload.projectId === "string" ? payload.projectId : contextProjectId;
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

        const parameter = await getProjectParameterForUpdate(options.db, {
          organizationId: context.auth.organization.id,
          projectId,
          parameterId
        });
        if (parameter?.sourceNodePath) {
          await assertSensitiveNodeWriteAllowed(options.db, context.auth, {
            organizationId: context.auth.organization.id,
            projectId,
            nodePath: parameter.sourceNodePath,
            sourceFileName: parameter.sourceFileName,
            actorType: "agent",
            requestId: context.requestId
          });
        }

        const submission = await submitParameterChanges(options.db, context.auth, {
          projectId,
          items: [{ parameterId, targetValue, reason }]
        }, { requestId: context.requestId, actorType: "agent" });
        const changeRequestId = submission.items[0]?.requestId ?? submission.id;
        return {
          summary: `Submitted parameter change request ${changeRequestId} for review.`,
          data: { changeRequestId, projectId, parameterId, targetValue },
          citations: [
            {
              type: "parameter" as const,
              id: changeRequestId,
              label: `Change request ${changeRequestId}`,
              href: `/parameters/review?changeRequestId=${encodeURIComponent(changeRequestId)}`,
              snippet: `${targetValue} pending review for ${projectId}.`
            }
          ]
        };
      }
    }
  ];
}
