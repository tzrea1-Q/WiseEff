# WiseEff M4 Agent Collaboration MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each implementation step must follow `superpowers:test-driven-development`.

**Goal:** Upgrade WiseAgent from frontend rule simulation into a governed backend-orchestrated Agent MVP with persisted sessions, controlled tool calls, approval records, audit correlation, and API-mode frontend integration.

**Architecture:** Add `server/modules/agent/` to the existing modular monolith. The Agent can read through registered tools after backend permission checks; tools that prepare or mutate durable business state create an approval and execute only after explicit human approval with fresh authz and state checks. Frontend mock mode remains available, while API mode uses the `AgentGateway` HTTP implementation and renders citations, confidence, tool status, and pending approvals.

**Tech Stack:** TypeScript, Node HTTP router, PostgreSQL migrations, Zod, existing auth/audit/parameters/logs/debugging modules, React 19, Vite, Vitest, Testing Library, Playwright.

---

## Scope Boundary

M4 includes:

- Agent sessions, messages, tool calls, approvals, and provider traces persisted in PostgreSQL.
- A backend `ToolRegistry` with read-only tools for parameters, logs, audit, and debugging.
- A narrow approval-backed preparation/write path for `parameter.submitChangeDraft`; approval creates a parameter draft, not a production parameter merge.
- Deterministic provider adapter for stable MVP tests. It chooses tool suggestions from page context and user text, and returns citations/confidence.
- Backend Agent routes from `docs/design-docs/api-contract.md`.
- Audit events for session creation, message receipt, tool call creation, tool execution, approval approve/reject, and approval-backed draft creation.
- Frontend `AgentGateway` HTTP client and API-mode runtime wiring.
- UnifiedAgent rendering of API results, citations, confidence, tool status, and approval actions while preserving mock mode.
- E2E smoke for API-mode Agent session, read tool execution, and approval-backed draft creation.

M4 does not include:

- Real LLM provider integration, model credentials, prompt optimization, streaming tokens, or cost accounting.
- Autonomous production writes, parameter merge, import apply, log archive, device node write, or rollback execution from model output.
- Multi-step planning across sessions or background Agent jobs.
- Tenant-scale rate limiting, prompt injection classification, or generated OpenAPI clients.
- Replacing existing parameter/log/debugging page workflows with an Agent-first UX.

## Success Criteria

- `POST /api/v1/agent/sessions` creates a persisted session scoped by `organizationId`, `userId`, `pageKey`, `projectId`, and `roleId`.
- `POST /api/v1/agent/sessions/:sessionId/messages` stores the user message, runs eligible read tools, stores assistant output, and returns citations/confidence.
- Read tools cannot cross permission or project boundaries. Negative tests cover missing `parameter:view`, `logs:view`, `debugging:view`, and `admin:access`.
- Approval-required tools never execute from `sendMessage` or `run` without a pending approval.
- `POST /api/v1/agent/sessions/:sessionId/approvals/:approvalId/approve` re-checks authz and state, executes `parameter.submitChangeDraft`, creates a parameter draft, marks approval/tool call complete, and writes audit events with the request id as `traceId`.
- `POST /api/v1/agent/sessions/:sessionId/approvals/:approvalId/reject` marks approval and tool call rejected and never creates a draft.
- `VITE_WISEEFF_RUNTIME_MODE=api` causes UnifiedAgent to use the HTTP gateway; mock mode keeps existing local behavior and tests.
- API-mode Agent UI shows returned assistant messages, citations, confidence, tool status, and approval actions without dispatching local write actions before backend approval.
- `npm run test:m4`, `npm run test:all`, `npm run build`, `npm run test:e2e -- e2e/agent.api.spec.ts`, and `git diff --check` pass.

## Backend DTO Contract

M4 keeps the existing frontend Agent concepts and adds status/result fields needed by API mode.

```ts
export type AgentCitation = {
  type: "parameter" | "log" | "audit" | "debugging";
  id: string;
  label: string;
  href?: string;
  snippet?: string;
  confidence?: number;
};

export type AgentToolStatus =
  | "requested"
  | "pending_approval"
  | "running"
  | "succeeded"
  | "failed"
  | "rejected";

export type AgentApprovalStatus = "pending" | "approved" | "rejected";

export type AgentToolResult = {
  summary: string;
  data: Record<string, unknown>;
  citations: AgentCitation[];
};
```

API response envelopes:

```json
{
  "session": {
    "id": "agent-session-1",
    "context": {
      "path": "/parameters",
      "pageKey": "parameters",
      "projectId": "aurora",
      "roleId": "hardware-user"
    },
    "messages": []
  }
}
```

```json
{
  "session": {
    "id": "agent-session-1",
    "context": {
      "path": "/parameters",
      "pageKey": "parameters",
      "projectId": "aurora",
      "roleId": "hardware-user"
    },
    "messages": []
  },
  "messages": [],
  "toolCalls": [],
  "approvals": []
}
```

## File Structure

Create:

- `server/migrations/0008_m4_agent.sql`
- `server/modules/agent/types.ts`
- `server/modules/agent/schemas.ts`
- `server/modules/agent/schemas.test.ts`
- `server/modules/agent/policy.ts`
- `server/modules/agent/repository.ts`
- `server/modules/agent/repository.test.ts`
- `server/modules/agent/toolRegistry.ts`
- `server/modules/agent/toolRegistry.test.ts`
- `server/modules/agent/tools/parameterTools.ts`
- `server/modules/agent/tools/parameterTools.test.ts`
- `server/modules/agent/tools/logTools.ts`
- `server/modules/agent/tools/logTools.test.ts`
- `server/modules/agent/tools/auditTools.ts`
- `server/modules/agent/tools/auditTools.test.ts`
- `server/modules/agent/tools/debuggingTools.ts`
- `server/modules/agent/tools/debuggingTools.test.ts`
- `server/modules/agent/provider.ts`
- `server/modules/agent/orchestrator.ts`
- `server/modules/agent/orchestrator.test.ts`
- `server/modules/agent/routes.ts`
- `server/modules/agent/routes.test.ts`
- `src/infrastructure/http/agentDtos.ts`
- `src/infrastructure/http/agentDtos.test.ts`
- `src/infrastructure/http/agentClient.ts`
- `src/infrastructure/http/agentClient.test.ts`
- `src/application/agent/agentRuntime.ts`
- `src/application/agent/agentRuntime.test.ts`
- `e2e/agent.api.spec.ts`

Modify:

- `server/app.ts`
- `server/modules/contracts/routeManifest.ts`
- `server/modules/contracts/routeManifest.test.ts`
- `server/shared/database/migrationInvariant.test.ts`
- `server/modules/audit/types.ts`
- `src/domain/agent/types.ts`
- `src/domain/domainTypes.test.ts`
- `src/application/ports/AgentGateway.ts`
- `src/infrastructure/mock/mockAgentGateway.ts`
- `src/infrastructure/mock/mockAgentGateway.test.ts`
- `src/features/agent/UnifiedAgent.tsx`
- `src/features/agent/UnifiedAgent.test.tsx`
- `src/App.tsx`
- `src/App.test.tsx`
- `package.json`
- `README.md`
- `docs/FRONTEND.md`
- `docs/SECURITY.md`
- `docs/RELIABILITY.md`
- `docs/QUALITY_SCORE.md`
- `docs/design-docs/api-contract.md`
- `docs/design-docs/domain-model.md`
- `docs/design-docs/testing-strategy.md`
- `docs/generated/db-schema.md`
- `docs/exec-plans/tech-debt-tracker.md`

---

### Task 1: Agent Contract And Schemas

**Files:**
- Modify: `src/domain/agent/types.ts`
- Modify: `src/application/ports/AgentGateway.ts`
- Modify: `src/domain/domainTypes.test.ts`
- Create: `server/modules/agent/types.ts`
- Create: `server/modules/agent/schemas.ts`
- Create: `server/modules/agent/schemas.test.ts`

- [ ] **Step 1: Write failing frontend type tests**

Add this assertion to `src/domain/domainTypes.test.ts`:

```ts
it("keeps the M4 agent turn governance shape", () => {
  const turn: AgentTurn = {
    session: {
      id: "agent-session-1",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
      messages: []
    },
    messages: [
      {
        id: "agent-msg-1",
        role: "assistant",
        content: "Found 2 high-risk parameter changes.",
        citations: [{ type: "parameter", id: "p-fast-charge", label: "Fast charge current", href: "/parameters?parameterId=p-fast-charge" }],
        confidence: 0.86,
        createdAt: "2026-05-27T00:00:00.000Z"
      }
    ],
    toolCalls: [
      {
        id: "tool-1",
        name: "parameter.summarizeReviewQueue",
        label: "Summarize review queue",
        payload: { projectId: "aurora" },
        requiresApproval: false,
        status: "succeeded",
        result: {
          summary: "2 pending changes",
          data: { pending: 2 },
          citations: [{ type: "parameter", id: "change-1", label: "Change request change-1" }]
        },
        createdAt: "2026-05-27T00:00:00.000Z",
        completedAt: "2026-05-27T00:00:01.000Z"
      }
    ],
    approvals: [
      {
        id: "approval-1",
        toolCallId: "tool-2",
        title: "Create parameter draft",
        message: "This will create a parameter draft for human review.",
        status: "pending",
        createdAt: "2026-05-27T00:00:02.000Z"
      }
    ]
  };

  expect(turn.messages[0].citations?.[0].type).toBe("parameter");
  expect(turn.toolCalls[0].status).toBe("succeeded");
  expect(turn.approvals[0].status).toBe("pending");
});
```

Run:

```bash
npm test -- src/domain/domainTypes.test.ts
```

