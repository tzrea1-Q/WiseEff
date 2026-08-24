import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../auth/types";
import { developmentAuthContext } from "../../auth/routes";
import { ApiError } from "../../../shared/http/errors";
import { getAgentApproval, getAgentSession, getAgentToolCall, listAgentApprovals, listAgentToolCalls } from "../repository";
import type { AgentToolExecutionContext } from "../toolRegistry";
import type { AgentToolName } from "../types";
import { createAgentOrchestrator } from "../orchestrator";
import { openDatabaseConnection, withTempDatabase } from "../../../testing/tempDatabase";
import { isTestDatabaseAvailable } from "../../../testing/testDatabase";
import { createXiaozeAgUiHandler, createXiaozeAgentFactory } from "./agUiEndpoint";
import {
  closeSharedPostgresCheckpointerSaversForTests,
  createPostgresCheckpointerSaver,
  resetSharedPostgresCheckpointerSaverForTests,
  type PostgresCheckpointerHandle
} from "./durableCheckpointer";
import { createXiaozeCheckpointer } from "./checkpointer";
import { fakeModelSequence, toolCall } from "./testing/fakeModel";
import type { createAgentToolRegistry } from "../toolRegistry";

const databaseAvailable = await isTestDatabaseAvailable();

const actionDefinition = {
  name: "action.submitParameterChange",
  label: "提交参数变更",
  kind: "mutating",
  permission: "parameter:edit",
  requiresApproval: true,
  description: "submit a parameter change for approval",
  schema: {}
} as const;

type ObservedExecution = {
  context: AgentToolExecutionContext;
  payload: Record<string, unknown>;
  authorization: unknown;
};

function authFor(userId: string, organizationId = developmentAuthContext.organization.id): AuthContext {
  return {
    ...developmentAuthContext,
    user: { ...developmentAuthContext.user, id: userId, organizationId },
    organization: { ...developmentAuthContext.organization, id: organizationId }
  };
}

function createActionRegistry(domainWrites: { count: number }, observed: ObservedExecution[]) {
  const authorize = vi.fn((_name: AgentToolName, _context: AgentToolExecutionContext, _payload: Record<string, unknown>) => ({
    kind: "transaction-authorization",
    token: randomUUID()
  }));
  const run = vi.fn(
    async (
      _name: AgentToolName,
      context: AgentToolExecutionContext,
      payload: Record<string, unknown>,
      authorization?: unknown
    ) => {
      domainWrites.count += 1;
      observed.push({ context, payload, authorization });
      return {
        summary: `Submitted ${String(payload.targetValue)}.`,
        data: { targetValue: payload.targetValue },
        citations: []
      };
    }
  );
  const registry = {
    list: () => [actionDefinition],
    get: (name: string) => (name === actionDefinition.name ? actionDefinition : undefined),
    require: (name: string) => {
      if (name !== actionDefinition.name) {
        throw new Error(`Unknown Xiaoze tool ${name}.`);
      }
      return actionDefinition;
    },
    authorize,
    run
  } as unknown as ReturnType<typeof createAgentToolRegistry>;
  return { registry, authorize, run };
}

function testEnv(connectionString: string) {
  return {
    XIAOZE_CHECKPOINTER: "postgres" as const,
    DATABASE_URL: connectionString,
    XIAOZE_REASONING_FALLBACK_HEURISTIC: false,
    XIAOZE_LLM_CONFIG: {
      source: "canonical" as const,
      config: { model: "durable-resume-test" },
      diagnostics: []
    }
  };
}

type DurableResumeResources = {
  instanceASaver?: PostgresCheckpointerHandle["saver"];
  instanceBSaver?: PostgresCheckpointerHandle["saver"];
  instanceBConnection?: ReturnType<typeof openDatabaseConnection>;
};

async function closeDurableResumeResources(resources: DurableResumeResources): Promise<void> {
  const closeQuietly = async (close: () => Promise<void> | undefined): Promise<void> => {
    try {
      await close();
    } catch {
      // Cleanup must not mask the first setup or assertion failure.
    }
  };

  await closeQuietly(() => resources.instanceBConnection?.close());
  await closeQuietly(() => resources.instanceASaver?.end());
  await closeQuietly(() => resources.instanceBSaver?.end());
  await closeQuietly(() => closeSharedPostgresCheckpointerSaversForTests());
}

