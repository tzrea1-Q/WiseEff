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
import { parameterIdentityMode } from "../../parameter-kernel/parameterIdentityMode";
import {
  createCanonicalValueDraft,
  loadCanonicalBindingPins,
  submitCanonicalValueChange
} from "../../parameter-bindings/drafts";
import { parseJsonSource } from "../../parameter-files/jsonSource";
import { knowledgeEntryHref } from "./knowledgeTools";
import {
  APPROVED_PARAMETER_PAYLOAD_KEY,
  requireApprovedParameterInvocation,
  type ApprovedParameterTarget
} from "../approvedParameterInvocation";
import type {
  AgentToolApprovalPreparationContext,
  AgentToolExecutionContext,
  AgentToolDefinition
} from "../toolRegistry";
import { requireAgentToolMetadata } from "../toolMetadata";

type ToolOptions = {
  db: Database;
  objectStore?: ObjectStore;
  /** Retained for existing callers; canonical parameter actions use the source owner directly. */
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

function readApprovedTarget(payload: Record<string, unknown>): ApprovedParameterTarget {
  const approved = payload[APPROVED_PARAMETER_PAYLOAD_KEY];
  if (typeof approved !== "object" || approved === null || Array.isArray(approved)) {
    throw new ApiError("VALIDATION_FAILED", "The approved canonical parameter pins are missing.");
  }
  const value = approved as { sourceFormat?: unknown; target?: unknown };
  const target = value.target;
  if (typeof target !== "object" || target === null || Array.isArray(target)) {
    throw new ApiError("VALIDATION_FAILED", "The approved canonical parameter target is missing.");
  }
  const targetValue = target as { format?: unknown; sourceText?: unknown };
  if (
    (targetValue.format !== "dts" && targetValue.format !== "json") ||
    typeof targetValue.sourceText !== "string" ||
    targetValue.format !== value.sourceFormat
  ) {
    throw new ApiError("VALIDATION_FAILED", "The approved canonical parameter target is invalid.");
  }
  return { format: targetValue.format, sourceText: targetValue.sourceText };
}

function validateTarget(target: ApprovedParameterTarget) {
  try {
    if (target.format === "dts") {
      parseDtsValue("_approved_parameter", target.sourceText);
    } else {
      parseJsonSource(target.sourceText);
    }
  } catch (error) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `targetValue must be valid ${target.format} source text: ${error instanceof Error ? error.message : "unrecognized value"}`
    );
  }
}

async function prepareParameterApproval(
  options: ToolOptions,
  context: AgentToolApprovalPreparationContext,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const projectId = readProjectId(context.projectId, payload);
  const bindingId = typeof payload.parameterId === "string" ? payload.parameterId.trim() : "";
  const targetValue = typeof payload.targetValue === "string" ? payload.targetValue : "";
  const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
  if (!projectId || !bindingId || !targetValue || !reason) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Project id, parameter id, target value, and reason are required for parameter change submission.",
      { projectId, parameterId: bindingId || undefined, targetValue }
    );
  }
  const pins = await loadCanonicalBindingPins(options.db, {
    organizationId: context.auth.organization.id,
    projectId,
    bindingId
  });
  if (!pins) {
    throw new ApiError("NOT_FOUND", "Project parameter binding was not found for this project.", {
      projectId,
      parameterId: bindingId
    });
  }
  const target = { format: pins.sourceFormat, sourceText: targetValue } satisfies ApprovedParameterTarget;
  validateTarget(target);
  return {
    ...payload,
    projectId,
    parameterId: bindingId,
    reason,
    [APPROVED_PARAMETER_PAYLOAD_KEY]: {
      projectId: pins.projectId,
      bindingId: pins.bindingId,
      expectedValueId: pins.currentValueId,
      definitionId: pins.definitionId,
      definitionRevisionId: pins.definitionRevisionId,
      catalogReleaseId: pins.catalogReleaseId,
      configRevisionId: pins.configRevisionId,
      sourceRef: pins.sourceRef,
      sourcePinId: pins.sourcePinId,
      sourceFormat: pins.sourceFormat,
      target
    }
  };
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

export function createActionTools(options: ToolOptions): AgentToolDefinition[] {
  return [
    {
      ...requireAgentToolMetadata("action.submitParameterChange"),
      prepareApproval: (context, payload) => prepareParameterApproval(options, context, payload),
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
        if (parameterIdentityMode() !== "semantic") {
          throw new ApiError(
            "CONFLICT",
            "Agent parameter submission requires post-cutover binding identity.",
            { reason: "legacy-identity-mode-retired-for-agent", projectId, parameterId }
          );
        }
        const target = readApprovedTarget(payload);
        const targetText = targetValue;
        validateTarget(target);
        return db.transaction(async (tx) => {
          const approved = await requireApprovedParameterInvocation(tx, context.auth, {
            invocation,
            projectId,
            bindingId: parameterId,
            target,
            expectedValueId: (() => {
              const value = payload[APPROVED_PARAMETER_PAYLOAD_KEY];
              return typeof value === "object" && value !== null && !Array.isArray(value) &&
                typeof (value as { expectedValueId?: unknown }).expectedValueId === "string"
                ? (value as { expectedValueId: string }).expectedValueId
                : "";
            })()
          });
          const draft = await createCanonicalValueDraft(
            tx,
            context.auth,
            {
              projectId,
              bindingId: parameterId,
              baseRevisionId: approved.pins.configRevisionId,
              baseCurrentValueId: approved.pins.expectedValueId,
              action: "set",
              reason,
              ...(target.format === "json"
                ? { sourceTarget: { format: "json" as const, sourceText: target.sourceText } }
                : { targetValue: parseDtsValue("_approved_parameter", target.sourceText).value })
            },
            {
              objectStore: options.objectStore,
              invocation,
              requestId: context.requestId,
              refusalSink
            }
          );
          const submission = await submitCanonicalValueChange(tx, context.auth, {
            projectId,
            draftId: draft.id,
            invocation,
            requestId: context.requestId,
            refusalSink
          });
          const changeRequestId = submission.id;
          return {
            summary: `Submitted parameter change request ${changeRequestId} for review.`,
            data: {
              changeRequestId,
              projectId,
              parameterId,
              targetValue: targetText,
              draftId: draft.id
            },
            citations: submissionCitation(changeRequestId, projectId, targetText)
          };
        });
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