Expected: FAIL because `citations`, `confidence`, `status`, `result`, `createdAt`, `completedAt`, and approval `status` are not yet defined.

- [ ] **Step 2: Extend frontend Agent domain types**

In `src/domain/agent/types.ts`, replace the current type definitions with this M4-compatible shape:

```ts
export type AgentToolName =
  | "parameter.scanOrphans"
  | "parameter.draftCleanupPlan"
  | "parameter.summarizeReviewQueue"
  | "parameter.submitChangeDraft"
  | "log.explainRootCause"
  | "log.generateChecklist"
  | "debugging.recommendTargetValues"
  | "debugging.prepareRollback"
  | "audit.summarizeRecentEvents";

export type AgentContext = {
  path: string;
  pageKey: string;
  projectId?: string;
  roleId?: string;
};

export type AgentCitation = {
  type: "parameter" | "log" | "audit" | "debugging";
  id: string;
  label: string;
  href?: string;
  snippet?: string;
  confidence?: number;
};

export type AgentToolStatus = "requested" | "pending_approval" | "running" | "succeeded" | "failed" | "rejected";

export type AgentApprovalStatus = "pending" | "approved" | "rejected";

export type AgentToolResult = {
  summary: string;
  data: Record<string, unknown>;
  citations: AgentCitation[];
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: AgentCitation[];
  confidence?: number;
  createdAt: string;
};

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  label: string;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
  status: AgentToolStatus;
  result?: AgentToolResult;
  error?: string;
  approvalId?: string;
  auditEventId?: string;
  createdAt?: string;
  completedAt?: string;
};

export type AgentApproval = {
  id: string;
  toolCallId: string;
  title: string;
  message: string;
  status: AgentApprovalStatus;
  createdAt?: string;
  decidedAt?: string;
  decidedByUserId?: string;
  reason?: string;
};

export type AgentSession = {
  id: string;
  context: AgentContext;
  messages: AgentMessage[];
};

export type AgentTurn = {
  session: AgentSession;
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
  approvals: AgentApproval[];
};
```

- [ ] **Step 3: Extend the Agent gateway port**

In `src/application/ports/AgentGateway.ts`, add reject support:

```ts
import type { AgentContext, AgentSession, AgentTurn } from "@/domain/agent/types";

export interface AgentGateway {
  startSession(context: AgentContext): Promise<AgentSession>;
  sendMessage(sessionId: string, message: string): Promise<AgentTurn>;
  runAction(sessionId: string, actionId: string, payload: Record<string, unknown>): Promise<AgentTurn>;
  approveToolCall(sessionId: string, approvalId: string): Promise<AgentTurn>;
  rejectToolCall(sessionId: string, approvalId: string, reason?: string): Promise<AgentTurn>;
}
```

- [ ] **Step 4: Write failing backend schema tests**

Create `server/modules/agent/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  agentContextSchema,
  approveAgentApprovalBodySchema,
  createAgentSessionBodySchema,
  rejectAgentApprovalBodySchema,
  runAgentToolCallBodySchema,
  sendAgentMessageBodySchema
} from "./schemas";

describe("agent schemas", () => {
  it("accepts scoped session context", () => {
    const parsed = createAgentSessionBodySchema.parse({
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
    });

    expect(parsed.context.projectId).toBe("aurora");
  });

  it("rejects blank messages", () => {
    const parsed = sendAgentMessageBodySchema.safeParse({ message: "   " });

    expect(parsed.success).toBe(false);
  });

  it("normalizes optional tool payload", () => {
    const parsed = runAgentToolCallBodySchema.parse({});

    expect(parsed.payload).toEqual({});
  });

  it("accepts approval and rejection bodies", () => {
    expect(approveAgentApprovalBodySchema.parse({ expectedToolCallStatus: "pending_approval" }).expectedToolCallStatus).toBe("pending_approval");
    expect(rejectAgentApprovalBodySchema.parse({ reason: "Needs clearer evidence" }).reason).toBe("Needs clearer evidence");
  });

  it("requires a valid page key in context", () => {
    const parsed = agentContextSchema.safeParse({ path: "/parameters", pageKey: "" });

    expect(parsed.success).toBe(false);
  });
});
```

Run:

```bash
npm run test:server -- server/modules/agent/schemas.test.ts
```

Expected: FAIL because `server/modules/agent/schemas.ts` does not exist.

- [ ] **Step 5: Add backend types and schemas**

Create `server/modules/agent/types.ts`:

```ts
import type { BackendPermission } from "../auth/types";

export type AgentToolName =
  | "parameter.scanOrphans"
  | "parameter.draftCleanupPlan"
  | "parameter.summarizeReviewQueue"
  | "parameter.submitChangeDraft"
  | "log.explainRootCause"
  | "log.generateChecklist"
  | "debugging.recommendTargetValues"
  | "debugging.prepareRollback"
  | "audit.summarizeRecentEvents";

export type AgentContext = {
  path: string;
  pageKey: string;
  projectId?: string;
  roleId?: string;
};

export type AgentCitation = {
  type: "parameter" | "log" | "audit" | "debugging";
  id: string;
  label: string;
  href?: string;
  snippet?: string;
  confidence?: number;
};

export type AgentToolStatus = "requested" | "pending_approval" | "running" | "succeeded" | "failed" | "rejected";
export type AgentApprovalStatus = "pending" | "approved" | "rejected";
export type AgentToolKind = "read" | "preparation" | "mutating";

export type AgentMessageDto = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: AgentCitation[];
  confidence?: number;
  createdAt: string;
};

export type AgentToolResult = {
  summary: string;
  data: Record<string, unknown>;
  citations: AgentCitation[];
};

export type AgentToolCallDto = {
  id: string;
  name: AgentToolName;
  label: string;
  payload: Record<string, unknown>;
  requiresApproval: boolean;
  status: AgentToolStatus;
  result?: AgentToolResult;
  error?: string;
  approvalId?: string;
  auditEventId?: string;
  createdAt?: string;
  completedAt?: string;
};

export type AgentApprovalDto = {
  id: string;
  toolCallId: string;
  title: string;
  message: string;
  status: AgentApprovalStatus;
  createdAt?: string;
  decidedAt?: string;
  decidedByUserId?: string;
  reason?: string;
};

export type AgentSessionDto = {
  id: string;
  context: AgentContext;
  messages: AgentMessageDto[];
};

export type AgentTurnDto = {
  session: AgentSessionDto;
  messages: AgentMessageDto[];
  toolCalls: AgentToolCallDto[];
  approvals: AgentApprovalDto[];
};

export type AgentToolDefinition = {
  name: AgentToolName;
  label: string;
  kind: AgentToolKind;
  permission: BackendPermission;
  requiresApproval: boolean;
};
```

Create `server/modules/agent/schemas.ts`:

```ts
import { z } from "zod";

export const agentContextSchema = z.object({
  path: z.string().min(1),
  pageKey: z.string().min(1),
  projectId: z.string().min(1).optional(),
  roleId: z.string().min(1).optional()
});

export const createAgentSessionBodySchema = z.object({
  context: agentContextSchema
});

export const sendAgentMessageBodySchema = z.object({
  message: z.string().trim().min(1).max(4000)
});

export const runAgentToolCallBodySchema = z.object({
  payload: z.record(z.unknown()).default({})
});

export const approveAgentApprovalBodySchema = z.object({
  expectedToolCallStatus: z.literal("pending_approval").optional()
});

export const rejectAgentApprovalBodySchema = z.object({
  reason: z.string().trim().min(1).max(500).optional()
});
```

- [ ] **Step 6: Run contract/schema tests**

Run:

```bash
npm test -- src/domain/domainTypes.test.ts
npm run test:server -- server/modules/agent/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/agent/types.ts src/application/ports/AgentGateway.ts src/domain/domainTypes.test.ts server/modules/agent/types.ts server/modules/agent/schemas.ts server/modules/agent/schemas.test.ts
git commit -m "feat(agent): define m4 governed agent contract"
```

---

### Task 2: Agent Persistence Migration And Repository

**Files:**
- Create: `server/migrations/0008_m4_agent.sql`
- Modify: `server/shared/database/migrationInvariant.test.ts`
- Create: `server/modules/agent/repository.ts`
- Create: `server/modules/agent/repository.test.ts`

- [ ] **Step 1: Write failing migration invariant test**

Add this test to `server/shared/database/migrationInvariant.test.ts`:

```ts
describe("M4 agent migration invariants", () => {
  it("persists sessions, messages, tool calls, approvals, and traces", () => {
    const migration = readFileSync(path.join(root, "server", "migrations", "0008_m4_agent.sql"), "utf8");

    expect(migration).toContain("create table if not exists agent_sessions");
    expect(migration).toContain("create table if not exists agent_messages");
    expect(migration).toContain("create table if not exists agent_tool_calls");
    expect(migration).toContain("create table if not exists agent_approvals");
    expect(migration).toContain("create table if not exists agent_run_traces");
    expect(migration).toContain("agent_approvals_tool_call_unique_idx");
    expect(migration).toContain("agent_sessions_context_scope_idx");
  });
});
```

Run:

```bash
npm run test:server -- server/shared/database/migrationInvariant.test.ts
```

Expected: FAIL because `0008_m4_agent.sql` does not exist.

- [ ] **Step 2: Add the M4 Agent migration**

Create `server/migrations/0008_m4_agent.sql`:

