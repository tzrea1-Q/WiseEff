import "./helpers/loadAcceptanceEnvironment";
import { expect, test } from "playwright/test";

import { authHeadersForRole, authHeadersForUser } from "./helpers/bearerAuth";
import { acceptanceCast } from "./helpers/cast";
import { withPgClient } from "./helpers/database";
import {
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";
import { resolveSeededSingleCellBinding, type XiaozeCanonicalBinding } from "./helpers/xiaozeCanonicalBinding";
const databaseUrl = process.env.DATABASE_URL;
const projectId = "aurora";
const organizationId = "org-chargelab";
const threadId = "xiaoze-planning-thread";

/**
 * Runs on the shared post-cutover acceptance database. Parameters are addressed
 * by seeded canonical Catalog Binding id (`parameter_catalog.project_parameter_bindings.id`)
 * and DTS cell text; open requests are canonical
 * `project_parameter_value_change_requests` rows scoped by binding id.
 */

test.skip(!databaseUrl, "DATABASE_URL is required for Xiaoze planning acceptance.");

function adminHeaders() {
  return { ...authHeadersForRole("admin"), Accept: "text/event-stream" };
}

function jsonAdminHeaders() {
  return { ...authHeadersForRole("admin"), Accept: "application/json" };
}

function readOnlyHeaders() {
  const guest = acceptanceCast.acceptanceGuest;
  return {
    ...authHeadersForUser(guest.userId, guest.email, guest.name),
    Accept: "application/json"
  };
}

function parseSseEvents(responseBody: string) {
  const events: Array<Record<string, unknown>> = [];
  for (const block of responseBody.split("\n\n")) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) {
      continue;
    }
    events.push(JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>);
  }
  return events;
}

function readInterruptValue(events: Array<Record<string, unknown>>) {
  const custom = events.find((event) => event.type === "CUSTOM" && event.name === "on_interrupt");
  if (custom?.value && typeof custom.value === "object") {
    return custom.value as Record<string, unknown>;
  }
  const finished = events.find((event) => event.type === "RUN_FINISHED");
  const outcome = finished?.outcome as { type?: string; interrupts?: Array<{ metadata?: Record<string, unknown> }> } | undefined;
  return outcome?.interrupts?.[0]?.metadata;
}

function readAssistantText(events: Array<Record<string, unknown>>) {
  return events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => String(event.delta ?? ""))
    .join("");
}

async function postXiaoze(
  request: {
    post: (
      url: string,
      options?: object
    ) => Promise<{ status: () => number; text: () => Promise<string>; headers: () => Record<string, string> }>;
  },
  headers: Record<string, string>,
  payload: Record<string, unknown>
) {
  const response = await request.post(apiRoute("/api/v1/agent/xiaoze"), {
    headers,
    data: payload
  });
  const body = await response.text();
  return { status: response.status(), body, events: parseSseEvents(body), response };
}

async function seedPlanningGuestUser() {
  const guest = acceptanceCast.acceptanceGuest;
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into users (id, organization_id, name, email, title, is_active)
      values ($1, $2, $3, $4, $5, true)
      on conflict (id) do update set
        name = excluded.name,
        email = excluded.email,
        title = excluded.title,
        is_active = excluded.is_active
      `,
      [guest.userId, organizationId, guest.name, guest.email, guest.title]
    );
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, $4, 'guest')
      on conflict (id) do update set
        project_id = excluded.project_id,
        role_id = excluded.role_id
      `,
      [`acceptance-${guest.userId}-guest-${projectId}`, guest.userId, organizationId, projectId]
    );
  });
}

async function resetOpenChangeRequestsForBinding(bindingId: string) {
  await withPgClient(async (client) => {
    await client.query(
      `
      update project_parameter_value_change_requests
      set status = 'rejected', reviewer_note = 'xiaoze acceptance reset', updated_at = now()
      where organization_id = $1
        and project_id = $2
        and binding_id = $3
        and status = 'pending'
      `,
      [organizationId, projectId, bindingId]
    );
  });
}

