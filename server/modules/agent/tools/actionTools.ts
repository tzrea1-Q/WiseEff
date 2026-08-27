import { ApiError } from "../../../shared/http/errors";
import type { Database } from "../../../shared/database/client";
import { assertTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../../audit/trustedRefusalSink";
import {
  assertTrustedInvocationContext,
  TrustedInvocationContextError,
  type AgentInvocationContext
} from "../../auth/trustedInvocation";
import { createAgentKnowledgeDraft } from "../../knowledge/service";
import type { ObjectStore } from "../../logs/objectStore";
import type { DtsToolchainRunner } from "../../parameter-files/dtsToolchain";
import { parseDtsValue } from "../../dts/valueAst";
import { deleteDraft } from "../../parameter-drafts/repository";
import { getProjectParameterForUpdate } from "../../parameters/repository";
import { resolveParameterIdentityMode } from "../../parameter-kernel/parameterIdentityMode";
import { assertTrustedSensitiveNodeSubmissionAllowed } from "../../parameter-kernel/sensitiveNode";
import { submitParameterChanges } from "../../parameters/service";
import {
  loadBindingContext,
  loadLogicalNodeSubmissionContext,
  resolveBindingHeadRevisionId
} from "../../parameter-topology/writeLock";
import { createBindingDraft } from "../../parameter-topology/service";
import { knowledgeEntryHref } from "./knowledgeTools";
import type { AgentToolExecutionContext, AgentToolDefinition } from "../toolRegistry";
import { requireAgentToolMetadata } from "../toolMetadata";

type ToolOptions = {
  db: Database;
  objectStore?: ObjectStore;
  /** Injected by tests; production uses the real toolchain runner. */
  toolchain?: DtsToolchainRunner;
  refusalAuditSink?: TrustedRefusalAuditSink;
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

function requireDurableAgentInvocation(context: AgentToolExecutionContext): AgentInvocationContext {
  const invocation = assertTrustedInvocationContext(context.invocation);
  if (
    invocation.initiator !== "agent" ||
    invocation.sessionId !== context.sessionId ||
    invocation.toolCallId !== context.toolCallId ||
    !invocation.approvalRequired ||
    invocation.approvalId !== context.approvalId
  ) {
    throw new TrustedInvocationContextError(
      "parameter submission requires the durable Agent session, tool-call, and approval invocation"
    );
  }
  return invocation;
}

function requireParameterSubmissionRefusalSink(options: ToolOptions): TrustedRefusalAuditSink {
  assertTrustedRefusalAuditSink(options.refusalAuditSink);
  return options.refusalAuditSink;
}

const MAX_DRAFT_TITLE_CHARS = 200;
const MAX_DRAFT_CONTENT_CHARS = 200_000;
const MAX_DRAFT_TAGS = 20;
const MAX_DRAFT_TAG_CHARS = 60;

function readDraftTags(payload: Record<string, unknown>): string[] {
  if (!Array.isArray(payload.tags)) {
    return [];
  }
  return payload.tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().slice(0, MAX_DRAFT_TAG_CHARS))
    .filter((tag) => tag.length > 0)
    .slice(0, MAX_DRAFT_TAGS);
}

/**
 * Legacy-identity databases only (kept alive by CI for the identity-migration
 * suites, TD-079): the flat submission shape is still the accepted contract
 * there, and `parameterId` addresses the legacy flat parameter row.
 */
async function submitLegacyParameterChange(
  db: Database,
  context: AgentToolExecutionContext,
  invocation: AgentInvocationContext,
  refusalSink: TrustedRefusalAuditSink,
  input: { projectId: string; parameterId: string; targetValue: string; reason: string }
) {
  const parameter = await getProjectParameterForUpdate(db, {
    organizationId: context.auth.organization.id,
    projectId: input.projectId,
    parameterId: input.parameterId
  });
  if (parameter?.sourceNodePath) {
    await assertTrustedSensitiveNodeSubmissionAllowed(db, context.auth, {
      organizationId: context.auth.organization.id,
      projectId: input.projectId,
      nodePath: parameter.sourceNodePath,
      sourceFileName: parameter.sourceFileName,
      sourceFileVersionId: parameter.sourceFileVersionId,
      sourcePath: { kind: "property-path", value: parameter.sourceNodePath },
      invocation,
      requestId: context.requestId,
      refusalSink
    });
  }

  const submission = await submitParameterChanges(
    db,
    context.auth,
    {
      projectId: input.projectId,
      items: [{ parameterId: input.parameterId, targetValue: input.targetValue, reason: input.reason }]
    },
    { requestId: context.requestId, invocation, refusalSink }
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
      ...requireAgentToolMetadata("action.submitParameterChange"),
      run: async (context, payload) => {
        const invocation = requireDurableAgentInvocation(context);
        const refusalSink = requireParameterSubmissionRefusalSink(options);
        const projectId = readProjectId(context.projectId, payload);
        const parameterId = typeof payload.parameterId === "string" ? payload.parameterId : undefined;
        const targetValue = typeof payload.targetValue === "string" ? payload.targetValue : undefined;
        const reason = typeof payload.reason === "string" && payload.reason.trim() ? payload.reason.trim() : undefined;

        if (!projectId || !parameterId || !targetValue || !reason) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "Project id, parameter id, target value, and reason are required for parameter change submission.",
            { projectId, parameterId, targetValue }
          );
        }
        const db = options.db;

        if ((await resolveParameterIdentityMode(db)) === "legacy") {
          return submitLegacyParameterChange(db, context, invocation, refusalSink, {
            projectId,
            parameterId,
            targetValue,
            reason
          });
        }

        // Post-cutover: semantic identity is the only accepted submission
        // contract, and `parameterId` is the project parameter binding id.
        const binding = await loadBindingContext(db, context.auth, parameterId);
        if (binding.project_id !== projectId) {
          throw new ApiError("NOT_FOUND", "Parameter binding was not found for this project.", {
            projectId,
            parameterId
          });
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
            { projectId, parameterId }
          );
        }

        // Early guard uses the exact server-resolved binding head. Never use
        // loadBindingContext's display-oriented latest locator as provenance.
        if (binding.logical_node_id) {
          const node = await loadLogicalNodeSubmissionContext(db, {
            organizationId: context.auth.organization.id,
            projectId,
            configRevisionId: baseRevisionId,
            logicalNodeId: binding.logical_node_id
          });
          await assertTrustedSensitiveNodeSubmissionAllowed(db, context.auth, {
            organizationId: context.auth.organization.id,
            projectId,
            nodePath: node.nodeLocator,
            compatible: node.compatible,
            invocation,
            requestId: context.requestId,
            refusalSink
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
            { parameterId, targetValue }
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
          { objectStore: options.objectStore, toolchain: options.toolchain },
          { requestId: context.requestId, invocation, refusalSink }
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
            { requestId: context.requestId, invocation, refusalSink }
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
              userId: invocation.principal.user.id,
              draftId: draft.draftId
            });
          } catch {
            // keep the submission error as the caller-visible failure
          }
          throw error;
        }
      }
    },
    {
      ...requireAgentToolMetadata("action.createKnowledgeDraft"),
      run: async (context, payload) => {
        const title = typeof payload.title === "string" ? payload.title.trim().slice(0, MAX_DRAFT_TITLE_CHARS) : "";
        const contentMarkdown =
          typeof payload.contentMarkdown === "string" ? payload.contentMarkdown.slice(0, MAX_DRAFT_CONTENT_CHARS) : "";
        const sourceLogId =
          typeof payload.sourceLogId === "string" && payload.sourceLogId.trim() ? payload.sourceLogId.trim() : undefined;
        const sourceReloadRunId =
          typeof payload.sourceReloadRunId === "string" && payload.sourceReloadRunId.trim()
            ? payload.sourceReloadRunId.trim()
            : undefined;

        if (!title || !contentMarkdown.trim()) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "Title and markdown content are required to create a knowledge draft.",
            { title }
          );
        }

        // Draft-only semantics (D11): always a NEW draft under the calling
        // user's identity; the creating session is recorded so the
        // publisher-accountability rule can attribute it.
        const entry = await createAgentKnowledgeDraft(
          options.db,
          context.auth,
          {
            title,
            tags: readDraftTags(payload),
            contentMarkdown,
            sessionId: context.sessionId,
            sourceLogId,
            sourceReloadRunId
          },
          { requestId: context.requestId }
        );

        return {
          summary: `Created knowledge draft "${entry.title}" — pending human review before it can be published into retrieval.`,
          data: {
            entryId: entry.id,
            title: entry.title,
            status: entry.status,
            tags: entry.tags,
            sourceLogId: entry.sourceLogId,
            sourceReloadRunId: entry.sourceReloadRunId,
            sessionId: context.sessionId
          },
          citations: [
            {
              type: "knowledge" as const,
              id: entry.id,
              label: entry.title,
              href: knowledgeEntryHref(entry.id),
              snippet: contentMarkdown.slice(0, 200)
            }
          ]
        };
      }
    }
  ];
}