```sql
create table if not exists agent_sessions (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text,
  actor_user_id text not null references users(id),
  page_key text not null,
  role_id text,
  context jsonb not null,
  status text not null default 'active',
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_messages (
  id text primary key,
  session_id text not null references agent_sessions(id) on delete cascade,
  organization_id text not null references organizations(id),
  role text not null,
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  confidence numeric,
  created_at timestamptz not null default now()
);

create table if not exists agent_tool_calls (
  id text primary key,
  session_id text not null references agent_sessions(id) on delete cascade,
  organization_id text not null references organizations(id),
  project_id text,
  name text not null,
  label text not null,
  payload jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default false,
  status text not null,
  result jsonb,
  error_message text,
  audit_event_id text references audit_events(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_approvals (
  id text primary key,
  session_id text not null references agent_sessions(id) on delete cascade,
  tool_call_id text not null references agent_tool_calls(id) on delete cascade,
  organization_id text not null references organizations(id),
  project_id text,
  status text not null,
  title text not null,
  message text not null,
  requested_by_user_id text not null references users(id),
  decided_by_user_id text references users(id),
  decision_reason text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists agent_run_traces (
  id text primary key,
  session_id text not null references agent_sessions(id) on delete cascade,
  message_id text references agent_messages(id) on delete set null,
  organization_id text not null references organizations(id),
  provider text not null,
  model text not null,
  prompt_version text not null,
  input_summary text not null,
  output_summary text not null,
  tool_call_ids text[] not null default '{}',
  trace_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_sessions_context_scope_idx on agent_sessions(page_key, project_id, role_id, created_at desc);
create index if not exists agent_sessions_actor_idx on agent_sessions(actor_user_id, created_at desc);
create index if not exists agent_messages_session_idx on agent_messages(session_id, created_at asc);
create index if not exists agent_tool_calls_session_idx on agent_tool_calls(session_id, created_at asc);
create index if not exists agent_tool_calls_name_idx on agent_tool_calls(name, requires_approval, status);
create unique index if not exists agent_approvals_tool_call_unique_idx on agent_approvals(tool_call_id);
create index if not exists agent_approvals_session_status_idx on agent_approvals(session_id, status, requested_at desc);
create index if not exists agent_run_traces_session_idx on agent_run_traces(session_id, created_at desc);
```

- [ ] **Step 3: Write failing repository tests**

Create `server/modules/agent/repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Queryable } from "../../shared/database/client";
import {
  appendAgentMessage,
  createAgentApproval,
  createAgentSession,
  createAgentToolCall,
  getAgentSession,
  listAgentApprovals,
  listAgentMessages,
  listAgentToolCalls,
  markAgentApprovalApproved,
  markAgentApprovalRejected,
  updateAgentToolCall
} from "./repository";

function createRecordingDb(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows: rows as Row[], rowCount: rows.length };
    }
  };
  return { db, calls };
}

describe("agent repository", () => {
  it("creates sessions with scoped context", async () => {
    const { db, calls } = createRecordingDb();

    await createAgentSession(db, {
      id: "agent-session-1",
      organizationId: "org-chargelab",
      projectId: "aurora",
      actorUserId: "u-xu-yun",
      pageKey: "parameters",
      roleId: "hardware-user",
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
      title: "Project parameter patrol"
    });

    expect(calls[0].text).toContain("insert into agent_sessions");
    expect(calls[0].values).toContain("agent-session-1");
    expect(calls[0].values).toContain("parameters");
  });

  it("maps session rows into DTOs", async () => {
    const { db } = createRecordingDb([
      {
        id: "agent-session-1",
        organization_id: "org-chargelab",
        project_id: "aurora",
        actor_user_id: "u-xu-yun",
        page_key: "parameters",
        role_id: "hardware-user",
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
        status: "active",
        title: "Project parameter patrol",
        created_at: "2026-05-27T00:00:00.000Z",
        updated_at: "2026-05-27T00:00:00.000Z"
      }
    ]);

    const session = await getAgentSession(db, "org-chargelab", "agent-session-1");

    expect(session?.context.projectId).toBe("aurora");
  });

  it("creates messages, tool calls, approvals, and approval decisions", async () => {
    const { db, calls } = createRecordingDb();

    await appendAgentMessage(db, {
      id: "agent-msg-1",
      sessionId: "agent-session-1",
      organizationId: "org-chargelab",
      role: "assistant",
      content: "2 pending review items.",
      citations: [{ type: "parameter", id: "change-1", label: "Change request change-1" }],
      confidence: 0.84
    });
    await createAgentToolCall(db, {
      id: "tool-1",
      sessionId: "agent-session-1",
      organizationId: "org-chargelab",
      projectId: "aurora",
      name: "parameter.summarizeReviewQueue",
      label: "Summarize review queue",
      payload: { projectId: "aurora" },
      requiresApproval: false,
      status: "requested"
    });
    await updateAgentToolCall(db, "org-chargelab", "tool-1", {
      status: "succeeded",
      result: { summary: "2 pending", data: { pending: 2 }, citations: [] },
      auditEventId: "audit-1"
    });
    await createAgentApproval(db, {
      id: "approval-1",
      sessionId: "agent-session-1",
      toolCallId: "tool-2",
      organizationId: "org-chargelab",
      projectId: "aurora",
      status: "pending",
      title: "Create parameter draft",
      message: "This will create a draft.",
      requestedByUserId: "u-xu-yun"
    });
    await markAgentApprovalApproved(db, "org-chargelab", "approval-1", "u-xu-yun");
    await markAgentApprovalRejected(db, "org-chargelab", "approval-2", "u-xu-yun", "Need clearer evidence");

    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_messages");
    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_tool_calls");
    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_approvals");
    expect(calls.map((call) => call.text).join("\n")).toContain("decided_at = now()");
  });

  it("lists messages, tool calls, and approvals for a session", async () => {
    const { db } = createRecordingDb([]);

    await listAgentMessages(db, "org-chargelab", "agent-session-1");
    await listAgentToolCalls(db, "org-chargelab", "agent-session-1");
    await listAgentApprovals(db, "org-chargelab", "agent-session-1");

    expect(true).toBe(true);
  });
});
```

Run:

```bash
npm run test:server -- server/modules/agent/repository.test.ts
```

Expected: FAIL because `repository.ts` does not exist.

- [ ] **Step 4: Implement repository helpers**

Create `server/modules/agent/repository.ts` with row mappers and exported functions named in the tests. Use these DTO rules:

```ts
function jsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}
```

The repository must:

- Serialize `context`, `payload`, `citations`, and `result` with `JSON.stringify`.
- Filter all reads and updates by `organization_id`.
- Set `updated_at = now()` on tool call updates.
- Refuse approval updates unless `status = 'pending'` in the SQL `where` clause.
- Return `null` from `getAgentSession` when no row is found.

- [ ] **Step 5: Run repository and migration tests**

Run:

```bash
npm run test:server -- server/shared/database/migrationInvariant.test.ts server/modules/agent/repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/migrations/0008_m4_agent.sql server/shared/database/migrationInvariant.test.ts server/modules/agent/repository.ts server/modules/agent/repository.test.ts
git commit -m "feat(agent): persist sessions tool calls and approvals"
```

---

### Task 3: Tool Registry And Read-Only Tools

**Files:**
- Create: `server/modules/agent/policy.ts`
- Create: `server/modules/agent/toolRegistry.ts`
- Create: `server/modules/agent/toolRegistry.test.ts`
- Create: `server/modules/agent/tools/parameterTools.ts`
- Create: `server/modules/agent/tools/parameterTools.test.ts`
- Create: `server/modules/agent/tools/logTools.ts`
- Create: `server/modules/agent/tools/logTools.test.ts`
- Create: `server/modules/agent/tools/auditTools.ts`
- Create: `server/modules/agent/tools/auditTools.test.ts`
- Create: `server/modules/agent/tools/debuggingTools.ts`
- Create: `server/modules/agent/tools/debuggingTools.test.ts`

- [ ] **Step 1: Write failing registry tests**

Create `server/modules/agent/toolRegistry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiError } from "../../shared/http/errors";
import { createAgentToolRegistry } from "./toolRegistry";

describe("agent tool registry", () => {
  it("registers the M4 tool surface with approval classification", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });

    expect(registry.get("parameter.summarizeReviewQueue")?.requiresApproval).toBe(false);
    expect(registry.get("audit.summarizeRecentEvents")?.permission).toBe("admin:access");
    expect(registry.get("parameter.submitChangeDraft")?.requiresApproval).toBe(true);
  });

  it("rejects unknown tools", async () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } });

    expect(() => registry.require("missing.tool")).toThrow(ApiError);
  });
});
```

Run:

```bash
npm run test:server -- server/modules/agent/toolRegistry.test.ts
```

Expected: FAIL because `toolRegistry.ts` does not exist.

- [ ] **Step 2: Add Agent policy helpers**

Create `server/modules/agent/policy.ts`:

```ts
import { ApiError } from "../../shared/http/errors";
import type { AuthContext, BackendPermission } from "../auth/types";

export function requireAgentPermission(auth: AuthContext, permission: BackendPermission) {
  if (!auth.user.isActive || !auth.permissions.includes(permission)) {
    throw new ApiError("FORBIDDEN", `Missing permission: ${permission}.`, 403, { permission });
  }
}

export function requireAgentProjectAccess(auth: AuthContext, projectId?: string) {
  if (!projectId) {
    return;
  }
  const hasGlobalAdmin = auth.roles.some((role) => role.roleId === "admin" && role.projectId === null);
  const hasProjectRole = auth.roles.some((role) => role.projectId === projectId);
  if (!hasGlobalAdmin && !hasProjectRole) {
    throw new ApiError("FORBIDDEN", "Agent project access is required.", 403, { projectId });
  }
}
```

- [ ] **Step 3: Implement the registry interface**

Create `server/modules/agent/toolRegistry.ts`:

