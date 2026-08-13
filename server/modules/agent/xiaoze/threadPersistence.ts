import type { Database } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { withAuditedWrite, type AuditSpec } from "../../audit/auditedWrite";
import { getAgentSession } from "../repository";
import type { AgentCitation } from "../types";
import {
  persistXiaozeTurnMessages,
  type PersistXiaozeTurnMessagesInput,
  type XiaozePersistableMessage
} from "./threadRepository";

const ORG_SCOPED_PAGE_KEYS = new Set(["logs", "log-admin", "node-debugging", "debugging-admin"]);

function normalizePageContext(pageContext: PersistXiaozeTurnInput["pageContext"]) {
  const pageKey = pageContext.pageKey ?? "";
  if (!ORG_SCOPED_PAGE_KEYS.has(pageKey)) {
    return pageContext;
  }
  return { ...pageContext, projectId: undefined };
}

export type PersistXiaozeTurnInput = {
  auth: AuthContext;
  requestId: string;
  threadId: string;
  runId: string;
  pageContext: { projectId?: string; pageKey?: string; path?: string; roleId?: string };
  userMessage?: { id: string; content: string };
  assistantMessage?: {
    id: string;
    content: string;
    citations?: AgentCitation[];
    runSteps?: Record<string, unknown>[];
  };
  reasoningMessage?: { id: string; content: string };
};

function buildPersistMessages(input: PersistXiaozeTurnInput): XiaozePersistableMessage[] {
  const messages: XiaozePersistableMessage[] = [];
  if (input.userMessage?.content.trim()) {
    messages.push({ id: input.userMessage.id, role: "user", content: input.userMessage.content });
  }
  if (input.reasoningMessage?.content.trim()) {
    messages.push({ id: input.reasoningMessage.id, role: "reasoning", content: input.reasoningMessage.content });
  }
  if (input.assistantMessage?.content.trim()) {
    messages.push({
      id: input.assistantMessage.id,
      role: "assistant",
      content: input.assistantMessage.content,
      citations: input.assistantMessage.citations,
      metadata: input.assistantMessage.runSteps?.length
        ? { runSteps: input.assistantMessage.runSteps, runId: input.runId }
        : undefined
    });
  }
  return messages;
}

export function createXiaozeTurnPersister(options: { db: Database }) {
  return async function persistXiaozeTurn(input: PersistXiaozeTurnInput): Promise<void> {
    const messages = buildPersistMessages(input);
    if (messages.length === 0) {
      return;
    }

    const pageContext = normalizePageContext(input.pageContext);

    const payload: PersistXiaozeTurnMessagesInput = {
      organizationId: input.auth.organization.id,
      actorUserId: input.auth.user.id,
      threadId: input.threadId,
      runId: input.runId,
      pageContext,
      messages
    };

    // Persisted messages and their audit evidence commit together (ADR-0027);
    // previously the messages auto-committed and the session-start/append audits
    // could be lost after them.
    await withAuditedWrite(options.db, input.auth, { requestId: input.requestId }, async (tx) => {
      const sessionStarted = !(await getAgentSession(tx, input.auth.organization.id, input.threadId));
      const persisted = await persistXiaozeTurnMessages(tx, payload);
      if (!persisted) {
        return { result: undefined, audit: null };
      }

      const audits: AuditSpec[] = [];
      if (sessionStarted) {
        audits.push({
          app: "wiseeff",
          kind: "agent-session",
          action: "started",
          severity: "Low",
          projectId: pageContext.projectId ?? null,
          targetType: "agent_session",
          targetId: input.threadId,
          metadata: { sessionId: input.threadId, pageKey: "xiaoze" }
        });
      }
      audits.push({
        app: "wiseeff",
        kind: "agent-message",
        action: "appended",
        severity: "Low",
        projectId: pageContext.projectId ?? null,
        targetType: "agent_session",
        targetId: input.threadId,
        metadata: {
          sessionId: input.threadId,
          messageIds: messages.map((message) => message.id),
          roles: messages.map((message) => message.role)
        }
      });
      return { result: undefined, audit: audits };
    });
  };
}