async function countOpenChangeRequests(bindingId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from project_parameter_value_change_requests
      where organization_id = $1
        and project_id = $2
        and binding_id = $3
        and status = 'pending'
      `,
      [organizationId, projectId, bindingId]
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

/** Opens one pending canonical request through the real propose + approve flow. */
async function ensureOpenChangeRequestForSuggest(
  request: Parameters<typeof postXiaoze>[0],
  binding: XiaozeCanonicalBinding
) {
  if ((await countOpenChangeRequests(binding.bindingId)) > 0) {
    return;
  }
  const thread = `${threadId}-suggest-fixture-${Date.now()}`;
  const started = await postXiaoze(request, adminHeaders(), {
    threadId: thread,
    runId: `run-suggest-fixture-${Date.now()}`,
    messages: [{ id: "m-user", role: "user", content: `set ${binding.bindingId} to <${binding.baseValue + 50}>` }],
    context: [
      {
        description: "wiseeff.page",
        value: { pageKey: "parameters", projectId, path: `/parameters?project=${projectId}` }
      }
    ]
  });
  const interrupt = readInterruptValue(started.events);
  expect(interrupt?.approvalId, started.body.slice(-800)).toBeTruthy();
  const resumed = await postXiaoze(request, adminHeaders(), {
    threadId: thread,
    runId: `run-suggest-fixture-resume-${Date.now()}`,
    messages: [{ id: "m-resume", role: "user", content: "approve" }],
    forwardedProps: { command: { resume: { decision: "approve" }, interruptEvent: interrupt } }
  });
  expect(resumed.status).toBe(200);
  expect(resumed.events.some((event) => event.type === "RUN_ERROR")).toBe(false);
  expect(await countOpenChangeRequests(binding.bindingId)).toBeGreaterThan(0);
}

test.describe("Xiaoze P2 planning", () => {
  let seededBinding: XiaozeCanonicalBinding;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    await seedPlanningGuestUser();
    seededBinding = await resolveSeededSingleCellBinding(request, projectId);
    expect(seededBinding.bindingId).toMatch(/^pbind_[0-9a-f]{64}$/);
  });

  test.beforeEach(async () => {
    await resetOpenChangeRequestsForBinding(seededBinding.bindingId);
  });

  test("completes a multi-step task through approval and observe loop", async ({ request }, testInfo) => {
    // @acceptance XIAOZE-PLAN-MULTISTEP-001
    // @operation XIAOZE-PLAN-MULTISTEP-001
    test.setTimeout(180_000);
    const openBefore = await countOpenChangeRequests(seededBinding.bindingId);
    const thread = `${threadId}-multistep-${Date.now()}`;
    const targetValue = `<${seededBinding.baseValue + 1}>`;
    const actionPrompt = `project ${projectId} charges slowly; set ${seededBinding.bindingId} to ${targetValue}`;
    const started = await postXiaoze(request, adminHeaders(), {
      threadId: thread,
      runId: `run-plan-start-${Date.now()}`,
      messages: [{ id: "m-user", role: "user", content: actionPrompt }],
      context: [
        {
          description: "wiseeff.page",
          value: { pageKey: "parameters", projectId, path: `/parameters?project=${projectId}` }
        }
      ]
    });

    expect(started.status).toBe(200);
    const interruptValue = readInterruptValue(started.events);
    expect(interruptValue?.approvalId).toBeTruthy();

    const resumed = await postXiaoze(request, adminHeaders(), {
      threadId: thread,
      runId: `run-plan-resume-${Date.now()}`,
      messages: [{ id: "m-resume", role: "user", content: "approve" }],
      resume: [
        {
          interruptId: String(interruptValue?.approvalId),
          status: "resolved",
          payload: {
            approvalId: interruptValue?.approvalId,
            decision: "approve"
          }
        }
      ]
    });

    expect(resumed.status).toBe(200);
    expect(resumed.events.some((event) => event.type === "RUN_ERROR")).toBe(false);
    expect(resumed.events.some((event) => event.type === "TEXT_MESSAGE_CONTENT")).toBe(true);
    const openAfter = await countOpenChangeRequests(seededBinding.bindingId);
    expect(openAfter).toBeGreaterThan(openBefore);

    const finalText = readAssistantText(resumed.events).toLowerCase();
    expect(finalText.includes("change") || finalText.includes("request") || finalText.includes("citation")).toBe(true);
    const planArtifact = await writeOperationJsonArtifact(testInfo, "xiaoze-plan-multistep.json", {
      approvalId: interruptValue?.approvalId,
      bindingId: seededBinding.bindingId,
      startedStatus: started.status,
      resumedStatus: resumed.status,
      openBefore,
      openAfter,
      finalText
    });

    await recordOperationEvidence({
      operationId: "XIAOZE-PLAN-MULTISTEP-001",
      title: "xiaoze multi-step plan resume",
      status: "passed",
      route: "/parameters",
      testInfo,
      artifacts: [planArtifact],
      api: [
        summarizeApiResponse(started.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: String(interruptValue?.approvalId ?? "interrupt")
        }),
        summarizeApiResponse(resumed.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: finalText.slice(0, 120)
        })
      ],
      notes: "Xiaoze resumes the same planning thread after approval and reports the observed execution result. Prompt addressed a runtime-resolved canonical Catalog Binding id on the shared post-cutover acceptance database."
    });
  });

  test("returns grounded proactive suggestions when enabled and nothing for unauthorized scope", async ({ request }, testInfo) => {
    // @acceptance XIAOZE-PROACTIVE-001
    test.setTimeout(180_000);
    await ensureOpenChangeRequestForSuggest(request, seededBinding);

    const enabledResponse = await request.post(apiRoute("/api/v1/agent/xiaoze/suggest"), {
      headers: jsonAdminHeaders(),
      data: {
        context: { pageKey: "parameters", projectId, path: `/parameters?project=${projectId}` }
      }
    });
    expect(enabledResponse.status()).toBe(200);
    const enabledBody = (await enabledResponse.json()) as { suggestions?: Array<{ headline?: string }> };
    expect(enabledBody.suggestions?.length ?? 0).toBeGreaterThan(0);
    expect(enabledBody.suggestions?.[0]?.headline?.length ?? 0).toBeGreaterThan(0);

    const forbiddenResponse = await request.post(apiRoute("/api/v1/agent/xiaoze/suggest"), {
      headers: readOnlyHeaders(),
      data: {
        context: { pageKey: "parameters", projectId: "secret-project", path: "/parameters" }
      }
    });
    expect(forbiddenResponse.status()).toBe(200);
    const forbiddenBody = (await forbiddenResponse.json()) as { suggestions?: unknown[] };
    expect(forbiddenBody.suggestions ?? []).toEqual([]);
    const proactiveArtifact = await writeOperationJsonArtifact(testInfo, "xiaoze-proactive-suggest.json", {
      enabledStatus: enabledResponse.status(),
      enabledSuggestions: enabledBody.suggestions,
      forbiddenStatus: forbiddenResponse.status(),
      forbiddenSuggestionCount: forbiddenBody.suggestions?.length ?? 0
    });

    await recordOperationEvidence({
      operationId: "XIAOZE-PROACTIVE-001",
      title: "xiaoze proactive suggest",
      status: "passed",
      route: "/parameters",
      testInfo,
      artifacts: [proactiveArtifact],
      api: [
        summarizeApiResponse(enabledResponse, {
          method: "POST",
          path: "/api/v1/agent/xiaoze/suggest",
          responseSummary: String(enabledBody.suggestions?.[0]?.headline ?? "suggestion")
        })
      ],
      notes: "Proactive suggest is read-only, authz-bounded, and gated by XIAOZE_PROACTIVE_ENABLED. The open canonical request fixture is created through the real Xiaoze propose + approve flow."
    });
  });
});