```ts
import { ApiError } from "../../shared/http/errors";
import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import type { AgentToolName, AgentToolResult } from "./types";
import { requireAgentPermission, requireAgentProjectAccess } from "./policy";
import { createAuditTools } from "./tools/auditTools";
import { createDebuggingTools } from "./tools/debuggingTools";
import { createLogTools } from "./tools/logTools";
import { createParameterTools } from "./tools/parameterTools";

export type AgentToolExecutionContext = {
  auth: AuthContext;
  requestId: string;
  sessionId: string;
  projectId?: string;
};

export type AgentToolDefinition = {
  name: AgentToolName;
  label: string;
  kind: "read" | "preparation" | "mutating";
  permission: Parameters<typeof requireAgentPermission>[1];
  requiresApproval: boolean;
  run(context: AgentToolExecutionContext, payload: Record<string, unknown>): Promise<AgentToolResult>;
};

export function createAgentToolRegistry(options: { db: Database | { query: Database["query"] } }) {
  const tools = [
    ...createParameterTools(options),
    ...createLogTools(options),
    ...createAuditTools(options),
    ...createDebuggingTools(options)
  ];
  const byName = new Map<string, AgentToolDefinition>(tools.map((tool) => [tool.name, tool]));

  return {
    list: () => tools,
    get: (name: string) => byName.get(name),
    require(name: string) {
      const tool = byName.get(name);
      if (!tool) {
        throw new ApiError("VALIDATION_FAILED", "Unknown Agent tool.", 400, { toolName: name });
      }
      return tool;
    },
    async run(name: AgentToolName, context: AgentToolExecutionContext, payload: Record<string, unknown>) {
      const tool = this.require(name);
      requireAgentPermission(context.auth, tool.permission);
      requireAgentProjectAccess(context.auth, context.projectId);
      return tool.run(context, payload);
    }
  };
}
```

- [ ] **Step 4: Write failing parameter tool tests**

Create `server/modules/agent/tools/parameterTools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { developmentAuthContext } from "../../auth/routes";
import { createParameterTools } from "./parameterTools";

describe("agent parameter tools", () => {
  it("summarizes review queue with citations", async () => {
    const db = {
      query: async <Row,>(text: string) => ({
        rows: text.includes("parameter_change_requests")
          ? [
              {
                id: "change-1",
                project_id: "aurora",
                parameter_id: "p-fast-charge",
                parameter_name: "Fast charge current",
                status: "submitted",
                risk: "High"
              } as Row
            ]
          : [],
        rowCount: 1
      })
    };
    const tool = createParameterTools({ db }).find((item) => item.name === "parameter.summarizeReviewQueue");
    const result = await tool?.run(
      { auth: developmentAuthContext, requestId: "req-1", sessionId: "agent-session-1", projectId: "aurora" },
      { projectId: "aurora" }
    );

    expect(result?.summary).toContain("1");
    expect(result?.citations[0]).toEqual(expect.objectContaining({ type: "parameter", id: "change-1" }));
  });

  it("classifies submit change draft as approval required", () => {
    const tool = createParameterTools({ db: { query: async () => ({ rows: [], rowCount: 0 }) } }).find(
      (item) => item.name === "parameter.submitChangeDraft"
    );

    expect(tool?.requiresApproval).toBe(true);
    expect(tool?.permission).toBe("parameter:edit");
  });
});
```

Expected after running targeted test: FAIL because `parameterTools.ts` does not exist.

- [ ] **Step 5: Add parameter tools**

Create `server/modules/agent/tools/parameterTools.ts` with these tools:

- `parameter.scanOrphans`: `admin:access`, read-only. Query parameters for the project and return definitions without recent values or with no project usage.
- `parameter.summarizeReviewQueue`: `parameter:review`, read-only. Query `parameter_change_requests` and include status/risk counts.
- `parameter.draftCleanupPlan`: `admin:access`, preparation, approval required. Return a cleanup plan in `AgentToolResult`; do not delete parameters.
- `parameter.submitChangeDraft`: `parameter:edit`, preparation, approval required. Approval execution later creates one `parameter_drafts` row through the parameter service/repository.

Use direct SQL for read summaries. The query for review queue must include these fields:

```sql
select
  cr.id,
  cr.project_id,
  cr.parameter_id,
  pd.name as parameter_name,
  cr.status,
  pd.risk
from parameter_change_requests cr
join project_parameter_values ppv on ppv.id = cr.project_parameter_value_id
join parameter_definitions pd on pd.id = ppv.parameter_id
where cr.organization_id = $1
  and ($2::text is null or cr.project_id = $2)
order by cr.created_at desc
limit 20
```

- [ ] **Step 6: Add log, audit, and debugging tools**

Create tests first:

```bash
npm run test:server -- server/modules/agent/tools/logTools.test.ts
npm run test:server -- server/modules/agent/tools/auditTools.test.ts
npm run test:server -- server/modules/agent/tools/debuggingTools.test.ts
```

Expected before implementation: FAIL because files do not exist.

Then create:

- `server/modules/agent/tools/logTools.ts`
  - `log.explainRootCause`: `logs:view`, read-only. Query recent `log_records` with `status`, `severity`, `confidence`, `conclusion`, and return citations pointing to `/logs?logId=<id>`.
  - `log.generateChecklist`: `logs:view`, read-only. Query recent failed/high-severity logs and return checklist strings in `data.items`.
- `server/modules/agent/tools/auditTools.ts`
  - `audit.summarizeRecentEvents`: `admin:access`, read-only. Query `audit_events` filtered by organization/project, return event kind counts and citations.
- `server/modules/agent/tools/debuggingTools.ts`
  - `debugging.recommendTargetValues`: `debugging:view`, read-only. Query `debugging_parameters` and return writable pending/high-risk candidates with citations.
  - `debugging.prepareRollback`: `debugging:rollback`, preparation, approval required. Return a rollback plan summary from latest `debugging_snapshots`; do not call rollback.

Each tool test must verify:

- permission metadata,
- `requiresApproval` value,
- result `summary`,
- at least one citation for non-empty rows.

- [ ] **Step 7: Run tool tests**

Run:

```bash
npm run test:server -- server/modules/agent/toolRegistry.test.ts server/modules/agent/tools/parameterTools.test.ts server/modules/agent/tools/logTools.test.ts server/modules/agent/tools/auditTools.test.ts server/modules/agent/tools/debuggingTools.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/modules/agent/policy.ts server/modules/agent/toolRegistry.ts server/modules/agent/toolRegistry.test.ts server/modules/agent/tools
git commit -m "feat(agent): add governed tool registry"
```

---

### Task 4: Deterministic Provider And Orchestrator

**Files:**
- Create: `server/modules/agent/provider.ts`
- Create: `server/modules/agent/orchestrator.ts`
- Create: `server/modules/agent/orchestrator.test.ts`
- Modify: `server/modules/agent/repository.ts`
- Modify: `server/modules/agent/repository.test.ts`

- [ ] **Step 1: Write failing provider tests**

Create the provider section inside `server/modules/agent/orchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { developmentAuthContext } from "../auth/routes";
import { createDeterministicAgentProvider } from "./provider";

describe("deterministic agent provider", () => {
  it("selects parameter review and draft tools from parameter context", () => {
    const provider = createDeterministicAgentProvider();
    const plan = provider.planTurn({
      context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
      message: "帮我总结审阅队列，并准备一个参数草稿"
    });

    expect(plan.toolRequests.map((tool) => tool.name)).toEqual([
      "parameter.summarizeReviewQueue",
      "parameter.submitChangeDraft"
    ]);
    expect(plan.assistantDraft.confidence).toBeGreaterThan(0.7);
  });
});
```

Run:

```bash
npm run test:server -- server/modules/agent/orchestrator.test.ts
```

Expected: FAIL because `provider.ts` does not exist.

- [ ] **Step 2: Implement deterministic provider**

Create `server/modules/agent/provider.ts`:

```ts
import type { AgentContext, AgentMessageDto, AgentToolName } from "./types";

export type AgentToolRequest = {
  name: AgentToolName;
  label: string;
  payload: Record<string, unknown>;
};

export type AgentProviderInput = {
  context: AgentContext;
  message: string;
};

export type AgentProviderPlan = {
  assistantDraft: Pick<AgentMessageDto, "content" | "citations" | "confidence">;
  toolRequests: AgentToolRequest[];
  provider: "deterministic";
  model: "wiseeff-rules-m4";
  promptVersion: "m4-agent-v1";
};

function includesAny(text: string, words: string[]) {
  const normalized = text.toLowerCase();
  return words.some((word) => normalized.includes(word.toLowerCase()));
}

export function createDeterministicAgentProvider() {
  return {
    planTurn(input: AgentProviderInput): AgentProviderPlan {
      const toolRequests: AgentToolRequest[] = [];
      const projectId = input.context.projectId;
      const pageKey = input.context.pageKey;

      if (pageKey.includes("parameter")) {
        toolRequests.push({
          name: "parameter.summarizeReviewQueue",
          label: "Summarize review queue",
          payload: { projectId }
        });
      }
      if (pageKey === "parameter-admin" || includesAny(input.message, ["闲置", "orphan", "cleanup"])) {
        toolRequests.push({
          name: "parameter.scanOrphans",
          label: "Scan orphan parameters",
          payload: { projectId }
        });
      }
      if (includesAny(input.message, ["草稿", "draft", "修改"])) {
        toolRequests.push({
          name: "parameter.submitChangeDraft",
          label: "Create parameter draft",
          payload: { projectId, reason: input.message }
        });
      }
      if (pageKey.includes("log")) {
        toolRequests.push({
          name: "log.explainRootCause",
          label: "Explain root cause",
          payload: { projectId }
        });
      }
      if (pageKey.includes("debugging")) {
        toolRequests.push({
          name: "debugging.recommendTargetValues",
          label: "Recommend target values",
          payload: { projectId }
        });
      }
      if (includesAny(input.message, ["审计", "audit", "治理"])) {
        toolRequests.push({
          name: "audit.summarizeRecentEvents",
          label: "Summarize recent audit events",
          payload: { projectId }
        });
      }

      return {
        assistantDraft: {
          content: "我会基于当前页面上下文调用受控工具，并把需要人工批准的动作单独列出。",
          citations: [],
          confidence: 0.78
        },
        toolRequests,
        provider: "deterministic",
        model: "wiseeff-rules-m4",
        promptVersion: "m4-agent-v1"
      };
    }
  };
}
```

