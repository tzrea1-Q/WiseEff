import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "playwright/test";

import { pickReviewCandidate } from "./acceptanceTaskLookup";
import { authHeadersForRole, type AcceptanceRoleId } from "./bearerAuth";
import { acceptanceCast } from "./cast";
import { withPgClient } from "./database";
import {
  startDisposablePostCutoverRuntime,
  type DisposablePostCutoverRuntime
} from "./disposablePostCutoverRuntime";
import { apiRoute } from "./runtime";

const organizationId = "org-chargelab";
const defaultProjectId = "aurora";

export const defaultWorkflowAssignees = {
  hardwareCommitterId: acceptanceCast.wangJie.userId,
  softwareCommitterId: acceptanceCast.sunMei.userId,
  softwareUserId: acceptanceCast.liuMin.userId
};

export type IsolatedBinding = {
  projectId: string;
  bindingId: string;
  parameterSpecId: string;
  revisionId: string;
  rawValue: string;
  configSetId: string;
  fileName: string;
  propertyKey: string;
  nodeLocator: string;
};

export type BindingDraftHandle = {
  draftId: string;
  projectParameterBindingId: string;
  parameterSpecId: string;
  rawText: string;
  action: "set" | "delete";
  reason: string;
  candidateRevisionId?: string;
};

export type IntegerCellTarget = {
  kind: "cells";
  bits: 8 | 16 | 32 | 64;
  groups: Array<Array<{ kind: "integer"; raw: string; value: string }>>;
};

export type StringTarget = {
  kind: "strings";
  values: string[];
  items: Array<{ value: string; raw: string }>;
};

function adminHeaders() {
  return authHeadersForRole("admin");
}

function headersFor(role: AcceptanceRoleId = "admin") {
  return authHeadersForRole(role);
}

export function integerCellTarget(raw: string, bits: 8 | 16 | 32 | 64 = 32): IntegerCellTarget {
  const trimmed = raw.replace(/^<|>$/g, "");
  const numeric = trimmed.toLowerCase().startsWith("0x")
    ? String(Number.parseInt(trimmed, 16))
    : trimmed;
  return {
    kind: "cells",
    bits,
    groups: [[{ kind: "integer", raw: trimmed, value: numeric }]]
  };
}

