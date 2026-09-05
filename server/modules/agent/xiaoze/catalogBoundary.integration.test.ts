import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import {
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase
} from "../../../testing/parameterCatalog";
import { createLocalAuthService } from "../../auth/localAuth";
import { hashLocalAccountPassword } from "../../auth/localAccountCredentials";
import { createLocalObjectStore } from "../../logs/objectStore";
import { createCatalogKernel } from "../../catalog-kernel/interface";
import {
  installPublishedCatalogChain,
  SUBJECT_ID,
  X_DEFINITION_ID,
  X_REVISION_1
} from "../../catalog-kernel/runtime/catalogChain.fixture";
import { stabilizeCanonicalBinding } from "../../parameter-bindings/binding";
import { appendProjectValue } from "../../parameter-bindings/values";
import { ensureLocalPostCutoverIdentity } from "../../parameter-topology/localPostCutover";
import { DefinitionRevisionId, ParameterDefinitionId, SubjectRegistrationId } from "../../parameter-catalog-contract";

const ORG = "org-r2-818";
const PROJECT = "project-r2-818";
const ADMIN = "user-r2-818-admin";
const RESTRICTED = "user-r2-818-restricted";
const PROJECT_B = "project-r2-818-b";
const ORG_B = "org-r2-818-b";
const ADMIN_B = "user-r2-818-admin-b";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server?: Server): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

/** Only the external model provider is deterministic. The HTTP root, local
 * login/session resolver, registry, orchestrator, trusted invocation, Kernel,
 * Binding/ProjectValue commands, and all persistence below are production code.
 * This is deterministic Agent execution evidence, not live-model quality. */