- [ ] **Step 3: Write failing orchestrator tests**

Append these tests to `server/modules/agent/orchestrator.test.ts`:

```ts
import { createAgentOrchestrator } from "./orchestrator";

function createMemoryDb() {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    calls,
    db: {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: [] as Row[], rowCount: 0 };
      },
      transaction: async <T,>(fn: (tx: { query: typeof this.db.query }) => Promise<T>) => fn(this.db)
    }
  };
}

describe("agent orchestrator", () => {
  it("creates sessions and records a system message", async () => {
    const { db, calls } = createMemoryDb();
    const orchestrator = createAgentOrchestrator({
      db,
      createAuditEvent: vi.fn(async () => undefined),
      toolRegistry: {
        require: vi.fn(),
        run: vi.fn(),
        get: vi.fn(),
        list: vi.fn(() => [])
      }
    });

    const session = await orchestrator.startSession(
      developmentAuthContext,
      { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
      { requestId: "req-agent-1" }
    );

    expect(session.context.pageKey).toBe("parameters");
    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_sessions");
    expect(calls.map((call) => call.text).join("\n")).toContain("insert into agent_messages");
  });

  it("creates pending approval instead of executing approval-required tools", async () => {
    const { db } = createMemoryDb();
    const toolRegistry = {
      require: vi.fn((name: string) => ({
        name,
        label: "Create parameter draft",
        permission: "parameter:edit",
        kind: "preparation",
        requiresApproval: true
      })),
      run: vi.fn(),
      get: vi.fn(),
      list: vi.fn(() => [])
    };
    const orchestrator = createAgentOrchestrator({
      db,
      createAuditEvent: vi.fn(async () => undefined),
      toolRegistry
    });

    await orchestrator.recordToolRequestForTest(
      developmentAuthContext,
      {
        sessionId: "agent-session-1",
        name: "parameter.submitChangeDraft",
        label: "Create parameter draft",
        payload: { projectId: "aurora" },
        projectId: "aurora"
      },
      { requestId: "req-agent-2" }
    );

    expect(toolRegistry.run).not.toHaveBeenCalled();
  });
});
```

Expected after running targeted test: FAIL because `orchestrator.ts` does not exist and repository list helpers are incomplete for assembling a turn.

- [ ] **Step 4: Implement orchestrator**

Create `server/modules/agent/orchestrator.ts`. The orchestrator must expose:

```ts
export function createAgentOrchestrator(options: {
  db: Database;
  toolRegistry?: ReturnType<typeof createAgentToolRegistry>;
  provider?: ReturnType<typeof createDeterministicAgentProvider>;
  createAuditEvent?: typeof defaultCreateAuditEvent;
}) {
  return {
    startSession,
    sendMessage,
    runToolCall,
    approveToolCall,
    rejectToolCall,
    recordToolRequestForTest
  };
}
```

Implementation rules:

- `startSession` writes `agent_sessions`, a system message, and an audit event with `kind: "agent-session"`.
- `sendMessage` verifies session ownership by organization, appends the user message, calls provider, records a run trace, and records tool calls.
- Read tools execute immediately, update status to `succeeded` or `failed`, and create audit events.
- Approval-required tools set status `pending_approval`, create `agent_approvals`, and create an audit event. They do not call `toolRegistry.run`.
- `runToolCall` rejects `pending_approval` with `ApiError("APPROVAL_REQUIRED", "Tool call requires approval.", 409)`.
- `approveToolCall` loads the pending approval, re-checks the registered tool permission/project access by calling the registry, executes the tool, marks the approval approved, updates the tool call to `succeeded`, and appends an assistant message.
- `rejectToolCall` marks approval rejected, updates the tool call to `rejected`, and appends an assistant message.
- All audit events use `traceId: context.requestId`.

- [ ] **Step 5: Add approval execution for parameter draft**

In `parameter.submitChangeDraft` execution, require payload fields:

```ts
{
  projectId: string;
  parameterId?: string;
  targetValue?: string;
  reason: string;
}
```

When `parameterId` or `targetValue` is missing, choose a safe default by reading the first editable parameter for the project and using its current value as `targetValue`. This creates a draft record but does not change production parameter values.

Expected result:

```ts
{
  summary: "Created one parameter draft for human review.",
  data: { draftId: "generated-draft-id", projectId: "aurora" },
  citations: [{ type: "parameter", id: "generated-draft-id", label: "Parameter draft generated-draft-id" }]
}
```

- [ ] **Step 6: Run orchestrator tests**

Run:

```bash
npm run test:server -- server/modules/agent/orchestrator.test.ts server/modules/agent/repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/modules/agent/provider.ts server/modules/agent/orchestrator.ts server/modules/agent/orchestrator.test.ts server/modules/agent/repository.ts server/modules/agent/repository.test.ts server/modules/agent/tools/parameterTools.ts server/modules/agent/tools/parameterTools.test.ts
git commit -m "feat(agent): orchestrate deterministic tool turns"
```

---

### Task 5: Agent HTTP Routes And Route Manifest

**Files:**
- Create: `server/modules/agent/routes.ts`
- Create: `server/modules/agent/routes.test.ts`
- Modify: `server/app.ts`
- Modify: `server/modules/contracts/routeManifest.ts`
- Modify: `server/modules/contracts/routeManifest.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `server/modules/agent/routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";

describe("agent routes", () => {
  it("rejects session creation without a database adapter", async () => {
    const response = await requestJson<{ error: { code: string } }>(createWiseEffServer(), "/api/v1/agent/sessions", {
      method: "POST",
      body: JSON.stringify({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" }
      })
    });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("validates blank messages", async () => {
    const response = await requestJson<{ error: { code: string } }>(createWiseEffServer(), "/api/v1/agent/sessions/agent-session-1/messages", {
      method: "POST",
      body: JSON.stringify({ message: "   " })
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });
});
```

Run:

```bash
npm run test:server -- server/modules/agent/routes.test.ts
```

Expected: FAIL because Agent routes are not registered.

- [ ] **Step 2: Implement route registration**

Create `server/modules/agent/routes.ts`:

```ts
import { z } from "zod";
import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  approveAgentApprovalBodySchema,
  createAgentSessionBodySchema,
  rejectAgentApprovalBodySchema,
  runAgentToolCallBodySchema,
  sendAgentMessageBodySchema
} from "./schemas";
import { createAgentOrchestrator } from "./orchestrator";

const paramsWithSessionIdSchema = z.object({ sessionId: z.string().min(1) });
const paramsWithSessionAndToolCallSchema = z.object({ sessionId: z.string().min(1), toolCallId: z.string().min(1) });
const paramsWithSessionAndApprovalSchema = z.object({ sessionId: z.string().min(1), approvalId: z.string().min(1) });

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for agent routes.", 500);
  }
  return db;
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid agent route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function registerAgentRoutes(
  router: WiseEffRouter,
  options: { db?: Database; getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext }
) {
  router.post("/api/v1/agent/sessions", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createAgentSessionBodySchema, request.body);
    const session = await createAgentOrchestrator({ db }).startSession(auth, body.context, { requestId: request.requestId });
    return { status: 201, body: { session } };
  });

  router.post("/api/v1/agent/sessions/:sessionId/messages", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithSessionIdSchema, request.params);
    const body = parseWithSchema(sendAgentMessageBodySchema, request.body);
    const turn = await createAgentOrchestrator({ db }).sendMessage(auth, params.sessionId, body.message, { requestId: request.requestId });
    return { status: 200, body: turn };
  });

  router.post("/api/v1/agent/sessions/:sessionId/tool-calls/:toolCallId/run", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithSessionAndToolCallSchema, request.params);
    const body = parseWithSchema(runAgentToolCallBodySchema, request.body);
    const turn = await createAgentOrchestrator({ db }).runToolCall(auth, params.sessionId, params.toolCallId, body.payload, {
      requestId: request.requestId
    });
    return { status: 200, body: turn };
  });

  router.post("/api/v1/agent/sessions/:sessionId/approvals/:approvalId/approve", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithSessionAndApprovalSchema, request.params);
    parseWithSchema(approveAgentApprovalBodySchema, request.body ?? {});
    const turn = await createAgentOrchestrator({ db }).approveToolCall(auth, params.sessionId, params.approvalId, {
      requestId: request.requestId
    });
    return { status: 200, body: turn };
  });

  router.post("/api/v1/agent/sessions/:sessionId/approvals/:approvalId/reject", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithSessionAndApprovalSchema, request.params);
    const body = parseWithSchema(rejectAgentApprovalBodySchema, request.body ?? {});
    const turn = await createAgentOrchestrator({ db }).rejectToolCall(auth, params.sessionId, params.approvalId, body.reason, {
      requestId: request.requestId
    });
    return { status: 200, body: turn };
  });
}
```

- [ ] **Step 3: Register routes in the app**

Modify `server/app.ts`:

```ts
import { registerAgentRoutes } from "./modules/agent/routes";
```

Register after debugging routes:

```ts
  registerAgentRoutes(router, {
    db: options.db,
    getCurrentAuthContext: (request) => getCurrentAuthContext(options, request)
  });