export function disposablePageUrl(runtime: DisposablePostCutoverRuntime, path: string) {
  const base = runtime.frontendUrl.replace(/\/+$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

type DisposableEnvSnapshot = {
  databaseUrl: string | undefined;
  apiUrl: string | undefined;
  wiseEffApiUrl: string | undefined;
  authIssuer: string | undefined;
  authSecret: string | undefined;
};

export function captureProcessEnvForDisposableRuntime(): DisposableEnvSnapshot {
  return {
    databaseUrl: process.env.DATABASE_URL,
    apiUrl: process.env.VITE_WISEEFF_API_BASE_URL,
    wiseEffApiUrl: process.env.WISEEFF_API_BASE_URL,
    authIssuer: process.env.AUTH_TOKEN_ISSUER,
    authSecret: process.env.AUTH_TOKEN_HMAC_SECRET
  };
}

export function applyDisposableRuntimeEnv(runtime: DisposablePostCutoverRuntime): void {
  process.env.DATABASE_URL = runtime.databaseUrl;
  process.env.VITE_WISEEFF_API_BASE_URL = runtime.apiUrl;
  process.env.WISEEFF_API_BASE_URL = runtime.apiUrl;
  process.env.AUTH_TOKEN_ISSUER = runtime.authIssuer;
  process.env.AUTH_TOKEN_HMAC_SECRET = runtime.authSecret;
}

export function restoreProcessEnvFromDisposableRuntime(snapshot: DisposableEnvSnapshot): void {
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("DATABASE_URL", snapshot.databaseUrl);
  restore("VITE_WISEEFF_API_BASE_URL", snapshot.apiUrl);
  restore("WISEEFF_API_BASE_URL", snapshot.wiseEffApiUrl);
  restore("AUTH_TOKEN_ISSUER", snapshot.authIssuer);
  restore("AUTH_TOKEN_HMAC_SECRET", snapshot.authSecret);
}

export async function startSwappedDisposablePostCutoverRuntime(
  baseDatabaseUrl: string,
  options: Parameters<typeof startDisposablePostCutoverRuntime>[1]
): Promise<{
  runtime: DisposablePostCutoverRuntime;
  snapshot: DisposableEnvSnapshot;
  restore(): Promise<void>;
}> {
  const snapshot = captureProcessEnvForDisposableRuntime();
  const runtime = await startDisposablePostCutoverRuntime(baseDatabaseUrl, options);
  applyDisposableRuntimeEnv(runtime);
  return {
    runtime,
    snapshot,
    async restore() {
      await runtime.dispose();
      restoreProcessEnvFromDisposableRuntime(snapshot);
    }
  };
}
export function quotedStringTarget(value: string): StringTarget {
  return {
    kind: "strings",
    values: [value],
    items: [{ value, raw: `"${value}"` }]
  };
}

export function numericCellsDts(properties: Array<{ propertyKey: string; cellValue: number }>): string {
  const lines = properties.map((item) => `\t\t${item.propertyKey} = <${item.cellValue}>;`).join("\n");
  return `/dts-v1/;
/ {
	td079_cell: td079_cell {
		compatible = "wiseeff,td079-cell";
${lines}
	};
};
`;
}

export function numericCellDts(propertyKey: string, cellValue: number): string {
  return numericCellsDts([{ propertyKey, cellValue }]);
}

export function hexRegDts(rawHex: string): string {
  return `/dts-v1/;
/ {
	amba {
		i2c@1 {
			#address-cells = <1>;
			#size-cells = <0>;
			chip@6E {
				compatible = "vendor,chip123";
				vendor-id = <${rawHex}>;
				status = "okay";
			};
		};
	};
};
`;
}

export async function resolveOpenSpecReviews(
  request: APIRequestContext,
  input: { projectId?: string; revisionId: string; reason: string }
): Promise<void> {
  const projectId = input.projectId ?? defaultProjectId;
  const list = await request.get(
    apiRoute(
      `/api/v2/parameter-spec-review-tasks?status=open&configRevisionId=${encodeURIComponent(input.revisionId)}&projectId=${encodeURIComponent(projectId)}&limit=100`
    ),
    { headers: adminHeaders() }
  );
  expect(list.ok(), `list spec reviews: ${await list.text()}`).toBe(true);
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
            reason: `${input.reason} create occurrence-derived draft for ${task.id}`
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
              documentation: `${input.reason} occurrence-derived spec`,
              reason: `${input.reason} activate occurrence-derived spec`
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
          reason: `${input.reason} resolve review for revision ${input.revisionId}`
        }
      }
    );
    expect(resolve.ok(), `resolve review ${task.id}: ${await resolve.text()}`).toBe(true);
  }
}