describe("R2-AGT real authenticated Catalog execution", () => {
  let database: ParameterCatalogDatabase;
  let root: RootDatabase;
  let server: Server;
  let provider: Server;
  let baseUrl: string;
  let token: string;
  let bindingId: string;
  let currentValueId: string;
  let pinnedReleaseId: string;
  let providerRequests = 0;
  let restrictedToken: string;
  let otherOrganizationToken: string;
  let scriptedTool = "perception.searchParameters";
  let scriptedArgs: Record<string, unknown> = { projectId: PROJECT, query: "iin_max" };
  let advertisedTools: string[] = [];
  let providerUrl: string;
  let objectStoreRoot: string;

  const runAgent = async (
    input: {
      runtimeUrl?: string;
      token?: string;
      projectId?: string;
      tool?: string;
      args?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {}
  ) => {
    scriptedTool = input.tool ?? "perception.searchParameters";
    scriptedArgs = input.args ?? { projectId: PROJECT, query: "iin_max" };
    const threadId = `r2-818-${randomUUID()}`;
    const response = await fetch(`${input.runtimeUrl ?? baseUrl}/api/v1/agent/xiaoze`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.token ?? token}`,
        ...input.headers
      },
      body: JSON.stringify({
        threadId,
        runId: randomUUID(),
        messages: [{ id: randomUUID(), role: "user", content: "Read iin_max in my project." }],
        context: [
          {
            description: "wiseeff.page",
            value: {
              pageKey: "parameters",
              ...(input.projectId ? { projectId: input.projectId } : {}),
              path: "/parameters"
            }
          }
        ]
      })
    });
    expect(response.status).toBe(200);
    const events = await response.text();
    const pool = getRootPostgresPool(root)!;
    const calls = await pool.query<{
      id: string;
      status: string;
      result: { data: { parameters: Array<Record<string, unknown>> } } | null;
    }>("select id, status, result from agent_tool_calls where session_id = $1 order by created_at", [threadId]);
    const audit = await pool.query<{ actor_type: string; actor_user_id: string; action: string }>(
      "select actor_type, actor_user_id, action from audit_events where target_id = any($1::text[]) and kind = 'agent-tool' order by created_at",
      [calls.rows.map((call) => call.id)]
    );
    return { threadId, events, calls: calls.rows, audit: audit.rows };
  };

  const businessState = async () => {
    const pool = getRootPostgresPool(root)!;
    const state = await pool.query(`select
      (select jsonb_agg(to_jsonb(b) order by id) from parameter_catalog.project_parameter_bindings b) as bindings,
      (select jsonb_agg(to_jsonb(v) order by id) from parameter_catalog.project_parameter_values v) as values,
      (select jsonb_agg(to_jsonb(r) order by id) from parameter_catalog.organization_subject_registrations r) as registrations,
      (select jsonb_agg(to_jsonb(p) order by id) from parameter_catalog.definition_proposals p) as proposals,
      (select jsonb_agg(to_jsonb(r) order by id) from dts_config_revisions r) as config_revisions,
      (select jsonb_agg(to_jsonb(r) order by id) from parameter_submission_rounds r) as submission_rounds,
      (select jsonb_agg(to_jsonb(i) order by id) from parameter_submission_items i) as submission_items,
      (select jsonb_agg(to_jsonb(d) order by id) from parameter_drafts d) as drafts,
      (select jsonb_agg(to_jsonb(c) order by id) from parameter_change_requests c) as changes`);
    return state.rows[0];
  };

  const json = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };

  beforeAll(async () => {
    database = await createDisposableParameterCatalogDatabase("r2818agent");
    root = createPostgresDatabase(database.url);
    const pool = getRootPostgresPool(root);
    if (!pool) throw new Error("R2-818 requires real root PostgreSQL");
    const chain = await installPublishedCatalogChain(pool);
    pinnedReleaseId = chain.pinA.id;
    await pool.query("insert into organizations (id, name) values ($1, 'R2 Agent')", [ORG]);
    await pool.query("insert into organizations (id, name) values ($1, 'R2 Other Organization')", [ORG_B]);
    await pool.query("insert into projects (id, organization_id, name, code) values ($1, $2, 'R2 Agent', 'R2818')", [
      PROJECT,
      ORG
    ]);
    await pool.query(
      "insert into projects (id, organization_id, name, code) values ($1, $2, 'R2 Project B', 'R2818B')",
      [PROJECT_B, ORG]
    );
    await pool.query(
      "insert into users (id, organization_id, name, title, is_active) values ($1, $2, 'R2 admin', 'Admin', true)",
      [ADMIN, ORG]
    );
    await pool.query(
      "insert into user_role_bindings (id, user_id, organization_id, project_id, role_id) values ('urb-r2-818', $1, $2, null, 'admin')",
      [ADMIN, ORG]
    );
    await pool.query(
      "insert into users (id, organization_id, name, title, is_active) values ($1, $2, 'R2 restricted', 'Hardware', true)",
      [RESTRICTED, ORG]
    );
    await pool.query(
      "insert into user_role_bindings (id, user_id, organization_id, project_id, role_id) values ('urb-r2-818-restricted', $1, $2, $3, 'hardware-user')",
      [RESTRICTED, ORG, PROJECT]
    );
    await pool.query(
      "insert into users (id, organization_id, name, title, is_active) values ($1, $2, 'R2 Other admin', 'Admin', true)",
      [ADMIN_B, ORG_B]
    );
    await pool.query(
      "insert into user_role_bindings (id, user_id, organization_id, project_id, role_id) values ('urb-r2-818-admin-b', $1, $2, null, 'admin')",
      [ADMIN_B, ORG_B]
    );
    const password = randomUUID();
    await pool.query(
      "insert into user_password_credentials (user_id, username, password_hash) values ($1, 'r2-818-admin', $2)",
      [ADMIN, await hashLocalAccountPassword(password)]
    );
    await pool.query(
      "insert into user_password_credentials (user_id, username, password_hash) values ($1, 'r2-818-restricted', $2)",
      [RESTRICTED, await hashLocalAccountPassword(password)]
    );
    await pool.query(
      "insert into user_password_credentials (user_id, username, password_hash) values ($1, 'r2-818-admin-b', $2)",
      [ADMIN_B, await hashLocalAccountPassword(password)]
    );
    await pool.query(
      "insert into attribution_subjects (id, organization_id, subject_kind, display_name, source_key) values ('attr-r2-818', $1, 'driver-registration', 'R2 driver', 'compatible:acme,power')",
      [ORG]
    );
    await pool.query(
      "insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality) values ('attr-r2-818', 'physical-device', 'multiple')"
    );
    await pool.query(
      "insert into parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id) values ('pmod-r2-818', $1, 'R2 driver', 'pmod-r2-818', 1, 'driver-group', 'curated', 'attr-r2-818')",
      [ORG]
    );

    provider = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        stream?: boolean;
        messages: Array<{ role: string }>;
        tools?: Array<{ function: { name: string } }>;
      };
      providerRequests += 1;
      advertisedTools = (body.tools ?? []).map((tool) => tool.function.name);
      const hasToolResult = body.messages.some((message) => message.role === "tool");
      const toolCalls = [
        {
          index: 0,
          id: "call-r2-818",
          type: "function",
          function: { name: scriptedTool, arguments: JSON.stringify(scriptedArgs) }
        }
      ];
      const message = hasToolResult
        ? { role: "assistant", content: "Read the exact configured parameter." }
        : { role: "assistant", content: null, tool_calls: toolCalls };
      if (body.stream) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(
          `data: ${JSON.stringify({ id: "provider-r2-818", object: "chat.completion.chunk", created: 1, model: "r2-818-deterministic", choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\n`
        );
        response.write(
          `data: ${JSON.stringify({ id: "provider-r2-818", object: "chat.completion.chunk", created: 1, model: "r2-818-deterministic", choices: [{ index: 0, delta: {}, finish_reason: hasToolResult ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`
        );
        response.end();
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "provider-r2-818",
            object: "chat.completion",
            created: 1,
            model: "r2-818-deterministic",
            choices: [{ index: 0, message, finish_reason: hasToolResult ? "stop" : "tool_calls" }]
          })
        );
      }
    });
    providerUrl = await listen(provider);
    objectStoreRoot = await mkdtemp(join(tmpdir(), "wiseeff-r2-818-source-"));
    server = createWiseEffServer({
      db: root,
      objectStore: createLocalObjectStore(objectStoreRoot),
      auth: { mode: "production" },
      localAuthService: createLocalAuthService(root),
      env: {
        XIAOZE_CHECKPOINTER: "memory",
        XIAOZE_REASONING_FALLBACK_HEURISTIC: false,
        XIAOZE_LLM_CONFIG: {
          source: "canonical",
          config: { model: "r2-818-deterministic", apiBaseUrl: `${providerUrl}/v1`, apiKey: "isolated-test-provider" },
          diagnostics: []
        }
      }
    });
    baseUrl = await listen(server);
    const login = await json("POST", "/api/v1/auth/login", { username: "r2-818-admin", password });
    expect(login.status).toBe(200);
    token = login.body.token;
    expect(login.body.auth.user.id).toBe(ADMIN);
    expect(login.body.auth.roles).toContainEqual({ projectId: null, roleId: "admin" });
    const restrictedLogin = await json("POST", "/api/v1/auth/login", { username: "r2-818-restricted", password });
    expect(restrictedLogin.status).toBe(200);
    restrictedToken = restrictedLogin.body.token;
    const otherLogin = await json("POST", "/api/v1/auth/login", { username: "r2-818-admin-b", password });
    expect(otherLogin.status).toBe(200);
    otherOrganizationToken = otherLogin.body.token;
    const registration = await json(
      "POST",
      `/api/v2/organizations/${ORG}/subject-registrations`,
      { subjectId: SUBJECT_ID, placement: { mode: "use-default" }, reason: "R2 exact pin fixture" },
      { "X-WiseEff-Catalog-Release": chain.pinC.id, "Idempotency-Key": randomUUID() }
    );
    expect(registration.status, JSON.stringify(registration.body)).toBe(201);
    const loaded = await createCatalogKernel(pool).loadPinnedCatalog(chain.pinA);
    if (!loaded.ok) throw new Error(`Pinned fixture unavailable: ${loaded.error.kind}`);
    const stabilized = await stabilizeCanonicalBinding(pool, {
      snapshot: loaded.value,
      organizationId: ORG,
      projectId: PROJECT,
      logicalNodeId: "logical-r2-818",
      registrationId: SubjectRegistrationId(registration.body.item.id),
      definitionId: ParameterDefinitionId(X_DEFINITION_ID),
      effectiveRevisionId: DefinitionRevisionId(X_REVISION_1),
      expectedEffectiveRevisionId: null
    });
    if (!stabilized.ok) throw new Error(`Binding fixture failed: ${JSON.stringify(stabilized.error)}`);
    bindingId = stabilized.value.binding.id;
    const value = await appendProjectValue(pool, {
      snapshot: loaded.value,
      binding: stabilized.value.binding,
      definitionRevisionId: DefinitionRevisionId(X_REVISION_1),
      source: { sourceRef: "config-set:r2-818", configRevisionId: "config-r2-818-1" },
      payload: { kind: "number", value: 1842 },
      expectedTip: stabilized.value.binding.currentValueId
    });
    if (!value.ok) throw new Error(`Value fixture failed: ${JSON.stringify(value.error)}`);
    currentValueId = value.value.currentTip;
  }, 60_000);

  afterAll(async () => {
    await close(server);
    await close(provider);
    await root?.close();
    await database?.close();
    if (objectStoreRoot) await rm(objectStoreRoot, { recursive: true, force: true });
  });

  it("R2-AGT-02: administrator's actual Agent reads a configured historical pin while current has advanced", async () => {
    const { threadId, events, calls } = await runAgent({ projectId: PROJECT });
    expect(providerRequests).toBeGreaterThanOrEqual(2);
    const pool = getRootPostgresPool(root)!;
    expect(calls, events).toHaveLength(1);
    expect(calls[0]?.status).toBe("succeeded");
    expect(calls[0]?.result?.data.parameters).toEqual([
      expect.objectContaining({
        id: bindingId,
        current_value: "1842",
        pin_status: "canonical-pin",
        pin: expect.objectContaining({
          definitionId: X_DEFINITION_ID,
          definitionRevisionId: X_REVISION_1,
          currentValueId,
          catalogRelease: expect.objectContaining({ id: pinnedReleaseId })
        })
      })
    ]);
    const session = await pool.query("select actor_user_id, organization_id from agent_sessions where id = $1", [
      threadId
    ]);
    expect(session.rows).toEqual([{ actor_user_id: ADMIN, organization_id: ORG }]);
    const audit = await pool.query(
      "select actor_type, actor_user_id from audit_events where target_id = $1 and action = 'succeeded'",
      [calls[0]!.id]
    );
    expect(audit.rows).toEqual([{ actor_type: "agent", actor_user_id: ADMIN }]);
  });

  it("R2-AGT-05: a project-only principal can read its own exact pin", async () => {
    const actual = await runAgent({ token: restrictedToken, projectId: PROJECT });
    expect(actual.calls).toHaveLength(1);
    expect(actual.calls[0]?.result?.data.parameters).toEqual([
      expect.objectContaining({ id: bindingId, current_value: "1842", pin_status: "canonical-pin" })
    ]);
    expect(actual.audit).toEqual([{ actor_type: "agent", actor_user_id: RESTRICTED, action: "succeeded" }]);
  });

  it.each([
    { label: "another project", projectId: PROJECT_B, args: { projectId: PROJECT_B, query: "iin_max" } },
    {
      label: "forged payload project",
      projectId: PROJECT,
      args: { projectId: PROJECT_B, query: "iin_max", role: "platform-admin", actorKind: "user" }
    },
    { label: "missing both project scopes", projectId: undefined, args: { query: "iin_max" } }
  ])(
    "R2-AGT-05: project-only Agent refuses $label with no business or success-audit change",
    async ({ projectId, args }) => {
      const before = await businessState();
      const actual = await runAgent({ token: restrictedToken, projectId, args });
      expect(actual.events).toContain("forbidden");
      expect(actual.calls.map((call) => call.status)).toEqual(["failed"]);
      expect(actual.audit).toEqual([{ actor_type: "agent", actor_user_id: RESTRICTED, action: "failed" }]);
      expect(await businessState()).toEqual(before);
    }
  );

  it("R2-AGT-04: forged role organization and initiator fields cannot replace authenticated Agent attribution", async () => {
    const actual = await runAgent({
      projectId: PROJECT,
      args: {
        projectId: PROJECT,
        query: "iin_max",
        organizationId: "org-forged",
        role: "platform-admin",
        actorKind: "user"
      },
      headers: {
        "X-WiseEff-Organization": "org-forged",
        "X-WiseEff-Role": "platform-admin",
        "X-WiseEff-Actor-Kind": "user"
      }
    });
    expect(actual.calls[0]?.result?.data.parameters).toEqual([
      expect.objectContaining({ id: bindingId, current_value: "1842" })
    ]);
    expect(actual.audit).toEqual([{ actor_type: "agent", actor_user_id: ADMIN, action: "succeeded" }]);
    expect(JSON.stringify(actual.calls[0]?.result)).not.toContain("org-forged");
  });

  it.each([
    "action.registerSubject",
    "action.acceptDefinitionProposal",
    "action.updateParameterSpec",
    "unknown.catalogTool"
  ])("R2-AGT-03: administrator's Agent cannot dispatch unregistered tool %s", async (tool) => {
    // These are forbidden capability/legacy-shaped probes; this test does not
    // claim that each name was ever a registered historical product tool.
    const before = await businessState();
    const actual = await runAgent({
      projectId: PROJECT,
      tool,
      args: { projectId: PROJECT, subjectId: SUBJECT_ID, role: "platform-admin" }
    });
    expect(advertisedTools).not.toContain(tool);
    expect(advertisedTools).toContain("perception.searchParameters");
    expect(advertisedTools).toContain("action.submitParameterChange");
    expect(actual.events).toContain("Unknown Agent tool");
    expect(actual.calls).toEqual([]);
    expect(actual.audit).toEqual([]);
    expect(await businessState()).toEqual(before);
  });

  it("R2-AGT-02: a successful search with no matching definition is an honest empty result", async () => {
    const actual = await runAgent({
      projectId: PROJECT,
      args: { projectId: PROJECT, query: "a-nonexistent-definition-r2-818" }
    });
    expect(actual.calls.map((call) => call.status)).toEqual(["succeeded"]);
    expect(actual.calls[0]?.result?.data.parameters).toEqual([]);
    expect(actual.audit).toEqual([{ actor_type: "agent", actor_user_id: ADMIN, action: "succeeded" }]);
  });

  it("R2-AGT-05: a global administrator can read another project within its own organization", async () => {
    const actual = await runAgent({ projectId: PROJECT_B, args: { projectId: PROJECT_B, query: "iin_max" } });
    expect(actual.calls.map((call) => call.status)).toEqual(["succeeded"]);
    expect(actual.calls[0]?.result?.data.parameters).toEqual([]);
  });

  it("R2-AGT-05: an administrator from another organization cannot observe the configured pin", async () => {
    const before = await businessState();
    const actual = await runAgent({ token: otherOrganizationToken, projectId: PROJECT });
    expect(actual.events).toContain("Project was not found");
    expect(actual.events).not.toContain(bindingId);
    expect(actual.events).not.toContain("1842");
    expect(actual.calls.map((call) => call.status)).toEqual(["failed"]);
    expect(actual.audit).toEqual([{ actor_type: "agent", actor_user_id: ADMIN_B, action: "failed" }]);
    expect(await businessState()).toEqual(before);
  });

  it("R2-AGT-06: a real database permission failure is recorded as failed Agent execution, never empty success", async () => {
    const pool = getRootPostgresPool(root)!;
    const role = `r2_818_dependency_${randomUUID().replaceAll("-", "")}`;
    let restrictedRoot: RootDatabase | undefined;
    let restrictedServer: Server | undefined;
    const before = await businessState();
    await pool.query(`create role ${role} nologin`);
    try {
      // Scope the dependency fault to a one-off role and this disposable DB.
      // Authentication/session/Agent persistence stay real and writable; only
      // the actual Binding read is denied by PostgreSQL privilege checks.
      await pool.query(`grant usage on schema public, parameter_catalog to ${role}`);
      await pool.query(`grant select, insert, update, delete on all tables in schema public to ${role}`);
      await pool.query(`grant usage, select on all sequences in schema public to ${role}`);
      await pool.query(`grant select on all tables in schema parameter_catalog to ${role}`);
      await pool.query(`revoke select on parameter_catalog.project_parameter_bindings from ${role}`);
      const url = new URL(database.url);
      url.searchParams.set("options", `-c role=${role}`);
      restrictedRoot = createPostgresDatabase(url.toString());
      expect((await restrictedRoot.query("select current_user as role")).rows).toEqual([{ role }]);
      restrictedServer = createWiseEffServer({
        db: restrictedRoot,
        auth: { mode: "production" },
        localAuthService: createLocalAuthService(restrictedRoot),
        env: {
          XIAOZE_CHECKPOINTER: "memory",
          XIAOZE_REASONING_FALLBACK_HEURISTIC: false,
          XIAOZE_LLM_CONFIG: {
            source: "canonical",
            config: {
              model: "r2-818-deterministic",
              apiBaseUrl: `${providerUrl}/v1`,
              apiKey: "isolated-test-provider"
            },
            diagnostics: []
          }
        }
      });
      const actual = await runAgent({ runtimeUrl: await listen(restrictedServer), projectId: PROJECT });
      expect(actual.events).toContain("permission denied");
      expect(actual.calls.map((call) => call.status)).toEqual(["failed"]);
      expect(actual.calls[0]?.result).toBeNull();
      expect(actual.audit).toEqual([{ actor_type: "agent", actor_user_id: ADMIN, action: "failed" }]);
      expect(await businessState()).toEqual(before);
    } finally {
      await close(restrictedServer);
      await restrictedRoot?.close();
      await pool.query(`drop owned by ${role}`);
      await pool.query(`drop role ${role}`);
    }
  });

  const pendingBindingAction = () =>
    runAgent({
      token: restrictedToken,
      projectId: PROJECT,
      tool: "action.submitParameterChange",
      args: { projectId: PROJECT, parameterId: bindingId, targetValue: "<2000>", reason: "R2 approval boundary" }
    });

  const resumeBindingAction = async (
    threadId: string,
    decision: "approve" | "reject",
    editedArgs?: Record<string, unknown>,
    principalToken = restrictedToken
  ) => {
    const pool = getRootPostgresPool(root)!;
    const approvals = await pool.query<{ id: string }>("select id from agent_approvals where session_id = $1", [
      threadId
    ]);
    expect(approvals.rows).toHaveLength(1);
    const approvalId = approvals.rows[0]!.id;
    const response = await fetch(`${baseUrl}/api/v1/agent/xiaoze`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${principalToken}` },
      body: JSON.stringify({
        threadId,
        runId: randomUUID(),
        messages: [],
        resume: [{ interruptId: approvalId, status: "resolved", payload: { approvalId, decision, editedArgs } }]
      })
    });
    return { status: response.status, events: await response.text() };
  };

  it("R2-AGT-06: the actual Binding action still pauses for durable approval and rejection performs no domain write", async () => {
    const before = await businessState();
    const pending = await pendingBindingAction();
    expect(pending.calls.map((call) => call.status)).toEqual(["pending_approval"]);
    expect(await businessState()).toEqual(before);
    const rejected = await resumeBindingAction(pending.threadId, "reject");
    expect(rejected.status).toBe(200);
    const pool = getRootPostgresPool(root)!;
    expect(
      (await pool.query("select status from agent_approvals where session_id = $1", [pending.threadId])).rows
    ).toEqual([{ status: "rejected" }]);
    expect(
      (await pool.query("select status from agent_tool_calls where session_id = $1", [pending.threadId])).rows
    ).toEqual([{ status: "rejected" }]);
    expect(await businessState()).toEqual(before);
  });

  it("R2-AGT-06: approval reauthorizes edited arguments before any Binding write", async () => {
    const before = await businessState();
    const pending = await pendingBindingAction();
    const resumed = await resumeBindingAction(pending.threadId, "approve", {
      projectId: PROJECT_B,
      parameterId: bindingId,
      targetValue: "<2000>",
      reason: "forged project"
    });
    expect(resumed.events).toContain("You are not permitted to perform that action.");
    const pool = getRootPostgresPool(root)!;
    expect(
      (await pool.query("select status from agent_tool_calls where session_id = $1", [pending.threadId])).rows
    ).toEqual([{ status: "pending_approval" }]);
    expect(
      (
        await pool.query("select action from audit_events where target_id = $1 and action = 'succeeded'", [
          pending.calls[0]!.id
        ])
      ).rows
    ).toEqual([]);
    expect(await businessState()).toEqual(before);
  });

  it("R2-AGT-06: revoking the requester's role is enforced again on durable approval", async () => {
    const before = await businessState();
    const pending = await pendingBindingAction();
    const revoke = await json("PUT", `/api/v1/users/${RESTRICTED}/roles`, {
      roles: [{ projectId: PROJECT, roleId: "guest" }]
    });
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    try {
      const resumed = await resumeBindingAction(pending.threadId, "approve");
      expect(resumed.events).toContain("You are not permitted to perform that action.");
      const pool = getRootPostgresPool(root)!;
      expect(
        (await pool.query("select status from agent_tool_calls where session_id = $1", [pending.threadId])).rows
      ).toEqual([{ status: "pending_approval" }]);
      expect(
        (
          await pool.query("select action from audit_events where target_id = $1 and action = 'succeeded'", [
            pending.calls[0]!.id
          ])
        ).rows
      ).toEqual([]);
      expect(await businessState()).toEqual(before);
    } finally {
      const restored = await json("PUT", `/api/v1/users/${RESTRICTED}/roles`, {
        roles: [{ projectId: PROJECT, roleId: "hardware-user" }]
      });
      expect(restored.status).toBe(200);
    }
  });

  it("R2-AGT-06: source-backed approval succeeds once, replays without writes, and still refuses a critical Agent write", async () => {
    // Use the existing disposable-runtime initializer, never handwritten marker
    // rows or schema weakening. This is the old semantic-identity initialization,
    // not Catalog P12-P15 or a target-environment operation.
    expect(await ensureLocalPostCutoverIdentity(root)).toMatchObject({ status: "applied" });
    const set = await json("POST", `/api/v1/projects/${PROJECT}/config-sets`, {
      name: "r2-agent-source",
      description: "Isolated Agent approval source fixture"
    });
    expect(set.status, JSON.stringify(set.body)).toBe(201);
    const source = `/dts-v1/;
/ {
  power {
    compatible = "huawei,charging_core";
    iin_max = <2300>;
  };
};
`;
    const upload = () =>
      json("POST", `/api/v1/projects/${PROJECT}/parameter-files`, {
        fileName: "r2-agent-source.dts",
        contentBase64: Buffer.from(source).toString("base64")
      });
    const file = await upload();
    expect(file.status, JSON.stringify(file.body)).toBe(201);
    const member = await json("POST", `/api/v1/projects/${PROJECT}/config-sets/${set.body.item.id}/files`, {
      fileId: file.body.item.id,
      role: "base",
      sortOrder: 0
    });
    expect([200, 201], JSON.stringify(member.body)).toContain(member.status);
    const revision = await upload();
    expect([200, 201], JSON.stringify(revision.body)).toContain(revision.status);
    const pool = getRootPostgresPool(root)!;
    const bindings = await pool.query<{ id: string }>(
      `
      select b.id from project_parameter_bindings b
      join project_parameter_binding_revisions br on br.binding_id = b.id
      join dts_config_revisions cr on cr.id = br.config_revision_id
      where b.organization_id = $1 and b.project_id = $2 and cr.config_set_id = $3
        and br.raw_value = '<2300>'
      `,
      [ORG, PROJECT, set.body.item.id]
    );
    expect(bindings.rows, "Real source ingest must produce an editable Binding before Agent approval").toHaveLength(1);
    const sourceBindingId = bindings.rows[0]!.id;
    const beforeApproval = await businessState();
    const pending = await runAgent({
      token: restrictedToken,
      projectId: PROJECT,
      tool: "action.submitParameterChange",
      args: {
        projectId: PROJECT,
        parameterId: sourceBindingId,
        targetValue: "<2400>",
        reason: "R2 real source-backed approval"
      }
    });
    expect(pending.calls.map((call) => call.status), pending.events).toEqual(["pending_approval"]);
    const approved = await resumeBindingAction(pending.threadId, "approve");
    expect(approved.status).toBe(200);
    const calls = await pool.query(
      "select status, result, error_message from agent_tool_calls where session_id = $1",
      [pending.threadId]
    );
    const sourceNodes = await pool.query(
      `select n.node_path, n.compatible from dts_nodes n
       join project_parameter_file_versions v on v.id = n.file_version_id where v.file_id = $1`,
      [file.body.item.id]
    );
    const logicalNodes = await pool.query(
      `select node_locator, compatible from dts_logical_node_revisions
       where config_revision_id in (select id from dts_config_revisions where config_set_id = $1)`,
      [set.body.item.id]
    );
    expect(
      calls.rows.map((call) => call.status),
      JSON.stringify({ calls: calls.rows, sourceNodes: sourceNodes.rows, logicalNodes: logicalNodes.rows })
    ).toEqual(["succeeded"]);
    const beforeReplay = await businessState();
    for (const key of ["bindings", "values", "registrations", "proposals"]) {
      expect(beforeReplay[key]).toEqual(beforeApproval[key]);
    }
    const replay = await resumeBindingAction(pending.threadId, "approve");
    expect(replay.status).toBe(200);
    expect(await businessState()).toEqual(beforeReplay);
    const requests = await pool.query(
      "select target_value from parameter_change_requests where project_parameter_binding_id = $1",
      [sourceBindingId]
    );
    expect(requests.rows).toEqual([{ target_value: "<2400>" }]);
    expect(calls.rows[0]?.result.data).toMatchObject({
      projectId: PROJECT,
      parameterId: sourceBindingId,
      targetValue: "<2400>"
    });
    expect((await pool.query(
      "select actor_type, actor_user_id, action from audit_events where target_id = $1 and kind = 'agent-tool' order by created_at",
      [pending.calls[0]!.id]
    )).rows).toEqual([
      { actor_type: "agent", actor_user_id: RESTRICTED, action: "approval-requested" },
      { actor_type: "agent", actor_user_id: RESTRICTED, action: "approval-executed" }
    ]);

    // Security-policy fixture: this table has no product authoring command.
    // Source, Binding, draft, approval and submission remain real command paths.
    await pool.query(`insert into dts_sensitive_node_rules
      (id, organization_id, project_id, match_type, pattern, risk_tier, required_capability)
      values ('rule-r2-818-critical', $1, $2, 'compatible', 'huawei,charging_core', 'critical', 'parameter:edit-critical')`,
      [ORG, PROJECT]);
    const beforeCritical = await businessState();
    const critical = await runAgent({
      projectId: PROJECT,
      tool: "action.submitParameterChange",
      args: { projectId: PROJECT, parameterId: sourceBindingId, targetValue: "<2500>", reason: "Critical Agent denial" }
    });
    expect(critical.calls.map((call) => call.status)).toEqual(["pending_approval"]);
    await resumeBindingAction(critical.threadId, "approve", undefined, token);
    expect((await pool.query("select status from agent_tool_calls where session_id = $1", [critical.threadId])).rows)
      .toEqual([{ status: "failed" }]);
    expect(await businessState()).toEqual(beforeCritical);
    expect((await pool.query(
      "select actor_type, actor_user_id, action from audit_events where target_id = 'rule-r2-818-critical' and kind = 'parameter-sensitive-node-denied'"
    )).rows).toEqual([{ actor_type: "agent", actor_user_id: ADMIN, action: "deny" }]);
    expect((await pool.query(
      "select action from audit_events where target_id = $1 and action in ('succeeded', 'approval-executed')", [critical.calls[0]!.id]
    )).rows).toEqual([]);
  });
});