```

- [ ] **Step 4: Add route manifest entries**

Modify `server/modules/contracts/routeManifest.ts`:

```ts
export type RouteModule = "auth" | "audit" | "parameters" | "logs" | "jobs" | "debugging" | "operations" | "agent";
```

Add entries before operations:

```ts
  { id: "agent.createSession", method: "POST", path: "/api/v1/agent/sessions", module: "agent", stability: "mvp" },
  { id: "agent.sendMessage", method: "POST", path: "/api/v1/agent/sessions/:sessionId/messages", module: "agent", stability: "mvp" },
  { id: "agent.runToolCall", method: "POST", path: "/api/v1/agent/sessions/:sessionId/tool-calls/:toolCallId/run", module: "agent", stability: "mvp" },
  { id: "agent.approveToolCall", method: "POST", path: "/api/v1/agent/sessions/:sessionId/approvals/:approvalId/approve", module: "agent", stability: "mvp" },
  { id: "agent.rejectToolCall", method: "POST", path: "/api/v1/agent/sessions/:sessionId/approvals/:approvalId/reject", module: "agent", stability: "mvp" },
```

Modify `server/modules/contracts/routeManifest.test.ts` so the route group assertion includes `"agent"` and locks `agent.approveToolCall`.

- [ ] **Step 5: Add route integration tests for approval behavior**

Extend `server/modules/agent/routes.test.ts` with a fake database that returns rows for session and approval reads. Verify:

- session creation returns `201`,
- blank message returns `400`,
- unknown session returns `404`,
- run approval-required tool returns `409 APPROVAL_REQUIRED`,
- reject approval returns `200` and does not call parameter draft insert,
- approve approval returns `200` and includes a succeeded tool call.

- [ ] **Step 6: Run route and manifest tests**

Run:

```bash
npm run test:server -- server/modules/agent/routes.test.ts server/modules/contracts/routeManifest.test.ts server/app.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/modules/agent/routes.ts server/modules/agent/routes.test.ts server/app.ts server/modules/contracts/routeManifest.ts server/modules/contracts/routeManifest.test.ts
git commit -m "feat(agent): expose governed agent api routes"
```

---

### Task 6: Frontend HTTP Gateway And Runtime

**Files:**
- Create: `src/infrastructure/http/agentDtos.ts`
- Create: `src/infrastructure/http/agentDtos.test.ts`
- Create: `src/infrastructure/http/agentClient.ts`
- Create: `src/infrastructure/http/agentClient.test.ts`
- Create: `src/application/agent/agentRuntime.ts`
- Create: `src/application/agent/agentRuntime.test.ts`
- Modify: `src/infrastructure/mock/mockAgentGateway.ts`
- Modify: `src/infrastructure/mock/mockAgentGateway.test.ts`

- [ ] **Step 1: Write failing DTO tests**

Create `src/infrastructure/http/agentDtos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { agentApprovalFromDto, agentMessageFromDto, agentToolCallFromDto } from "./agentDtos";

describe("agent DTO mapping", () => {
  it("maps citations, confidence, tool status, and approval status", () => {
    expect(
      agentMessageFromDto({
        id: "agent-msg-1",
        role: "assistant",
        content: "Review summary",
        citations: [{ type: "parameter", id: "change-1", label: "Change request change-1" }],
        confidence: 0.82,
        createdAt: "2026-05-27T00:00:00.000Z"
      }).confidence
    ).toBe(0.82);

    expect(
      agentToolCallFromDto({
        id: "tool-1",
        name: "parameter.summarizeReviewQueue",
        label: "Summarize review queue",
        payload: { projectId: "aurora" },
        requiresApproval: false,
        status: "succeeded",
        result: { summary: "2 pending", data: { pending: 2 }, citations: [] },
        createdAt: "2026-05-27T00:00:00.000Z",
        completedAt: "2026-05-27T00:00:01.000Z"
      }).status
    ).toBe("succeeded");

    expect(
      agentApprovalFromDto({
        id: "approval-1",
        toolCallId: "tool-2",
        title: "Create parameter draft",
        message: "This will create a draft.",
        status: "pending",
        createdAt: "2026-05-27T00:00:00.000Z"
      }).status
    ).toBe("pending");
  });
});
```

Expected: FAIL because DTO file does not exist.

- [ ] **Step 2: Implement DTO mappers**

Create `src/infrastructure/http/agentDtos.ts` exporting DTO types and identity mappers:

```ts
import type { AgentApproval, AgentMessage, AgentSession, AgentToolCall, AgentTurn } from "@/domain/agent/types";

export type AgentMessageDto = AgentMessage;
export type AgentSessionDto = AgentSession;
export type AgentToolCallDto = AgentToolCall;
export type AgentApprovalDto = AgentApproval;
export type AgentTurnDto = AgentTurn;

export function agentMessageFromDto(dto: AgentMessageDto): AgentMessage {
  return { ...dto };
}

export function agentSessionFromDto(dto: AgentSessionDto): AgentSession {
  return { ...dto, messages: dto.messages.map(agentMessageFromDto) };
}

export function agentToolCallFromDto(dto: AgentToolCallDto): AgentToolCall {
  return { ...dto };
}

export function agentApprovalFromDto(dto: AgentApprovalDto): AgentApproval {
  return { ...dto };
}

export function agentTurnFromDto(dto: AgentTurnDto): AgentTurn {
  return {
    session: agentSessionFromDto(dto.session),
    messages: dto.messages.map(agentMessageFromDto),
    toolCalls: dto.toolCalls.map(agentToolCallFromDto),
    approvals: dto.approvals.map(agentApprovalFromDto)
  };
}
```

- [ ] **Step 3: Write failing HTTP client tests**

Create `src/infrastructure/http/agentClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./apiClient";
import { createHttpAgentGateway } from "./agentClient";

describe("createHttpAgentGateway", () => {
  it("creates sessions and sends messages", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/api/v1/agent/sessions")) {
        return new Response(JSON.stringify({ session: { id: "agent-session-1", context: { path: "/parameters", pageKey: "parameters" }, messages: [] } }), {
          status: 201
        });
      }
      return new Response(
        JSON.stringify({
          session: { id: "agent-session-1", context: { path: "/parameters", pageKey: "parameters" }, messages: [] },
          messages: [],
          toolCalls: [],
          approvals: []
        }),
        { status: 200 }
      );
    });
    const gateway = createHttpAgentGateway(createApiClient({ baseUrl: "", fetchImpl: fetchMock }));

    const session = await gateway.startSession({ path: "/parameters", pageKey: "parameters" });
    await gateway.sendMessage(session.id, "Summarize this page");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/agent/sessions",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/agent/sessions/agent-session-1/messages",
      expect.objectContaining({ method: "POST" })
    );
  });
});
```

Expected: FAIL because `agentClient.ts` does not exist.

- [ ] **Step 4: Implement HTTP Agent gateway**

Create `src/infrastructure/http/agentClient.ts`:

```ts
import type { AgentContext } from "@/domain/agent/types";
import type { AgentGateway } from "@/application/ports/AgentGateway";
import { createApiClient } from "./apiClient";
import { agentSessionFromDto, agentTurnFromDto, type AgentSessionDto, type AgentTurnDto } from "./agentDtos";
import { wiseEffApiBaseUrl } from "./runtimeMode";

type ApiClient = ReturnType<typeof createApiClient>;

export function createHttpAgentGateway(apiClient: ApiClient = createApiClient({ baseUrl: wiseEffApiBaseUrl })): AgentGateway {
  return {
    async startSession(context: AgentContext) {
      const response = await apiClient.post<{ session: AgentSessionDto }>("/api/v1/agent/sessions", { context });
      return agentSessionFromDto(response.session);
    },
    async sendMessage(sessionId: string, message: string) {
      const response = await apiClient.post<AgentTurnDto>(`/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/messages`, { message });
      return agentTurnFromDto(response);
    },
    async runAction(sessionId: string, actionId: string, payload: Record<string, unknown>) {
      const response = await apiClient.post<AgentTurnDto>(
        `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/tool-calls/${encodeURIComponent(actionId)}/run`,
        { payload }
      );
      return agentTurnFromDto(response);
    },
    async approveToolCall(sessionId: string, approvalId: string) {
      const response = await apiClient.post<AgentTurnDto>(
        `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}/approve`,
        { expectedToolCallStatus: "pending_approval" }
      );
      return agentTurnFromDto(response);
    },
    async rejectToolCall(sessionId: string, approvalId: string, reason?: string) {
      const response = await apiClient.post<AgentTurnDto>(
        `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}/reject`,
        reason ? { reason } : {}
      );
      return agentTurnFromDto(response);
    }
  };
}
```

- [ ] **Step 5: Update mock Agent gateway**

Modify `src/infrastructure/mock/mockAgentGateway.ts` so all generated tool calls include:

```ts
status: toolCall.requiresApproval ? "pending_approval" : "succeeded"
```

All generated approvals include:

```ts
status: "pending",
createdAt: nowIso()
```

Add `rejectToolCall` to the returned mock gateway. It should create a turn with a single assistant message: `已拒绝 ${approvalId}`.

Run:

```bash
npm test -- src/infrastructure/mock/mockAgentGateway.test.ts src/infrastructure/http/agentDtos.test.ts src/infrastructure/http/agentClient.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add runtime helper tests and implementation**

Create `src/application/agent/agentRuntime.test.ts` and `src/application/agent/agentRuntime.ts`.

Test cases:

- mock mode returns `undefined` gateway unless one is injected,
- api mode requires a gateway,
- `buildAgentContext` includes `path`, `pageKey`, `projectId`, and `roleId`.

Implementation export:

```ts
import type { PageKey } from "@/appConfig";
import type { AgentGateway } from "@/application/ports/AgentGateway";
import type { AgentContext } from "@/domain/agent/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

export function resolveAgentGateway(mode: WiseEffRuntimeMode, gateway?: AgentGateway) {
  if (mode === "api" && !gateway) {
    throw new Error("Agent gateway is required in api runtime mode.");
  }
  return gateway;
}

export function buildAgentContext(input: { path: string; pageKey: PageKey; projectId?: string; roleId?: string }): AgentContext {
  return {
    path: input.path,
    pageKey: input.pageKey,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.roleId ? { roleId: input.roleId } : {})
  };
}
```

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/http/agentDtos.ts src/infrastructure/http/agentDtos.test.ts src/infrastructure/http/agentClient.ts src/infrastructure/http/agentClient.test.ts src/application/agent/agentRuntime.ts src/application/agent/agentRuntime.test.ts src/infrastructure/mock/mockAgentGateway.ts src/infrastructure/mock/mockAgentGateway.test.ts
git commit -m "feat(agent): add frontend api gateway"
```

---

### Task 7: UnifiedAgent API Mode Integration

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/features/agent/UnifiedAgent.tsx`
- Modify: `src/features/agent/UnifiedAgent.test.tsx`

- [ ] **Step 1: Write failing UnifiedAgent API tests**

Add tests to `src/features/agent/UnifiedAgent.test.tsx`:

```tsx
it("starts an API session when opened", async () => {
  const gateway = {
    startSession: vi.fn(async () => ({ id: "agent-session-1", context: { path: "/parameters", pageKey: "parameters" }, messages: [] })),
    sendMessage: vi.fn(),
    runAction: vi.fn(),
    approveToolCall: vi.fn(),
    rejectToolCall: vi.fn()
  };

  render(
    <UnifiedAgent
      path="/parameters"
      pageKey="parameters"
      projectId="aurora"
      roleId="hardware-user"
      runtimeMode="api"
      gateway={gateway}
      plan={parameterPlan}
      state={{ ...createPrototypeState(), activeRoleId: "user" }}
      dispatch={vi.fn()}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));

  expect(await screen.findByText("Parameter context")).toBeInTheDocument();
  expect(gateway.startSession).toHaveBeenCalledWith({
    path: "/parameters",
    pageKey: "parameters",
    projectId: "aurora",
    roleId: "hardware-user"
  });
});

it("renders API citations and confidence after sending a prompt", async () => {
  const gateway = {
    startSession: vi.fn(async () => ({ id: "agent-session-1", context: { path: "/parameters", pageKey: "parameters" }, messages: [] })),
    sendMessage: vi.fn(async () => ({
      session: { id: "agent-session-1", context: { path: "/parameters", pageKey: "parameters" }, messages: [] },
      messages: [
        {
          id: "agent-msg-1",
          role: "assistant",
          content: "Found one review item.",
          citations: [{ type: "parameter", id: "change-1", label: "Fast charge current" }],
          confidence: 0.84,
          createdAt: "2026-05-27T00:00:00.000Z"
        }
      ],
      toolCalls: [],
      approvals: []
    })),
    runAction: vi.fn(),
    approveToolCall: vi.fn(),
    rejectToolCall: vi.fn()
  };

  render(
    <UnifiedAgent
      path="/parameters"
      pageKey="parameters"
      projectId="aurora"
      roleId="hardware-user"
      runtimeMode="api"
      gateway={gateway}
      plan={parameterPlan}
      state={{ ...createPrototypeState(), activeRoleId: "user" }}
      dispatch={vi.fn()}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));
  fireEvent.change(screen.getByPlaceholderText("询问 WiseAgent..."), { target: { value: "Summarize review queue" } });
  fireEvent.submit(screen.getByPlaceholderText("询问 WiseAgent...").closest("form")!);

  expect(await screen.findByText("Found one review item.")).toBeInTheDocument();
  expect(screen.getByText("Fast charge current")).toBeInTheDocument();
  expect(screen.getByText("84%")).toBeInTheDocument();
});
```

Run:

```bash
npm test -- src/features/agent/UnifiedAgent.test.tsx
```

Expected: FAIL because `UnifiedAgent` does not accept API props and renders only local string messages.

- [ ] **Step 2: Modify UnifiedAgent props and state**

Update `UnifiedAgent` props to include:

```ts
  pageKey: PageKey;
  projectId?: string;
  roleId?: string;
  runtimeMode?: WiseEffRuntimeMode;
  gateway?: AgentGateway;
```

Add state:

```ts
const [session, setSession] = useState<AgentSession | null>(null);
const [apiMessages, setApiMessages] = useState<AgentMessage[]>([]);
const [apiToolCalls, setApiToolCalls] = useState<AgentToolCall[]>([]);
const [apiApprovals, setApiApprovals] = useState<AgentApproval[]>([]);
const [apiBusy, setApiBusy] = useState(false);
```

When opening in API mode:

- call `gateway.startSession(buildAgentContext({ path, pageKey, projectId, roleId }))`,
- set `session`,
- append returned session messages to `apiMessages`,
- on failure add `Agent 暂时不可用，请稍后重试。` to local messages.

- [ ] **Step 3: Wire prompt submission to API mode**

Modify `submitPrompt`:

- mock mode keeps the existing local behavior,
- api mode requires `session`,
- call `gateway.sendMessage(session.id, value)`,
- update `session`, `apiMessages`, `apiToolCalls`, `apiApprovals`,
- clear the form only after the promise settles.

Render API messages before local fallback messages. For each API assistant message:

- show `message.content`,
- render `message.confidence` as `Math.round(confidence * 100) + "%"`,
- render citation labels as small clickable anchors when `href` exists and as inline citation chips when it does not.

- [ ] **Step 4: Wire action buttons to API tool calls and approvals**

In API mode:

- non-confirm actions call `gateway.runAction(session.id, action.id, { actionId: action.id, path, projectId })`,
- confirm actions call `gateway.runAction(...)`; if a pending approval returns, open `ConfirmDialog`,
- confirm dialog approve calls `gateway.approveToolCall(session.id, approval.id)`,
- cancel calls `gateway.rejectToolCall(session.id, approval.id, "User cancelled in WiseAgent")`,
- local `dispatch` writes must not run in API mode.

Render tool call statuses:

```tsx
{apiToolCalls.map((toolCall) => (
  <div className="agent-tool-call" key={toolCall.id}>
    <span>{toolCall.label}</span>
    <span>{toolCall.status}</span>
  </div>
))}
```

Use existing compact panel styling. Add CSS only if the status rows wrap or overlap in tests.

- [ ] **Step 5: Wire App to provide the HTTP gateway**

Modify `src/App.tsx`:

- import `AgentGateway`, `createHttpAgentGateway`, and `buildAgentContext` only where needed,
- add `agentGateway?: AgentGateway` to `AppProps` and `AppShell`,
- create `agentGatewayClient` with `useMemo(() => agentGateway ?? (runtimeMode === "api" ? createHttpAgentGateway() : undefined), [agentGateway, runtimeMode])`,
- pass these props to `UnifiedAgent`:

```tsx
<UnifiedAgent
  path={path}
  pageKey={page.key}
  projectId={state.activeProjectId}
  roleId={currentRoleId}
  runtimeMode={runtimeMode}
  gateway={agentGatewayClient}
  plan={agentPlan}
  state={state}
  dispatch={dispatch}
/>
```

- [ ] **Step 6: Add App-level API gateway test**

Add to `src/App.test.tsx`:

```tsx
it("passes the API Agent gateway into UnifiedAgent in api mode", async () => {
  const agentGateway = {
    startSession: vi.fn(async () => ({ id: "agent-session-1", context: { path: "/parameters", pageKey: "parameters" }, messages: [] })),
    sendMessage: vi.fn(),
    runAction: vi.fn(),
    approveToolCall: vi.fn(),
    rejectToolCall: vi.fn()
  };

  render(<App runtimeMode="api" agentGateway={agentGateway} authClient={createResolvedAuthClient()} />);
  fireEvent.click(screen.getByRole("link", { name: /参数修改/ }));
  fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));

  expect(await screen.findByText(/项目参数巡检 Agent/)).toBeInTheDocument();
  expect(agentGateway.startSession).toHaveBeenCalled();
});
```

Use the existing auth test helper in `App.test.tsx`; if no helper exists, add `createResolvedAuthClient` near other test utilities.

- [ ] **Step 7: Run frontend Agent tests**

Run:

```bash
npm test -- src/features/agent/UnifiedAgent.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/features/agent/UnifiedAgent.tsx src/features/agent/UnifiedAgent.test.tsx
git commit -m "feat(agent): wire unified agent to api gateway"
```

---

### Task 8: Audit Correlation And Security Negative Tests

**Files:**
- Modify: `server/modules/agent/orchestrator.test.ts`
- Modify: `server/modules/agent/routes.test.ts`
- Modify: `server/modules/audit/types.ts`
- Modify: `docs/SECURITY.md`

- [ ] **Step 1: Write failing audit correlation test**

Add to `server/modules/agent/orchestrator.test.ts`:

```ts
it("writes agent audit events with the request id as trace id", async () => {
  const { db } = createMemoryDb();
  const createAuditEvent = vi.fn(async () => undefined);
  const orchestrator = createAgentOrchestrator({
    db,
    createAuditEvent,
    toolRegistry: {
      require: vi.fn(),
      run: vi.fn(),
      get: vi.fn(),
      list: vi.fn(() => [])
    }
  });

  await orchestrator.startSession(
    developmentAuthContext,
    { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "hardware-user" },
    { requestId: "req-agent-trace" }
  );

  expect(createAuditEvent).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      actorType: "agent",
      kind: "agent-session",
      traceId: "req-agent-trace"
    })
  );
});
```

