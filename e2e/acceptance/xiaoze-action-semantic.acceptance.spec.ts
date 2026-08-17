import "dotenv/config";
import { expect, test, type APIRequestContext } from "playwright/test";

import { pickReviewCandidate } from "./helpers/acceptanceTaskLookup";
import { authHeadersForRole } from "./helpers/bearerAuth";
import {
  startDisposablePostCutoverRuntime,
  type DisposablePostCutoverRuntime,
} from "./helpers/disposablePostCutoverRuntime";
import { withPgClient } from "./helpers/database";
import {
  recordOperationEvidence,
  summarizeApiResponse,
  writeOperationJsonArtifact
} from "./helpers/operationEvidence";
import { apiRoute } from "./helpers/runtime";

/**
 * Suite-internal post-cutover proof for approved Xiaoze writes (TD-079).
 * The shared CI acceptance database stays pre-cutover; this file boots the
 * same disposable runtime as parameter-topology and requires a live
 * `parameter_identity_cutovers` row. It never falls back to
 * `project_parameter_value_id` or `aurora-fast-charge-current`.
 */

const databaseUrl = process.env.DATABASE_URL;
const projectId = "aurora";
const organizationId = "org-chargelab";
const propertyKey = "iin_max";
const threadId = "xiaoze-action-semantic-thread";
const reviewReason = "XIAOZE-ACTION semantic disposable acceptance";

const numericCellDts = `/dts-v1/;
/ {
	xiaoze_action: xiaoze_action {
		compatible = "wiseeff,xiaoze-action";
		${propertyKey} = <2300>;
	};
};
`;

test.skip(!databaseUrl, "DATABASE_URL is required for disposable post-cutover Xiaoze action acceptance.");

function adminHeaders() {
  return { ...authHeadersForRole("admin"), Accept: "text/event-stream" };
}

function cellValue(base: number, offset: number) {
  return `<${base + offset}>`;
}