async function uploadDts(
  request: APIRequestContext,
  projectId: string,
  fileName: string,
  content: string
): Promise<{ fileId: string; versionId: string }> {
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

export async function seedIsolatedBinding(
  request: APIRequestContext,
  options: {
    projectId?: string;
    propertyKey: string;
    dts: string;
    fileName?: string;
    configSetName?: string;
    rawValuePattern?: string;
    nodeLocatorPattern?: string;
    reason?: string;
    timeoutMs?: number;
  }
): Promise<IsolatedBinding> {
  const [binding] = await seedIsolatedBindings(request, {
    ...options,
    properties: [
      {
        propertyKey: options.propertyKey,
        rawValuePattern: options.rawValuePattern,
        nodeLocatorPattern: options.nodeLocatorPattern
      }
    ]
  });
  expect(binding, `missing seeded binding for ${options.propertyKey}`).toBeTruthy();
  return binding!;
}

export async function seedIsolatedBindings(
  request: APIRequestContext,
  options: {
    projectId?: string;
    dts: string;
    fileName?: string;
    configSetName?: string;
    properties: Array<{
      propertyKey: string;
      rawValuePattern?: string;
      nodeLocatorPattern?: string;
    }>;
    reason?: string;
    timeoutMs?: number;
  }
): Promise<IsolatedBinding[]> {
  const projectId = options.projectId ?? defaultProjectId;
  const reason = options.reason ?? "TD-079 semantic binding fixture";
  const fileName = options.fileName ?? `td079-${options.properties[0]?.propertyKey ?? "cell"}-${randomUUID()}.dts`;
  const configSetName = options.configSetName ?? `td079-cs-${randomUUID().slice(0, 8)}`;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const setsResponse = await request.get(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
    headers: adminHeaders()
  });
  expect(setsResponse.ok()).toBe(true);
  const setsBody = (await setsResponse.json()) as { items: Array<{ id: string; name: string }> };
  let configSetId = setsBody.items.find((item) => item.name === configSetName)?.id;
  if (!configSetId) {
    const createSet = await request.post(apiRoute(`/api/v1/projects/${projectId}/config-sets`), {
      headers: adminHeaders(),
      data: { name: configSetName, description: reason }
    });
    expect(createSet.ok(), await createSet.text()).toBe(true);
    configSetId = ((await createSet.json()) as { item: { id: string } }).item.id;
  }

  const uploaded = await uploadDts(request, projectId, fileName, options.dts);
  const addPrimary = await request.post(
    apiRoute(`/api/v1/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/files`),
    {
      headers: adminHeaders(),
      data: { fileId: uploaded.fileId, role: "base", sortOrder: 0 }
    }
  );
  expect([200, 201, 409]).toContain(addPrimary.status());
  await uploadDts(request, projectId, fileName, options.dts);

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const revisionId = await withPgClient(async (client) => {
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
      return revision.rows[0]?.id ?? null;
    });
    if (revisionId) {
      await resolveOpenSpecReviews(request, { projectId, revisionId, reason });
    }
    const ready = await withPgClient(async (client) => {
      if (!revisionId) return null;
      const found: IsolatedBinding[] = [];
      for (const property of options.properties) {
        const binding = await client.query<{
          id: string;
          parameter_spec_id: string;
          raw_value: string | null;
          node_locator: string | null;
        }>(
          `
          select b.id, b.parameter_spec_id, br.raw_value, lnr.node_locator
          from project_parameter_bindings b
          inner join project_parameter_binding_revisions br
            on br.binding_id = b.id and br.config_revision_id = $1
          inner join parameter_specs ps on ps.id = b.parameter_spec_id
          left join dts_property_specs dps on dps.parameter_spec_id = ps.id
          left join dts_logical_node_revisions lnr
            on lnr.logical_node_id = b.logical_node_id and lnr.config_revision_id = $1
          where b.organization_id = $2
            and b.project_id = $3
            and coalesce(dps.property_key, split_part(ps.specification_key, '/', 2)) = $4
            and coalesce(br.raw_value, '') ~ $5
            and ($6::text is null or coalesce(lnr.node_locator, '') ~ $6)
          order by b.id
          limit 1
          `,
          [
            revisionId,
            organizationId,
            projectId,
            property.propertyKey,
            property.rawValuePattern ?? ".",
            property.nodeLocatorPattern ?? null
          ]
        );
        const row = binding.rows[0];
        if (!row) return null;
        found.push({
          projectId,
          bindingId: row.id,
          parameterSpecId: row.parameter_spec_id,
          revisionId,
          rawValue: row.raw_value ?? "",
          configSetId,
          fileName,
          propertyKey: property.propertyKey,
          nodeLocator: row.node_locator ?? ""
        });
      }
      return found;
    });
    if (ready) {
      return ready;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    `Timed out waiting for seeded bindings [${options.properties.map((item) => item.propertyKey).join(", ")}] on ${projectId}/${configSetName}.`
  );
}