Expected: FAIL if audit writer still uses `actorType: "user"` or omits request id.

- [ ] **Step 2: Ensure audit type allows Agent-initiated user context**

`server/modules/audit/types.ts` already allows `actorType: "agent"`. Keep `actorUserId` as the human initiator id. For every Agent audit event use:

```ts
{
  actorType: "agent",
  actorUserId: auth.user.id,
  metadata: { initiatedByUserId: auth.user.id, sessionId, toolCallId }
}
```

- [ ] **Step 3: Add negative route tests**

Extend `server/modules/agent/routes.test.ts` with test auth contexts:

- inactive user cannot approve a pending mutating tool,
- user without `parameter:edit` cannot approve `parameter.submitChangeDraft`,
- user without `admin:access` cannot run `audit.summarizeRecentEvents`,
- approval cannot be approved twice.

Expected errors:

```ts
expect(response.status).toBe(403);
expect(response.body.error.code).toBe("FORBIDDEN");
```

For double approval:

```ts
expect(response.status).toBe(409);
expect(response.body.error.code).toBe("INVALID_APPROVAL_STATE");
```

- [ ] **Step 4: Implement exact error handling**

In `orchestrator.ts`:

- throw `ApiError("INVALID_APPROVAL_STATE", "Approval is not pending.", 409)` when approval status is not `pending`,
- throw `ApiError("NOT_FOUND", "Agent approval was not found.", 404)` when approval cannot be loaded,
- preserve policy errors from `requireAgentPermission`,
- convert tool execution failures into failed tool call state and an audit event before rethrowing.

- [ ] **Step 5: Update Security doc**

Add an M4 note to `docs/SECURITY.md` under `Agent Safety`:

```md
M4 Agent tools run only through the backend registry. Read tools still require server-side permission checks. Approval-required tools persist `agent_approvals` first, then execute only after approval-time authz and state checks. `parameter.submitChangeDraft` may create a human-review draft after approval, but it does not merge or apply production parameter values.
```

- [ ] **Step 6: Run security tests**

Run:

```bash
npm run test:server -- server/modules/agent/orchestrator.test.ts server/modules/agent/routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/modules/agent/orchestrator.ts server/modules/agent/orchestrator.test.ts server/modules/agent/routes.test.ts server/modules/audit/types.ts docs/SECURITY.md
git commit -m "test(agent): enforce approval and audit boundaries"
```

---

### Task 9: E2E, Script, Docs, And Final Verification

**Files:**
- Create: `e2e/agent.api.spec.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/FRONTEND.md`
- Modify: `docs/RELIABILITY.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/design-docs/api-contract.md`
- Modify: `docs/design-docs/domain-model.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `docs/generated/db-schema.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md`

- [ ] **Step 1: Write failing E2E smoke**

Create `e2e/agent.api.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("api-mode WiseAgent can summarize and request approval", async ({ page }) => {
  await page.goto("/parameters");
  await page.getByRole("button", { name: "打开 WiseAgent" }).click();
  await expect(page.getByText(/项目参数巡检 Agent/)).toBeVisible();

  await page.getByPlaceholder("询问 WiseAgent...").fill("总结审阅队列，并准备一个参数草稿");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByText(/受控工具/)).toBeVisible();
  await expect(page.getByText(/%/)).toBeVisible();
  await expect(page.getByText(/Create parameter draft|生成参数修改草稿|创建参数草稿/)).toBeVisible();
});
```

Run:

```bash
npm run test:e2e -- e2e/agent.api.spec.ts
```

Expected before all wiring is complete: FAIL because the API-mode Agent flow is not fully available.

- [ ] **Step 2: Add M4 script**

Modify `package.json`:

```json
"test:m4": "npm run test:all && npm run build && npm run test:e2e -- e2e/agent.api.spec.ts"
```

- [ ] **Step 3: Update API and domain docs**

Update `docs/design-docs/api-contract.md` Agent section with:

- request and response envelopes for all five Agent endpoints,
- `reject` endpoint behavior,
- `APPROVAL_REQUIRED`, `INVALID_APPROVAL_STATE`, `FORBIDDEN`, and `VALIDATION_FAILED` errors,
- note that approval-time execution re-checks authz and business state.

Update `docs/design-docs/domain-model.md` Agent section with:

- `AgentSession`,
- `AgentMessage`,
- `AgentToolCall`,
- `AgentApproval`,
- `AgentRunTrace`,
- approval state machine: `pending -> approved` or `pending -> rejected`.

- [ ] **Step 4: Update frontend, reliability, quality, and generated schema docs**

Update:

- `docs/FRONTEND.md`: API-mode `AgentGateway`, mock-mode preservation, UnifiedAgent citations/confidence rendering.
- `docs/RELIABILITY.md`: Agent tool failures must preserve conversation state and audit record; approval execution must be idempotent by approval state.
- `docs/QUALITY_SCORE.md`: add M4 verification command and negative tests.
- `docs/design-docs/testing-strategy.md`: add Agent route, tool registry, approval, and UI runtime tests.
- `docs/generated/db-schema.md`: summarize `agent_sessions`, `agent_messages`, `agent_tool_calls`, `agent_approvals`, and `agent_run_traces`.

- [ ] **Step 5: Update technical debt tracker**

In `docs/exec-plans/tech-debt-tracker.md`:

- Move or update `TD-013` to state M4 covers Agent approval persistence for Agent tools.
- Add an open item for real LLM provider integration:

```md
| TD-017 | Agent Provider | M4 uses deterministic provider logic rather than a real LLM. | Commercial behavior does not yet cover model latency, prompt injection, grounding, cost, or provider outages. | Add provider adapter, prompt/version traces, safety evaluation, and golden tests before enabling live model output. |
```

- Add an open item for generated Agent API clients if `TD-012` remains broad.

- [ ] **Step 6: Run final verification**

Run:

```bash
npm run test:m4
npm run test:all
npm run build
npm run test:e2e -- e2e/agent.api.spec.ts
git diff --check
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add e2e/agent.api.spec.ts package.json README.md docs/FRONTEND.md docs/RELIABILITY.md docs/QUALITY_SCORE.md docs/design-docs/api-contract.md docs/design-docs/domain-model.md docs/design-docs/testing-strategy.md docs/generated/db-schema.md docs/exec-plans/tech-debt-tracker.md
git commit -m "test(agent): add m4 acceptance coverage and docs"
```

---

## Implementation Order And Review Gates

Recommended subagent order:

1. Task 1: contract and schemas.
2. Task 2: migration and repository.
3. Task 3: tool registry and read tools.
4. Task 4: provider and orchestrator.
5. Task 5: routes and manifest.
6. Task 6: frontend HTTP gateway and runtime.
7. Task 7: UnifiedAgent API mode integration.
8. Task 8: audit/security negative tests.
9. Task 9: E2E, docs, and final verification.

Review gates:

- Gate A after Tasks 1-2: schema, migration, and repository tests prove the durable Agent data model.
- Gate B after Tasks 3-5: backend API proves read tools, approval-required tools, route validation, and audit trace correlation.
- Gate C after Tasks 6-7: frontend API mode uses `AgentGateway` without breaking mock mode.
- Gate D after Tasks 8-9: negative tests, E2E, docs, `test:m4`, `test:all`, build, and diff check pass.

## Subagent Dispatch Guidance

Use `superpowers:subagent-driven-development` for implementation.

For each task:

- Provide the subagent only the task text, this plan header, and relevant file excerpts.
- Require the subagent to write the failing test first, run it, implement the minimal code, rerun targeted tests, self-review, and commit only files listed in that task.
- After implementation, run a spec compliance reviewer subagent first, then a code quality reviewer subagent.
- Do not dispatch implementation subagents in parallel for Tasks 1-5 because they share backend Agent contracts and repository/orchestrator state.
- Tasks 6 and 7 can run sequentially after Task 5; they touch shared frontend runtime and should not be parallelized.
- If a subagent discovers user changes in the current worktree, it must preserve them and coordinate rather than reverting.

## Risk Controls

- Keep mock mode alive for demos and existing component tests.
- Do not import frontend mock data into server runtime.
- Do not add real LLM credentials or external model calls in M4.
- Do not allow model/provider output to call business services directly; all execution goes through `ToolRegistry`.
- Treat audit write failure as an Agent action failure.
- Filter every session/tool/approval read by organization.
- Re-check permissions at approval time, even if they were checked at tool-call creation time.
- Keep `parameter.submitChangeDraft` limited to creating a draft for human review; no merge, import apply, device write, archive, or rollback.
- Make approval transitions one-way: pending approvals can become approved or rejected exactly once.

## Self-Review

- Spec coverage: roadmap M4 items 1-7 are covered by Tasks 2, 3, 4, 5, 6, 7, and 8.
- Architecture coverage: backend Agent orchestrator, provider adapter, tool registry, approval service behavior, and audit adapter behavior are covered by Tasks 3-5 and 8.
- Security coverage: Agent output cannot mutate production state directly; approval-required tools persist approvals first and execute only through approval endpoints.
- Frontend coverage: `AgentGateway` API mode, mock preservation, citations, confidence, tool status, and pending approvals are covered by Tasks 6-7.
- Reliability coverage: failures produce explicit tool status/error and audit events; E2E and `test:m4` are covered by Task 9.
- Placeholder scan: no task depends on unspecified tool names, endpoints, status names, or migration numbers.
- Type consistency: frontend and backend use the same tool names, statuses, approval statuses, and citation shape.
- Residual risk: real LLM provider, prompt safety evaluation, generated API clients, and live model cost/latency controls remain post-M4 debt and are captured in Task 9.
