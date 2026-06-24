import type { Queryable } from "../../../shared/database/client";
import type { AgentCitation, AgentContext, AgentMessageDto } from "../types";
import { getAgentSession, listAgentMessages } from "../repository";

export const XIAOZE_PAGE_KEY = "xiaoze";
export const XIAOZE_THREAD_DEFAULT_LIMIT = 30;
export const XIAOZE_THREAD_MAX_LIMIT = 50;

export type XiaozeThreadListItem = {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type XiaozeThreadDetail = {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  context: AgentContext;
  messages: AgentMessageDto[];
};

export type ListXiaozeThreadsInput = {
  organizationId: string;
  actorUserId: string;
  limit?: number;
  cursor?: string;
};

export type ListXiaozeThreadsResult = {
  items: XiaozeThreadListItem[];
  nextCursor: string | null;
};

export type XiaozePersistableMessage = {
  id: string;
  role: AgentMessageDto["role"] | "reasoning";
  content: string;
  citations?: AgentCitation[];
};

export type PersistXiaozeTurnMessagesInput = {
  organizationId: string;
  actorUserId: string;
  threadId: string;
  runId: string;
  pageContext: { projectId?: string; pageKey?: string; path?: string; roleId?: string };
  messages: XiaozePersistableMessage[];
};

type AgentSessionRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  actor_user_id: string;
  page_key: string;
  role_id: string | null;
  context: unknown;
  status: string;
  title: string;
  created_at: string | Date;
  updated_at: string | Date;
};

type XiaozeThreadListRow = {
  id: string;
  title: string;
  context: unknown;
  created_at: string | Date;
  updated_at: string | Date;
  message_count: string | number;
};

function dateTimeToIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toAgentContext(value: unknown): AgentContext {
  const context = jsonObject(value);
  return {
    path: typeof context.path === "string" ? context.path : "",
    pageKey: typeof context.pageKey === "string" ? context.pageKey : "",
    projectId: typeof context.projectId === "string" ? context.projectId : undefined,
    roleId: typeof context.roleId === "string" ? context.roleId : undefined
  };
}

function readXiaozePreview(context: unknown) {
  const xiaoze = jsonObject(jsonObject(context).xiaoze);
  return typeof xiaoze.preview === "string" ? xiaoze.preview : "暂无消息";
}

export function deriveThreadTitleFromMessages(messages: XiaozePersistableMessage[], fallback = "新对话") {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim().length > 0);
  if (!firstUser) {
    return fallback;
  }
  const trimmed = firstUser.content.trim().replace(/\s+/g, " ");
  return trimmed.length > 32 ? `${trimmed.slice(0, 32)}…` : trimmed;
}

export function deriveThreadPreviewFromMessages(messages: XiaozePersistableMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.content.trim()) {
      const trimmed = message.content.trim().replace(/\s+/g, " ");
      return trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed;
    }
  }
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  if (firstUser) {
    const trimmed = firstUser.content.trim().replace(/\s+/g, " ");
    return trimmed.length > 72 ? `${trimmed.slice(0, 72)}…` : trimmed;
  }
  return "暂无消息";
}

function encodeCursor(updatedAt: string, id: string) {
  return `${updatedAt}|${id}`;
}

function decodeCursor(cursor: string) {
  const separatorIndex = cursor.lastIndexOf("|");
  if (separatorIndex <= 0) {
    return null;
  }
  return {
    updatedAt: cursor.slice(0, separatorIndex),
    id: cursor.slice(separatorIndex + 1)
  };
}

function mapListRow(row: XiaozeThreadListRow): XiaozeThreadListItem {
  return {
    id: row.id,
    title: row.title,
    preview: readXiaozePreview(row.context),
    createdAt: dateTimeToIso(row.created_at),
    updatedAt: dateTimeToIso(row.updated_at),
    messageCount: Number(row.message_count)
  };
}

export async function listXiaozeThreads(db: Queryable, input: ListXiaozeThreadsInput): Promise<ListXiaozeThreadsResult> {
  const limit = Math.min(Math.max(input.limit ?? XIAOZE_THREAD_DEFAULT_LIMIT, 1), XIAOZE_THREAD_MAX_LIMIT);
  const values: unknown[] = [input.organizationId, input.actorUserId, XIAOZE_PAGE_KEY, "active"];
  const conditions = [
    "s.organization_id = $1",
    "s.actor_user_id = $2",
    "s.page_key = $3",
    "s.status = $4",
    `exists (
      select 1
      from agent_messages m
      where m.session_id = s.id
        and m.organization_id = s.organization_id
        and m.role in ('user', 'assistant', 'reasoning')
        and trim(m.content) <> ''
    )`
  ];

  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (decoded) {
      values.push(decoded.updatedAt, decoded.id);
      const updatedAtParam = `$${values.length - 1}`;
      const idParam = `$${values.length}`;
      conditions.push(`(s.updated_at, s.id) < (${updatedAtParam}::timestamptz, ${idParam})`);
    }
  }

  values.push(limit + 1);
  const limitParam = `$${values.length}`;

  const result = await db.query<XiaozeThreadListRow>(
    `
    select
      s.id,
      s.title,
      s.context,
      s.created_at,
      s.updated_at,
      (
        select count(*)::int
        from agent_messages m
        where m.session_id = s.id
          and m.organization_id = s.organization_id
          and m.role in ('user', 'assistant', 'reasoning')
          and trim(m.content) <> ''
      ) as message_count
    from agent_sessions s
    where ${conditions.join(" and ")}
    order by s.updated_at desc, s.id desc
    limit ${limitParam}
    `,
    values
  );

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const items = rows.map(mapListRow);

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? encodeCursor(items[items.length - 1].updatedAt, items[items.length - 1].id) : null
  };
}