async function createInstance(options: {
  db: Parameters<typeof createAgentOrchestrator>[0]["db"];
  connectionString: string;
  auth: AuthContext;
  model: ReturnType<typeof fakeModelSequence>;
  domainWrites: { count: number };
  observed: ObservedExecution[];
  registerSaver?: (saver: PostgresCheckpointerHandle["saver"]) => void;
}) {
  const saverHandle = createPostgresCheckpointerSaver({ connectionString: options.connectionString });
  options.registerSaver?.(saverHandle.saver);
  await saverHandle.ensureSetup();
  const checkpointer = createXiaozeCheckpointer({
    mode: "postgres",
    connectionString: options.connectionString,
    saver: saverHandle.saver
  });
  const execution = createActionRegistry(options.domainWrites, options.observed);
  const orchestrator = createAgentOrchestrator({ db: options.db, toolRegistry: execution.registry });
  const factory = createXiaozeAgentFactory({
    db: options.db,
    env: testEnv(options.connectionString),
    modelFactory: () => options.model,
    checkpointer,
    toolRegistry: execution.registry,
    orchestrator
  });
  return { ...execution, orchestrator, factory, saverHandle };
}

function createHandler(options: {
  db: Parameters<typeof createAgentOrchestrator>[0]["db"];
  auth: AuthContext;
  factory: ReturnType<typeof createXiaozeAgentFactory>;
  orchestrator: ReturnType<typeof createAgentOrchestrator>;
}) {
  return createXiaozeAgUiHandler({
    resolveAuth: async () => options.auth,
    createAgent: options.factory,
    approvalChain: options.orchestrator,
    assertThreadAccess: async ({ auth, threadId }) => {
      const session = await getAgentSession(options.db, auth.organization.id, threadId);
      if (session && session.actorUserId !== auth.user.id) {
        throw new ApiError("FORBIDDEN", "This Xiaoze thread belongs to another user.", { threadId });
      }
    }
  });
}

async function collectSse(response: Awaited<ReturnType<ReturnType<typeof createXiaozeAgUiHandler>>>) {
  if (!("sse" in response)) {
    throw new Error("Expected an AG-UI SSE response.");
  }
  const events: Array<{ event: string; data: unknown }> = [];
  for await (const event of response.sse as AsyncIterable<{ event: string; data: unknown }>) {
    events.push(event);
  }
  return events;
}

async function post(handler: ReturnType<typeof createXiaozeAgUiHandler>, input: {
  auth: AuthContext;
  threadId: string;
  requestId: string;
  approvalId?: string;
  bodyThreadId?: string;
}) {
  const body: Record<string, unknown> = input.approvalId
    ? {
        threadId: input.bodyThreadId ?? input.threadId,
        runId: `run-${input.requestId}`,
        messages: [],
        resume: [
          {
            interruptId: input.approvalId,
            status: "resolved",
            payload: { approvalId: input.approvalId, decision: "approve" }
          }
        ]
      }
    : {
        threadId: input.threadId,
        runId: `run-${input.requestId}`,
        messages: [{ id: `message-${input.requestId}`, role: "user", content: "set pd-1 to 42" }],
        context: [
          {
            description: "wiseeff.page",
            value: { pageKey: "parameters", projectId: "aurora", path: "/parameters?project=aurora" }
          }
        ]
      };

  const response = await handler({
    headers: { authorization: "Bearer integration-test" },
    body,
    requestId: input.requestId
  });
  return collectSse(response);
}

async function interruptAction(options: {
  handler: ReturnType<typeof createXiaozeAgUiHandler>;
  db: Parameters<typeof createAgentOrchestrator>[0]["db"];
  auth: AuthContext;
  threadId: string;
  requestId: string;
}) {
  const events = await post(options.handler, options);
  const toolCalls = await listAgentToolCalls(options.db, options.auth.organization.id, options.threadId);
  const approvals = await listAgentApprovals(options.db, options.auth.organization.id, options.threadId);
  const toolCall = toolCalls[0];
  const approval = approvals[0];
  if (!toolCall || !approval) {
    throw new Error(`Expected persisted interrupt; events=${JSON.stringify(events)}`);
  }
  expect(toolCall).toMatchObject({ status: "pending_approval", requiresApproval: true });
  expect(approval).toMatchObject({ status: "pending", toolCallId: toolCall?.id });
  return { toolCallId: toolCall!.id, approvalId: approval!.id };
}