export async function seedIsolatedNumericCellBinding(
  request: APIRequestContext,
  options: {
    projectId?: string;
    propertyKey?: string;
    cellValue?: number;
    reason?: string;
  } = {}
): Promise<IsolatedBinding> {
  const propertyKey = options.propertyKey ?? "iin_max";
  const cellValue = options.cellValue ?? 2300;
  return seedIsolatedBinding(request, {
    projectId: options.projectId,
    propertyKey,
    dts: numericCellDts(propertyKey, cellValue),
    rawValuePattern: "^<[0-9]+>$",
    reason: options.reason ?? "TD-079 numeric cell binding"
  });
}

export async function seedIsolatedNumericCellPair(
  request: APIRequestContext,
  options: {
    projectId?: string;
    kept: { propertyKey: string; cellValue: number };
    removable: { propertyKey: string; cellValue: number };
    reason?: string;
  }
): Promise<{ kept: IsolatedBinding; removable: IsolatedBinding }> {
  const [kept, removable] = await seedIsolatedBindings(request, {
    projectId: options.projectId,
    dts: numericCellsDts([options.kept, options.removable]),
    properties: [
      { propertyKey: options.kept.propertyKey, rawValuePattern: "^<[0-9]+>$" },
      { propertyKey: options.removable.propertyKey, rawValuePattern: "^<[0-9]+>$" }
    ],
    reason: options.reason ?? "TD-079 numeric cell pair"
  });
  expect(kept && removable).toBeTruthy();
  return { kept: kept!, removable: removable! };
}

export async function seedIsolatedHexChipBindings(
  request: APIRequestContext,
  options: { projectId?: string; rawHex?: string; reason?: string } = {}
): Promise<{ reg: IsolatedBinding }> {
  const rawHex = options.rawHex ?? "0x6e";
  const [reg] = await seedIsolatedBindings(request, {
    projectId: options.projectId,
    dts: hexRegDts(rawHex),
    properties: [
      {
        propertyKey: "vendor-id",
        rawValuePattern: ".",
        nodeLocatorPattern: "chip@6E"
      }
    ],
    timeoutMs: 60_000,
    reason: options.reason ?? "TD-079 hex chip bindings"
  });
  expect(reg, "missing seeded hex chip reg binding").toBeTruthy();
  return { reg: reg! };
}

