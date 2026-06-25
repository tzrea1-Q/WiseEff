import { randomUUID } from "node:crypto";
import type { Database } from "../../../shared/database/client";
import type { AuthContext } from "../../auth/types";
import { createAuditEvent } from "../../audit/repository";
import { getAgentSession } from "../repository";
import type { AgentCitation } from "../types";
import {
  persistXiaozeTurnMessages,
  type PersistXiaozeTurnMessagesInput,
  type XiaozePersistableMessage
} from "./threadRepository";

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

async function writeAudit(
  db: Database,
  input: {
    auth: AuthContext;
    requestId: string;
    kind: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
    projectId?: string;
  }
) {
  await createAuditEvent(db, {
    id: randomUUID(),
    organizationId: input.auth.organization.id,
    projectId: input.projectId ?? null,
    actorUserId: input.auth.user.id,
    actorType: "user",
    app: "wiseeff",
    kind: input.kind,
    action: input.action,
    severity: "Low",
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata ?? {},
    traceId: input.requestId
  });
}

export function createXiaozeTurnPersister(options: { db: Database }) {
  return async function persistXiaozeTurn(input: PersistXiaozeTurnInput): Promise<void> {
    const messages = buildPersistMessages(input);
    if (messages.length === 0) {
      return;
    }

    const sessionStarted = !(await getAgentSession(options.db, input.auth.organization.id, input.threadId));

    const payload: PersistXiaozeTurnMessagesInput = {
      organizationId: input.auth.organization.id,
      actorUserId: input.auth.user.id,
      threadId: input.threadId,
      runId: input.runId,
      pageContext: input.pageContext,
      messages
    };

    const persisted = await persistXiaozeTurnMessages(options.db, payload);
    if (!persisted) {
      return;
    }

    if (sessionStarted) {
      await writeAudit(options.db, {
        auth: input.auth,
        requestId: input.requestId,
        kind: "agent-session",
        action: "started",
        targetType: "agent_session",
        targetId: input.threadId,
        projectId: input.pageContext.projectId,
        metadata: { sessionId: input.threadId, pageKey: "xiaoze" }
      });
    }

    await writeAudit(options.db, {
      auth: input.auth,
      requestId: input.requestId,
      kind: "agent-message",
      action: "appended",
      targetType: "agent_session",
      targetId: input.threadId,
      projectId: input.pageContext.projectId,
      metadata: {
        sessionId: input.threadId,
        messageIds: messages.map((message) => message.id),
        roles: messages.map((message) => message.role)
      }
    });
  };
}