const initialActionModel = () =>
  fakeModelSequence([
    {
      toolCalls: [
        toolCall("action.submitParameterChange", {
          projectId: "aurora",
          parameterId: "pd-1",
          targetValue: "42",
          reason: "initial request"
        })
      ]
    }
  ]);

describe.skipIf(!databaseAvailable)("Xiaoze PostgreSQL durable resume", () => {
  it("cleans instance A when failure occurs before instance B is created", async () => {
    resetSharedPostgresCheckpointerSaverForTests();
    const originalError = new Error("instance B setup was intentionally not reached");
    let saverEndCalls = 0;

    try {
      await expect(
        withTempDatabase({ prefix: "xiaoze_resume_611_cleanup" }, async ({ db, connectionString }) => {
          const resources: DurableResumeResources = {};
          try {
            const instanceA = await createInstance({
              db,
              connectionString,
              auth: authFor("resume-user"),
              model: initialActionModel(),
              domainWrites: { count: 0 },
              observed: [],
              registerSaver: (saver) => {
                resources.instanceASaver = saver;
              }
            });
            const originalEnd = instanceA.saverHandle.saver.end.bind(instanceA.saverHandle.saver);
            vi.spyOn(instanceA.saverHandle.saver, "end").mockImplementation(async () => {
              saverEndCalls += 1;
              await originalEnd();
            });

            throw originalError;
          } finally {
            await closeDurableResumeResources(resources);
            resetSharedPostgresCheckpointerSaverForTests();
          }
        })
      ).rejects.toBe(originalError);
      expect(saverEndCalls).toBe(1);
    } finally {
      resetSharedPostgresCheckpointerSaverForTests();
    }
  });

  it("reconstructs instance B from durable state and rejects public resume substitutions before execution", async () => {
    resetSharedPostgresCheckpointerSaverForTests();
    try {
      await withTempDatabase({ prefix: "xiaoze_resume_611" }, async ({ db, connectionString }) => {
        const resources: DurableResumeResources = {};
        try {
          await db.query(
        `insert into organizations (id, name)
         values ($1, 'Resume Organization'), ($2, 'Other Resume Organization')`,
        [authFor("seed-user").organization.id, "org-other"]
      );
      await db.query(
        `insert into users (id, organization_id, name, email, title)
         values
           ($1, $4, 'Resume User', 'resume-user@example.com', 'Engineer'),
           ($2, $4, 'Different User', 'different-user@example.com', 'Engineer'),
           ($3, $5, 'Other Organization User', 'other-org-user@example.com', 'Engineer')`,
        ["resume-user", "different-user", "other-org-user", authFor("seed-user").organization.id, "org-other"]
      );
      const domainWrites = { count: 0 };
      const observed: ObservedExecution[] = [];
      const auth = authFor("resume-user");

      // Instance A owns the first connection, checkpointer, registry, model, and
      // orchestrator. After the interrupt, instance A is discarded; B below gets
      // a fresh DB connection, checkpointer, registry, model, and orchestrator.
      const instanceA = await createInstance({
        db,
        connectionString,
        auth,
        model: initialActionModel(),
        domainWrites,
        observed,
        registerSaver: (saver) => {
          resources.instanceASaver = saver;
        }
      });
      const handlerA = createHandler({ db, auth, factory: instanceA.factory, orchestrator: instanceA.orchestrator });
      const threadId = `resume-${randomUUID()}`;
      const interrupted = await interruptAction({
        handler: handlerA,
        db,
        auth,
        threadId,
        requestId: "resume-instance-a"
      });

      expect(domainWrites.count).toBe(0);
      expect(interrupted.toolCallId).toBeTruthy();
      expect(interrupted.approvalId).toBeTruthy();

      const instanceBConnection = openDatabaseConnection(connectionString);
      resources.instanceBConnection = instanceBConnection;
      const instanceB = await createInstance({
          db: instanceBConnection.db,
          connectionString,
          auth,
          model: fakeModelSequence([{ content: "The edited change was submitted." }]),
          domainWrites,
          observed,
          registerSaver: (saver) => {
            resources.instanceBSaver = saver;
          }
        });
        const handlerB = createHandler({
          db: instanceBConnection.db,
          auth,
          factory: instanceB.factory,
          orchestrator: instanceB.orchestrator
        });

        const editedArgs = {
          projectId: "aurora",
          parameterId: "pd-1",
          targetValue: "99",
          reason: "complete replacement from resume"
        };
        const resumeResponse = await handlerB({
          headers: { authorization: "Bearer integration-test" },
          body: {
            threadId,
            runId: "resume-instance-b",
            messages: [],
            resume: [
              {
                interruptId: interrupted.approvalId,
                status: "resolved",
                payload: {
                  approvalId: interrupted.approvalId,
                  decision: "approve",
                  editedArgs
                }
              }
            ]
          },
          requestId: "resume-instance-b"
        });
        const resumeEvents = await collectSse(resumeResponse);
        expect(resumeEvents.some((event) => event.event === "RUN_ERROR")).toBe(false);
        expect(instanceB.run).toHaveBeenCalledOnce();
        expect(instanceB.authorize).toHaveBeenCalledOnce();
        expect(instanceB.run.mock.calls[0]?.[3]).toBe(instanceB.authorize.mock.results[0]?.value);

        const execution = observed[0];
        expect(execution.context.invocation).toMatchObject({
          initiator: "agent",
          principal: {
            user: { id: auth.user.id, organizationId: auth.user.organizationId },
            organization: { id: auth.organization.id }
          },
          sessionId: threadId,
          toolCallId: interrupted.toolCallId,
          approvalRequired: true,
          approvalId: interrupted.approvalId
        });
        expect(execution.payload).toEqual(editedArgs);

        const persistedToolCall = await getAgentToolCall(
          instanceBConnection.db,
          auth.organization.id,
          interrupted.toolCallId
        );
        const persistedApproval = await getAgentApproval(
          instanceBConnection.db,
          auth.organization.id,
          interrupted.approvalId
        );
        expect(persistedToolCall).toMatchObject({
          id: interrupted.toolCallId,
          sessionId: threadId,
          payload: editedArgs,
          status: "succeeded"
        });
        expect(persistedApproval).toMatchObject({
          id: interrupted.approvalId,
          sessionId: threadId,
          toolCallId: interrupted.toolCallId,
          status: "approved",
          requestedByUserId: auth.user.id
        });

        const wrongApprovalThread = `negative-wrong-approval-${randomUUID()}`;
        const wrongApproval = await interruptAction({
          handler: handlerA,
          db,
          auth,
          threadId: wrongApprovalThread,
          requestId: "negative-wrong-approval-start"
        });
        const writesBeforeWrongApproval = domainWrites.count;
        await post(handlerB, {
          auth,
          threadId: wrongApprovalThread,
          requestId: "negative-wrong-approval-resume",
          approvalId: "approval-from-another-session"
        });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(writesBeforeWrongApproval);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, wrongApproval.approvalId)).toMatchObject({
          status: "pending"
        });
        expect(await getAgentToolCall(instanceBConnection.db, auth.organization.id, wrongApproval.toolCallId)).toMatchObject({
          status: "pending_approval"
        });

        const otherThread = `negative-other-thread-${randomUUID()}`;
        const otherThreadFixture = await interruptAction({
          handler: handlerA,
          db,
          auth,
          threadId: otherThread,
          requestId: "negative-other-thread-start"
        });
        const writesBeforeOtherThread = domainWrites.count;
        await post(handlerB, {
          auth,
          threadId: otherThread,
          bodyThreadId: `thread-not-the-checkpoint-${randomUUID()}`,
          requestId: "negative-other-thread-resume",
          approvalId: otherThreadFixture.approvalId
        });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(writesBeforeOtherThread);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, otherThreadFixture.approvalId)).toMatchObject({
          status: "pending"
        });

        const mismatchThread = `negative-approval-tool-${randomUUID()}`;
        const mismatch = await interruptAction({
          handler: handlerA,
          db,
          auth,
          threadId: mismatchThread,
          requestId: "negative-approval-tool-start"
        });
        const mismatchOther = await instanceA.orchestrator.beginApproval({
          auth,
          requestId: "negative-approval-tool-second",
          sessionId: mismatchThread,
          toolName: actionDefinition.name,
          payload: {
            projectId: "aurora",
            parameterId: "pd-2",
            targetValue: "43",
            reason: "second pending call"
          },
          citations: []
        });
        await db.query("delete from agent_approvals where id = $1", [mismatchOther.approvalId]);
        await db.query("update agent_approvals set tool_call_id = $2 where id = $1", [mismatch.approvalId, mismatchOther.toolCallId]);
        const writesBeforeApprovalToolMismatch = domainWrites.count;
        await post(handlerB, {
          auth,
          threadId: mismatchThread,
          requestId: "negative-approval-tool-resume",
          approvalId: mismatch.approvalId
        });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(writesBeforeApprovalToolMismatch);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, mismatch.approvalId)).toMatchObject({
          status: "pending"
        });
        expect(await getAgentToolCall(instanceBConnection.db, auth.organization.id, mismatch.toolCallId)).toMatchObject({
          status: "pending_approval"
        });

        const checkpointMismatchThread = `negative-checkpoint-tool-${randomUUID()}`;
        const checkpointMismatch = await interruptAction({
          handler: handlerA,
          db,
          auth,
          threadId: checkpointMismatchThread,
          requestId: "negative-checkpoint-tool-start"
        });
        const checkpointOther = await instanceA.orchestrator.beginApproval({
          auth,
          requestId: "negative-checkpoint-tool-second",
          sessionId: checkpointMismatchThread,
          toolName: actionDefinition.name,
          payload: {
            projectId: "aurora",
            parameterId: "pd-3",
            targetValue: "44",
            reason: "checkpoint mismatch call"
          },
          citations: []
        });
        expect(checkpointOther.toolCallId).not.toBe(checkpointMismatch.toolCallId);
        const writesBeforeCheckpointMismatch = domainWrites.count;
        await post(handlerB, {
          auth,
          threadId: checkpointMismatchThread,
          requestId: "negative-checkpoint-tool-resume",
          approvalId: checkpointOther.approvalId
        });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(writesBeforeCheckpointMismatch);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, checkpointOther.approvalId)).toMatchObject({
          status: "pending"
        });
        expect(await getAgentToolCall(instanceBConnection.db, auth.organization.id, checkpointOther.toolCallId)).toMatchObject({
          status: "pending_approval"
        });

        const otherUserThread = `negative-other-user-${randomUUID()}`;
        const otherUserFixture = await interruptAction({
          handler: handlerA,
          db,
          auth,
          threadId: otherUserThread,
          requestId: "negative-other-user-start"
        });
        const otherUser = authFor("different-user", auth.organization.id);
        const otherUserHandler = createHandler({
          db: instanceBConnection.db,
          auth: otherUser,
          factory: instanceB.factory,
          orchestrator: instanceB.orchestrator
        });
        await expect(
          post(otherUserHandler, {
            auth: otherUser,
            threadId: otherUserThread,
            requestId: "negative-other-user-resume",
            approvalId: otherUserFixture.approvalId
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(1);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, otherUserFixture.approvalId)).toMatchObject({
          status: "pending"
        });

        const otherOrg = authFor("other-org-user", "org-other");
        const writesBeforeOtherOrg = domainWrites.count;
        const otherOrgHandler = createHandler({
          db: instanceBConnection.db,
          auth: otherOrg,
          factory: instanceB.factory,
          orchestrator: instanceB.orchestrator
        });
        await post(otherOrgHandler, {
          auth: otherOrg,
          threadId,
          requestId: "negative-other-org-resume",
          approvalId: interrupted.approvalId
        });
        expect(instanceB.run).toHaveBeenCalledTimes(1);
        expect(domainWrites.count).toBe(writesBeforeOtherOrg);
        expect(await getAgentApproval(instanceBConnection.db, auth.organization.id, interrupted.approvalId)).toMatchObject({
          status: "approved"
        });
        } finally {
          await closeDurableResumeResources(resources);
          resetSharedPostgresCheckpointerSaverForTests();
        }
      });
    } finally {
      resetSharedPostgresCheckpointerSaverForTests();
    }
  });
});

describe("Xiaoze PostgreSQL durable resume gate", () => {
  it("records that this live proof is skipped when PostgreSQL is unavailable", () => {
    if (databaseAvailable) {
      expect(databaseAvailable).toBe(true);
      return;
    }
    expect(databaseAvailable).toBe(false);
  });
});