function parseSseEvents(responseBody: string) {
  const events: Array<Record<string, unknown>> = [];
  for (const block of responseBody.split("\n\n")) {
    const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
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
  const outcome = finished?.outcome as
    | { type?: string; interrupts?: Array<{ metadata?: Record<string, unknown> }> }
    | undefined;
  return outcome?.interrupts?.[0]?.metadata;
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
  const responseBody = await response.text();
  return {
    response,
    status: response.status(),
    body: responseBody,
    events: parseSseEvents(responseBody)
  };
}

async function assertPostCutoverDatabase() {
  await withPgClient(async (client) => {
    const cutover = await client.query<{ c: string }>(
      `select count(*)::text as c from parameter_identity_cutovers`
    );
    expect(
      Number(cutover.rows[0]?.c ?? 0),
      "disposable Xiaoze spec requires parameter_identity_cutovers count > 0"
    ).toBeGreaterThan(0);

    const legacyColumn = await client.query<{ c: string }>(
      `
      select count(*)::text as c
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'parameter_change_requests'
        and column_name = 'project_parameter_value_id'
      `
    );
    expect(
      Number(legacyColumn.rows[0]?.c ?? 0),
      "disposable Xiaoze spec refuses the retired project_parameter_value_id column"
    ).toBe(0);
  });
}

async function uploadDts(request: APIRequestContext, fileName: string, content: string) {
  const response = await request.post(apiRoute(`/api/v1/projects/${projectId}/parameter-files`), {
    headers: adminHeaders(),
    data: {
      fileName,
      contentBase64: Buffer.from(content, "utf8").toString("base64")
    }
  });
  expect(response.ok(), `upload ${fileName}: ${await response.text()}`).toBe(true);
  const body = (await response.json()) as { item: { id: string }; version: { id: string } };
  return { fileId: body.item.id, versionId: body.version.id };
}

async function resolveOpenSpecReviews(request: APIRequestContext, revisionId: string) {
  const list = await request.get(
    apiRoute(
      `/api/v2/parameter-spec-review-tasks?status=open&configRevisionId=${encodeURIComponent(revisionId)}&projectId=${encodeURIComponent(projectId)}&limit=100`
    ),
    { headers: adminHeaders() }
  );
  expect(list.ok()).toBe(true);
  const body = (await list.json()) as {
    items: Array<{
      id: string;
      propertyKey?: string | null;
      sourceEvidence?: { propertyKey?: string; nodeLocator?: string };
      candidateSchemas?: Array<{ id: string; propertyKey?: string; label?: string }>;
      candidates?: Array<{ id: string; propertyKey?: string | null; label?: string }>;
    }>;
  };
  for (const task of body.items) {
    const candidates = task.candidateSchemas ?? task.candidates ?? [];
    let parameterSpecId: string;
    if (candidates.length > 0) {
      parameterSpecId = pickReviewCandidate(task, {
        propertyKey: task.propertyKey ?? task.sourceEvidence?.propertyKey,
        nodeLocator: task.sourceEvidence?.nodeLocator
      }).id;
    } else {
      const createDraft = await request.post(
        apiRoute(`/api/v2/parameter-spec-review-tasks/${encodeURIComponent(task.id)}/resolve`),
        {
          headers: adminHeaders(),
          data: {
            decision: "resolved",
            createSpec: true,
            reason: `${reviewReason} create occurrence-derived draft for ${task.id}`
          }
        }
      );
      expect(createDraft.ok(), `create draft spec for review ${task.id}: ${await createDraft.text()}`).toBe(true);
      const created = (await createDraft.json()) as { item: { parameterSpecId?: string | null } };
      parameterSpecId = created.item.parameterSpecId ?? "";
      expect(parameterSpecId).toBeTruthy();

      const detailResponse = await request.get(
        apiRoute(`/api/v2/parameter-specs/${encodeURIComponent(parameterSpecId)}`),
        { headers: adminHeaders() }
      );
      expect(detailResponse.ok()).toBe(true);
      const detailBody = (await detailResponse.json()) as {
        item: { lifecycle?: string; valueShape?: Record<string, unknown> | null };
      };
      const shape = detailBody.item.valueShape;
      expect(shape && typeof shape.kind === "string").toBeTruthy();
      const kind = String(shape!.kind);
      let constraints: Record<string, unknown> = {};
      if (kind === "cells" || kind === "u32-array" || kind === "phandle-list") {
        const cells = shape!.cellsPerGroup ?? shape!.cells;
        expect(Number.isInteger(cells) && Number(cells) > 0).toBe(true);
        constraints = { cells };
      } else if (kind === "bytes") {
        const length = shape!.length;
        expect(Number.isInteger(length) && Number(length) >= 0).toBe(true);
        constraints = { minLength: length, maxLength: length };
      }
      if (detailBody.item.lifecycle !== "active") {
        const activate = await request.post(
          apiRoute(`/api/v2/parameter-specs/${encodeURIComponent(parameterSpecId)}/activate`),
          {
            headers: adminHeaders(),
            data: {
              valueShape: shape,
              constraints,
              documentation: `${reviewReason} occurrence-derived spec`,
              reason: `${reviewReason} activate occurrence-derived spec`
            }
          }
        );
        expect(activate.ok(), `activate draft spec ${parameterSpecId}: ${await activate.text()}`).toBe(true);
      }
    }
    const resolve = await request.post(
      apiRoute(`/api/v2/parameter-spec-review-tasks/${encodeURIComponent(task.id)}/resolve`),
      {
        headers: adminHeaders(),
        data: {
          decision: "resolved",
          parameterSpecId,
          reason: `${reviewReason} resolve review for revision ${revisionId}`
        }
      }
    );
    expect(resolve.ok(), `resolve review ${task.id}: ${await resolve.text()}`).toBe(true);
  }
}

async function seedNumericCellBinding(request: APIRequestContext) {
  const setsResponse = await request.get(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
    headers: adminHeaders()
  });
  expect(setsResponse.ok()).toBe(true);
  const setsBody = (await setsResponse.json()) as { items: Array<{ id: string; name: string }> };
  let configSetId = setsBody.items.find((item) => item.name === "default")?.id;
  if (!configSetId) {
    const createSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: { name: "default", description: "Disposable Xiaoze semantic acceptance" }
    });
    expect(createSet.ok(), await createSet.text()).toBe(true);
    configSetId = ((await createSet.json()) as { item: { id: string } }).item.id;
  }

  const fileName = "xiaoze-action-semantic.dts";
  const uploaded = await uploadDts(request, fileName, numericCellDts);
  const addPrimary = await request.post(
    apiRoute(`/api/v1/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/files`),
    {
      headers: adminHeaders(),
      data: { fileId: uploaded.fileId, role: "base", sortOrder: 0 }
    }
  );
  expect([200, 201, 409]).toContain(addPrimary.status());
  await uploadDts(request, fileName, numericCellDts);

  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const ready = await withPgClient(async (client) => {
      const revision = await client.query<{ id: string }>(
        `
        select id
        from dts_config_revisions
        where organization_id = $1
          and project_id = $2
          and config_set_id = $3
        order by revision_number desc
        limit 1
        `,
        [organizationId, projectId, configSetId]
      );
      if (!revision.rows[0]) return null;
      const binding = await client.query<{ id: string; raw_value: string | null }>(
        `
        select b.id, br.raw_value
        from project_parameter_bindings b
        inner join project_parameter_binding_revisions br
          on br.binding_id = b.id and br.config_revision_id = $1
        inner join parameter_specs ps on ps.id = b.parameter_spec_id
        left join dts_property_specs dps on dps.parameter_spec_id = ps.id
        where b.organization_id = $2
          and b.project_id = $3
          and coalesce(dps.property_key, split_part(ps.specification_key, '/', 2)) = $4
          and br.raw_value ~ '^<[0-9]+>$'
        order by b.id
        limit 1
        `,
        [revision.rows[0].id, organizationId, projectId, propertyKey]
      );
      const row = binding.rows[0];
      if (!row) return null;
      return { revisionId: revision.rows[0].id, bindingId: row.id, rawValue: row.raw_value ?? "<2300>" };
    });
    if (ready) {
      await resolveOpenSpecReviews(request, ready.revisionId);
      return ready;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for a seeded iin_max binding with a single-cell DTS value.");
}