export async function insertSensitiveNodeRule(input: {
  id: string;
  projectId?: string;
  pattern: string;
  createdByUserId?: string;
}): Promise<void> {
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into dts_sensitive_node_rules (
        id, organization_id, project_id, match_type, pattern,
        risk_tier, required_capability, enabled, created_by_user_id
      )
      values (
        $1, $2, $3, 'path', $4,
        'critical', 'parameter:edit-critical', true, $5
      )
      on conflict (id) do update set
        pattern = excluded.pattern,
        risk_tier = excluded.risk_tier,
        required_capability = excluded.required_capability,
        enabled = excluded.enabled,
        project_id = excluded.project_id
      `,
      [
        input.id,
        organizationId,
        input.projectId ?? defaultProjectId,
        input.pattern,
        input.createdByUserId ?? acceptanceCast.xuYun.userId
      ]
    );
  });
}

export async function createBindingDraftViaApi(
  request: APIRequestContext,
  input: {
    binding: IsolatedBinding;
    targetValue: IntegerCellTarget | StringTarget;
    reason: string;
    role?: AcceptanceRoleId;
    baseRevisionId?: string;
  }
): Promise<{ status: number; bodyText: string; draft: BindingDraftHandle | null }> {
  const response = await request.post(
    apiRoute(
      `/api/v2/projects/${input.binding.projectId}/parameter-bindings/${encodeURIComponent(input.binding.bindingId)}/drafts`
    ),
    {
      headers: headersFor(input.role ?? "admin"),
      data: {
        baseRevisionId: input.baseRevisionId ?? input.binding.revisionId,
        targetValue: input.targetValue,
        reason: input.reason
      }
    }
  );
  const bodyText = await response.text();
  if (response.status() !== 201) {
    return { status: response.status(), bodyText, draft: null };
  }
  const body = JSON.parse(bodyText) as {
    item: {
      draftId: string;
      projectParameterBindingId: string;
      parameterSpecId: string;
      rawText?: string;
      action?: "set" | "delete";
      candidateRevisionId?: string;
    };
  };
  return {
    status: response.status(),
    bodyText,
    draft: {
      draftId: body.item.draftId,
      projectParameterBindingId: body.item.projectParameterBindingId,
      parameterSpecId: body.item.parameterSpecId,
      rawText: body.item.rawText ?? "",
      action: body.item.action ?? "set",
      reason: input.reason,
      candidateRevisionId: body.item.candidateRevisionId
    }
  };
}

export async function submitBindingDraftViaApi(
  request: APIRequestContext,
  input: {
    projectId?: string;
    draft: BindingDraftHandle;
    reason?: string;
    role?: AcceptanceRoleId;
    assignees?: typeof defaultWorkflowAssignees;
  }
): Promise<{ status: number; bodyText: string; requestId: string | null }> {
  const projectId = input.projectId ?? defaultProjectId;
  const reason = input.reason ?? input.draft.reason;
  const response = await request.post(apiRoute("/api/v1/parameter-submission-rounds"), {
    headers: headersFor(input.role ?? "admin"),
    data: {
      projectId,
      items: [
        {
          draftId: input.draft.draftId,
          projectParameterBindingId: input.draft.projectParameterBindingId,
          parameterSpecId: input.draft.parameterSpecId,
          action: input.draft.action,
          targetValue: input.draft.rawText,
          reason: input.draft.reason
        }
      ],
      reason,
      assignees: input.assignees ?? defaultWorkflowAssignees
    }
  });
  const bodyText = await response.text();
  if (!response.ok()) {
    return { status: response.status(), bodyText, requestId: null };
  }
  const body = JSON.parse(bodyText) as {
    item: { items: Array<{ requestId: string; targetValue: string }> };
  };
  const requestId =
    body.item.items.find((item) => item.targetValue === input.draft.rawText)?.requestId ??
    body.item.items[0]?.requestId ??
    null;
  return { status: response.status(), bodyText, requestId };
}

export async function createAndSubmitBindingDraft(
  request: APIRequestContext,
  input: {
    binding: IsolatedBinding;
    targetValue: IntegerCellTarget | StringTarget;
    reason: string;
    role?: AcceptanceRoleId;
    assignees?: typeof defaultWorkflowAssignees;
  }
): Promise<{ draft: BindingDraftHandle; requestId: string }> {
  const created = await createBindingDraftViaApi(request, input);
  expect(created.status, created.bodyText).toBe(201);
  expect(created.draft).toBeTruthy();
  const submitted = await submitBindingDraftViaApi(request, {
    projectId: input.binding.projectId,
    draft: created.draft!,
    reason: input.reason,
    role: input.role,
    assignees: input.assignees
  });
  expect(submitted.status, submitted.bodyText).toBe(201);
  expect(submitted.requestId).toBeTruthy();
  return { draft: created.draft!, requestId: submitted.requestId! };
}

export async function bindHardwareUserToProject(projectId = defaultProjectId): Promise<void> {
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into user_role_bindings (id, user_id, organization_id, project_id, role_id)
      values ($1, $2, $3, $4, 'hardware-user')
      on conflict (id) do update set
        project_id = excluded.project_id,
        role_id = excluded.role_id
      `,
      [
        `acceptance-${acceptanceCast.zhaoHeng.userId}-hardware-user-${projectId}`,
        acceptanceCast.zhaoHeng.userId,
        organizationId,
        projectId
      ]
    );
  });
}

export async function deleteDraftViaApi(
  request: APIRequestContext,
  draftId: string,
  role: AcceptanceRoleId = "admin"
): Promise<void> {
  const response = await request.delete(apiRoute(`/api/v1/parameter-drafts/${encodeURIComponent(draftId)}`), {
    headers: headersFor(role)
  });
  expect(response.ok(), await response.text()).toBe(true);
}