export async function getXiaozeThread(
  db: Queryable,
  organizationId: string,
  actorUserId: string,
  threadId: string
): Promise<XiaozeThreadDetail | null> {
  const session = await getAgentSession(db, organizationId, threadId);
  if (!session || session.pageKey !== XIAOZE_PAGE_KEY || session.actorUserId !== actorUserId || session.status !== "active") {
    return null;
  }

  const messages = (await listAgentMessages(db, organizationId, threadId)).filter(
    (message) => message.role === "user" || message.role === "assistant" || message.role === "reasoning"
  );

  if (messages.length === 0) {
    return null;
  }

  return {
    id: session.id,
    title: session.title,
    preview: readXiaozePreview(session.context),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    context: session.context,
    messages
  };
}

export async function updateXiaozeThreadTitle(
  db: Queryable,
  organizationId: string,
  actorUserId: string,
  threadId: string,
  title: string
): Promise<boolean> {
  const result = await db.query(
    `
    update agent_sessions
    set title = $1,
        updated_at = now()
    where organization_id = $2
      and actor_user_id = $3
      and id = $4
      and page_key = $5
      and status = 'active'
    `,
    [title, organizationId, actorUserId, threadId, XIAOZE_PAGE_KEY]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function archiveXiaozeThread(
  db: Queryable,
  organizationId: string,
  actorUserId: string,
  threadId: string
): Promise<boolean> {
  const result = await db.query(
    `
    update agent_sessions
    set status = 'archived',
        updated_at = now()
    where organization_id = $1
      and actor_user_id = $2
      and id = $3
      and page_key = $4
      and status = 'active'
    `,
    [organizationId, actorUserId, threadId, XIAOZE_PAGE_KEY]
  );

  return (result.rowCount ?? 0) > 0;
}

async function appendAgentMessageIdempotent(db: Queryable, input: XiaozePersistableMessage & { sessionId: string; organizationId: string }) {
  await db.query(
    `
    insert into agent_messages (
      id, session_id, organization_id, role, content, citations, confidence
    )
    values ($1, $2, $3, $4, $5, $6::jsonb, $7)
    on conflict (id) do nothing
    `,
    [
      input.id,
      input.sessionId,
      input.organizationId,
      input.role,
      input.content,
      JSON.stringify(input.citations ?? []),
      null
    ]
  );
}

export async function persistXiaozeTurnMessages(db: Queryable, input: PersistXiaozeTurnMessagesInput): Promise<boolean> {
  const normalizedMessages = input.messages
    .map((message) => ({ ...message, content: message.content.trim() }))
    .filter((message) => message.content.length > 0);

  if (normalizedMessages.length === 0) {
    return false;
  }

  const existing = await getAgentSession(db, input.organizationId, input.threadId);
  const title = deriveThreadTitleFromMessages(normalizedMessages, existing?.title ?? "新对话");
  const preview = deriveThreadPreviewFromMessages(normalizedMessages);
  const context: AgentContext & { xiaoze?: Record<string, unknown> } = {
    path: input.pageContext.path ?? existing?.context.path ?? "",
    pageKey: input.pageContext.pageKey ?? existing?.context.pageKey ?? XIAOZE_PAGE_KEY,
    projectId: input.pageContext.projectId ?? existing?.context.projectId,
    roleId: input.pageContext.roleId ?? existing?.context.roleId,
    xiaoze: {
      preview,
      source: "copilotkit",
      lastRunId: input.runId
    }
  };

  if (!existing) {
    await db.query(
      `
      insert into agent_sessions (
        id, organization_id, project_id, actor_user_id, page_key, role_id, context, title
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      on conflict (id) do nothing
      `,
      [
        input.threadId,
        input.organizationId,
        input.pageContext.projectId ?? null,
        input.actorUserId,
        XIAOZE_PAGE_KEY,
        input.pageContext.roleId ?? null,
        JSON.stringify(context),
        title
      ]
    );
  }

  for (const message of normalizedMessages) {
    await appendAgentMessageIdempotent(db, {
      ...message,
      sessionId: input.threadId,
      organizationId: input.organizationId
    });
  }

  await db.query(
    `
    update agent_sessions
    set title = $1,
        context = $2::jsonb,
        updated_at = now()
    where organization_id = $3
      and actor_user_id = $4
      and id = $5
      and page_key = $6
      and status = 'active'
    `,
    [title, JSON.stringify(context), input.organizationId, input.actorUserId, input.threadId, XIAOZE_PAGE_KEY]
  );

  return true;
}

export function isOwnedXiaozeSession(row: AgentSessionRow | null, actorUserId: string) {
  return !!row && row.page_key === XIAOZE_PAGE_KEY && row.actor_user_id === actorUserId && row.status === "active";
}