async function countOpenChangeRequests(bindingId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `
      select count(*)::text as count
      from parameter_change_requests
      where organization_id = $1
        and project_id = $2
        and project_parameter_binding_id = $3
        and status not in ('merged', 'rejected')
      `,
      [organizationId, projectId, bindingId]
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

async function latestAgentAuditForSession(sessionId: string) {
  return withPgClient(async (client) => {
    const result = await client.query<{
      id: string;
      kind: string;
      action: string;
      actor_type: string;
      target_id: string | null;
      trace_id: string | null;
    }>(
      `
      select id, kind, action, actor_type, target_id, trace_id
      from audit_events
      where metadata->>'sessionId' = $1
      order by created_at desc
      limit 5
      `,
      [sessionId]
    );
    return result.rows;
  });
}

test.describe("Xiaoze P1 action on disposable post-cutover identity", () => {
  let disposableRuntime: DisposablePostCutoverRuntime;
  const originalEnvironment = {
    databaseUrl: process.env.DATABASE_URL,
    apiUrl: process.env.VITE_WISEEFF_API_BASE_URL,
    wiseEffApiUrl: process.env.WISEEFF_API_BASE_URL,
    authIssuer: process.env.AUTH_TOKEN_ISSUER,
    authSecret: process.env.AUTH_TOKEN_HMAC_SECRET
  };

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const baseDatabaseUrl = originalEnvironment.databaseUrl?.trim();
    if (!baseDatabaseUrl) {
      throw new Error("DATABASE_URL is required to create the disposable Xiaoze post-cutover database.");
    }
    disposableRuntime = await startDisposablePostCutoverRuntime(baseDatabaseUrl, {
      label: "xiaoze_act",
      markerPurpose: "xiaoze-action"
    });
    process.env.DATABASE_URL = disposableRuntime.databaseUrl;
    process.env.VITE_WISEEFF_API_BASE_URL = disposableRuntime.apiUrl;
    process.env.WISEEFF_API_BASE_URL = disposableRuntime.apiUrl;
    process.env.AUTH_TOKEN_ISSUER = disposableRuntime.authIssuer;
    process.env.AUTH_TOKEN_HMAC_SECRET = disposableRuntime.authSecret;
  });

  test.afterAll(async () => {
    test.setTimeout(60_000);
    await disposableRuntime?.dispose();
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("DATABASE_URL", originalEnvironment.databaseUrl);
    restore("VITE_WISEEFF_API_BASE_URL", originalEnvironment.apiUrl);
    restore("WISEEFF_API_BASE_URL", originalEnvironment.wiseEffApiUrl);
    restore("AUTH_TOKEN_ISSUER", originalEnvironment.authIssuer);
    restore("AUTH_TOKEN_HMAC_SECRET", originalEnvironment.authSecret);
  });

  test("approves a semantic parameter change through the post-cutover binding path", async ({
    request
  }, testInfo) => {
    // @acceptance XIAOZE-ACTION-APPROVE-001
    // @operation XIAOZE-ACTION-APPROVE-001
    test.setTimeout(180_000);

    await assertPostCutoverDatabase();
    expect(disposableRuntime.markerPurpose).toBe("xiaoze-action");

    const seeded = await seedNumericCellBinding(request);
    expect(seeded.bindingId).not.toBe("aurora-fast-charge-current");
    expect(seeded.bindingId).toMatch(/^[0-9a-f-]{36}$/i);

    const baseCellValue = Number(seeded.rawValue.replace(/[<>]/g, ""));
    const targetValue = cellValue(baseCellValue, 1);
    const openBefore = await countOpenChangeRequests(seeded.bindingId);

    const started = await postXiaoze(request, adminHeaders(), {
      threadId,
      runId: `run-semantic-action-${Date.now()}`,
      messages: [{ id: "m-user", role: "user", content: `set ${seeded.bindingId} to ${targetValue}` }],
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
      threadId,
      runId: `run-semantic-resume-approve-${Date.now()}`,
      messages: [{ id: "m-resume", role: "user", content: "approve" }],
      forwardedProps: {
        command: {
          resume: { decision: "approve" },
          interruptEvent: interruptValue
        }
      }
    });

    expect(resumed.status).toBe(200);
    expect(resumed.events.some((event) => event.type === "RUN_ERROR")).toBe(false);
    expect(parseSseEvents(resumed.body).some((event) => event.type === "TEXT_MESSAGE_CONTENT")).toBe(true);

    const openAfterApprove = await countOpenChangeRequests(seeded.bindingId);
    expect(openAfterApprove).toBeGreaterThan(openBefore);

    const persisted = await withPgClient(async (client) => {
      const result = await client.query<{
        target_value: string | null;
        project_parameter_binding_id: string | null;
      }>(
        `
        select target_value, project_parameter_binding_id
        from parameter_change_requests
        where organization_id = $1
          and project_id = $2
          and project_parameter_binding_id = $3
        order by created_at desc
        limit 1
        `,
        [organizationId, projectId, seeded.bindingId]
      );
      return result.rows[0];
    });
    expect(persisted?.project_parameter_binding_id).toBe(seeded.bindingId);
    expect(String(persisted?.target_value ?? "")).toContain(targetValue);

    const auditRows = await latestAgentAuditForSession(threadId);
    const approvalAudit = auditRows.find((row) => row.action === "approval-executed" && row.actor_type === "agent");
    expect(approvalAudit).toBeTruthy();

    const artifact = await writeOperationJsonArtifact(testInfo, "xiaoze-action-semantic-approve.json", {
      markerPurpose: disposableRuntime.markerPurpose,
      bindingId: seeded.bindingId,
      targetValue,
      approvalId: interruptValue?.approvalId,
      startedStatus: started.status,
      resumedStatus: resumed.status,
      openBefore,
      openAfterApprove,
      audit: approvalAudit
    });

    await recordOperationEvidence({
      operationId: "XIAOZE-ACTION-APPROVE-001",
      title: "xiaoze approve parameter change on disposable post-cutover identity",
      status: "passed",
      route: "/parameters",
      testInfo,
      artifacts: [artifact],
      api: [
        summarizeApiResponse(started.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: String(interruptValue?.approvalId ?? "interrupt")
        }),
        summarizeApiResponse(resumed.response, {
          method: "POST",
          path: "/api/v1/agent/xiaoze",
          responseSummary: "approved-post-cutover"
        })
      ],
      audit: [
        {
          id: approvalAudit?.id,
          kind: approvalAudit!.kind,
          action: approvalAudit!.action,
          targetId: approvalAudit?.target_id,
          requestId: approvalAudit?.trace_id ?? undefined,
          metadataSummary: `actorType=${approvalAudit?.actor_type}; sessionId=${threadId}; bindingId=${seeded.bindingId}`
        }
      ],
      notes:
        "Disposable post-cutover runtime proved action.submitParameterChange against a resolved project_parameter_binding_id; shared CI pre-cutover fallback is not used here."
    });
  });
});
