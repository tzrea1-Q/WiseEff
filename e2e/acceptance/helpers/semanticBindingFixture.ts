import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, type APIRequestContext } from "playwright/test";
import { syncPublishedCatalogProjectValues } from "../../../server/modules/parameter-bindings/catalogProjectValueSync";
import { seedSemanticBindingCatalog, SEMANTIC_BINDING_FIXTURE_RELEASE_ID } from "../../../server/testing/parameterCatalog/semanticBinding";

import { authHeadersForRole, type AcceptanceRoleId } from "./bearerAuth";
import { acceptanceCast } from "./cast";
import { withPgClient } from "./database";
import {
  startDisposablePostCutoverRuntime,
  type DisposableRuntimeOutcome,
  type DisposablePostCutoverRuntime
} from "./disposablePostCutoverRuntime";
import { OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV } from "./nestedRuntimeManifest";
import {
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV,
  OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV,
} from "./ownedRuntimeDescriptor";
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
  fileId?: string;
  propertyKey: string;
  nodeLocator: string;
};

export async function readCanonicalFixtureBindings(projectId: string) {
  return withPgClient(async (client) => (await client.query<{
    id: string; definitionId: string; propertyKey: string; configRevisionId: string;
  }>(`select binding.id, binding.definition_id as "definitionId", definition.property_key as "propertyKey",
           value.config_revision_id as "configRevisionId"
      from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.parameter_definitions definition on definition.id = binding.definition_id
      join parameter_catalog.project_parameter_values value on value.id = binding.current_value_id
     where binding.organization_id = $1 and binding.project_id = $2`, [organizationId, projectId])).rows);
}

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

export type DisposableEnvSnapshot = {
  databaseUrl: string | undefined;
  apiUrl: string | undefined;
  wiseEffApiUrl: string | undefined;
  authIssuer: string | undefined;
  authSecret: string | undefined;
  ownedDescriptor: string | undefined;
  parentOwnedDescriptor: string | undefined;
  nestedRuntimeId: string | undefined;
};

export function captureProcessEnvForDisposableRuntime(): DisposableEnvSnapshot {
  return {
    databaseUrl: process.env.DATABASE_URL,
    apiUrl: process.env.VITE_WISEEFF_API_BASE_URL,
    wiseEffApiUrl: process.env.WISEEFF_API_BASE_URL,
    authIssuer: process.env.AUTH_TOKEN_ISSUER,
    authSecret: process.env.AUTH_TOKEN_HMAC_SECRET,
    ownedDescriptor: process.env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV],
    parentOwnedDescriptor: process.env[OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV],
    nestedRuntimeId: process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV]
  };
}

export function applyDisposableRuntimeEnv(runtime: DisposablePostCutoverRuntime): void {
  process.env.DATABASE_URL = runtime.databaseUrl;
  process.env.VITE_WISEEFF_API_BASE_URL = runtime.apiUrl;
  process.env.WISEEFF_API_BASE_URL = runtime.apiUrl;
  process.env.AUTH_TOKEN_ISSUER = runtime.authIssuer;
  process.env.AUTH_TOKEN_HMAC_SECRET = runtime.authSecret;
  const parentDescriptor = process.env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]?.trim()
    || process.env[OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV]?.trim();
  if (parentDescriptor) process.env[OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV] = parentDescriptor;
  else delete process.env[OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV];
  delete process.env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV];
  if (runtime.nestedRuntimeId) process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV] = runtime.nestedRuntimeId;
  else delete process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV];
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
  restore(OWNED_ACCEPTANCE_DESCRIPTOR_ENV, snapshot.ownedDescriptor);
  restore(OWNED_ACCEPTANCE_PARENT_DESCRIPTOR_ENV, snapshot.parentOwnedDescriptor);
  restore(OWNED_ACCEPTANCE_NESTED_RUNTIME_ID_ENV, snapshot.nestedRuntimeId);
}

export type RestoreDisposablePostCutoverRuntime = (
  outcome?: DisposableRuntimeOutcome,
) => Promise<void>;

export async function startSwappedDisposablePostCutoverRuntime(
  baseDatabaseUrl: string,
  options: Parameters<typeof startDisposablePostCutoverRuntime>[1]
): Promise<{
  runtime: DisposablePostCutoverRuntime;
  snapshot: DisposableEnvSnapshot;
  restore: RestoreDisposablePostCutoverRuntime;
}> {
  const snapshot = captureProcessEnvForDisposableRuntime();
  const runtime = await startDisposablePostCutoverRuntime(baseDatabaseUrl, options);
  applyDisposableRuntimeEnv(runtime);
  return {
    runtime,
    snapshot,
    async restore(outcome = "success") {
      try {
        await runtime.dispose(outcome);
      } finally {
        restoreProcessEnvFromDisposableRuntime(snapshot);
      }
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

export function hexRegDts(rawHex: string, unitAddress = "6E"): string {
  return `/dts-v1/;
/ {
	amba {
		i2c@1 {
			#address-cells = <1>;
			#size-cells = <0>;
			chip@${unitAddress} {
				compatible = "vendor,chip123";
				vendor-id = <${rawHex}>;
				status = "okay";
			};
		};
	};
};
`;
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
    peerFile?: { fileName: string; content: string };
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
    peerFile?: { fileName: string; content: string };
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
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await seedSemanticBindingCatalog(pool);
  } finally {
    await pool.end();
  }
  for (const subjectId of ["csub_acceptance_td079", "csub_acceptance_chip123"]) {
    const moduleId = `pmod_${subjectId}`;
    await withPgClient(async (client) => {
      await client.query(`insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
        values ($1,$2,'driver-registration',$1,$1) on conflict (id) do nothing`, [subjectId, organizationId]);
      await client.query(`insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality)
        values ($1,'physical-device','multiple') on conflict (attribution_subject_id) do nothing`, [subjectId]);
      await client.query(`insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
        values ($1,$2,$1,$1,1,'driver-group','curated',$3) on conflict (id) do nothing`, [moduleId, organizationId, subjectId]);
    });
    const registration = await request.post(apiRoute(`/api/v2/organizations/${organizationId}/subject-registrations`), {
      headers: { ...adminHeaders(), "X-WiseEff-Catalog-Release": SEMANTIC_BINDING_FIXTURE_RELEASE_ID,
        "Idempotency-Key": `acceptance-binding-${subjectId}` },
      data: { subjectId, placement: { mode: "use-default" }, destinationModuleId: moduleId,
        reason: "Published acceptance Binding fixture" }
    });
    expect(registration.ok(), await registration.text()).toBe(true);
  }

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

  if (options.peerFile) {
    const peer = await uploadDts(request, projectId, options.peerFile.fileName, options.peerFile.content);
    const addPeer = await request.post(
      apiRoute(`/api/v1/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/files`),
      { headers: adminHeaders(), data: { fileId: peer.fileId, role: "thermal", sortOrder: 1 } }
    );
    expect([200, 201], await addPeer.text()).toContain(addPeer.status());
  }
  const uploaded = await uploadDts(request, projectId, fileName, options.dts);
  const addPrimary = await request.post(
    apiRoute(`/api/v1/projects/${projectId}/config-sets/${encodeURIComponent(configSetId)}/files`),
    {
      headers: adminHeaders(),
      data: { fileId: uploaded.fileId, role: "base", sortOrder: 0 }
    }
  );
  expect([200, 201], await addPrimary.text()).toContain(addPrimary.status());
  await uploadDts(request, projectId, fileName, options.dts);

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
  expect(revisionId, "fixture must ingest an exact configuration revision").toBeTruthy();
  const valuePool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    expect(await syncPublishedCatalogProjectValues(valuePool, {
      organizationId, projectId, configSetId, configRevisionId: revisionId!
    })).toBeGreaterThanOrEqual(options.properties.length);
  } finally {
    await valuePool.end();
  }
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
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
          select b.id, b.definition_id as parameter_spec_id, property.raw_text as raw_value, lnr.node_locator
          from parameter_catalog.project_parameter_bindings b
          join parameter_catalog.parameter_definitions definition on definition.id = b.definition_id
          join parameter_catalog.project_parameter_values value on value.id = b.current_value_id
          join parameter_catalog.project_value_source_pins pin
            on pin.project_value_id = value.id and pin.binding_id = b.id and pin.config_revision_id = $1
          join dts_property_occurrences property on property.id = pin.property_occurrence_id
          join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id = pin.source_occurrence_id
          join dts_logical_node_revisions lnr
            on lnr.logical_node_id = occurrence.logical_node_id and lnr.config_revision_id = $1
          where b.organization_id = $2
            and b.project_id = $3
            and definition.property_key = $4
            and coalesce(property.raw_text, '') ~ $5
            and coalesce(lnr.node_locator, '') <> ''
            and ($6::text is null or lnr.node_locator ~ $6)
            and pin.file_id = $7
          order by b.id
          limit 1
          `,
          [
            revisionId,
            organizationId,
            projectId,
            property.propertyKey,
            property.rawValuePattern ?? ".",
            property.nodeLocatorPattern ?? null,
            uploaded.fileId
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
          fileId: uploaded.fileId,
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
  const projectId = options.projectId ?? defaultProjectId;
  const [kept, removable] = await seedIsolatedBindings(request, {
    projectId,
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
  options: { projectId?: string; rawHex?: string; unitAddress?: string; reason?: string } = {}
): Promise<{ reg: IsolatedBinding }> {
  const rawHex = options.rawHex ?? "0x6e";
  const unitAddress = options.unitAddress ?? "6E";
  const [reg] = await seedIsolatedBindings(request, {
    projectId: options.projectId,
    dts: hexRegDts(rawHex, unitAddress),
    properties: [
      {
        propertyKey: "vendor-id",
        rawValuePattern: ".",
        nodeLocatorPattern: `chip@${unitAddress}`
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
  const response = await request.post(apiRoute(
    `/api/v2/projects/${projectId}/parameter-value-drafts/${encodeURIComponent(input.draft.draftId)}/submit`
  ), {
    headers: headersFor(input.role ?? "admin"),
    data: {
      assignedToUserId: (input.assignees ?? defaultWorkflowAssignees).softwareCommitterId
    }
  });
  const bodyText = await response.text();
  if (!response.ok()) {
    return { status: response.status(), bodyText, requestId: null };
  }
  const body = JSON.parse(bodyText) as {
    item: { id: string };
  };
  const requestId = body.item.id;
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

/** Disposable post-cutover suites refuse leftover PPV columns and require a cutover marker. */
export async function assertPostCutoverIdentity(): Promise<void> {
  await withPgClient(async (client) => {
    const cutover = await client.query<{ c: string }>(
      `select count(*)::text as c from parameter_identity_cutovers`
    );
    expect(
      Number(cutover.rows[0]?.c ?? 0),
      "disposable spec requires parameter_identity_cutovers count > 0"
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
      "disposable spec refuses the retired project_parameter_value_id column"
    ).toBe(0);
  });
}

export async function lookupParameterFileVersion(input: {
  projectId?: string;
  fileName: string;
}): Promise<{ fileId: string; versionId: string; versionNumber: number }> {
  const projectId = input.projectId ?? defaultProjectId;
  return withPgClient(async (client) => {
    const result = await client.query<{ file_id: string; version_id: string; version_number: number }>(
      `
      select f.id as file_id, v.id as version_id, v.version_number
      from project_parameter_files f
      inner join project_parameter_file_versions v on v.file_id = f.id
      where f.organization_id = $1
        and f.project_id = $2
        and f.file_name = $3
      order by v.version_number desc
      limit 1
      `,
      [organizationId, projectId, input.fileName]
    );
    const row = result.rows[0];
    expect(row, `missing file version for ${input.fileName}`).toBeTruthy();
    return {
      fileId: row!.file_id,
      versionId: row!.version_id,
      versionNumber: Number(row!.version_number)
    };
  });
}

export async function seedSemanticFileUiConflict(input: {
  binding: IsolatedBinding;
  fileVersionId: string;
  fileValue: string;
  uiValue: string;
  fileUserId?: string;
  uiUserId?: string;
}): Promise<{ conflictId: string; fileDraftId: string; uiDraftId: string }> {
  const fileDraftId = randomUUID();
  const uiDraftId = randomUUID();
  const conflictId = randomUUID();
  const fileUserId = input.fileUserId ?? acceptanceCast.xuYun.userId;
  const uiUserId = input.uiUserId ?? acceptanceCast.zhaoHeng.userId;
  await withPgClient(async (client) => {
    await client.query(
      `
      insert into parameter_drafts (
        id, organization_id, project_id, user_id,
        target_value, reason, origin, origin_file_version_id,
        action, edit_subject_kind, project_parameter_binding_id
      )
      values
        ($1, $2, $3, $4, $5, $6, 'file_sync', $7, 'set', 'binding', $8),
        ($9, $2, $3, $10, $11, $12, 'manual', null, 'set', 'binding', $8)
      `,
      [
        fileDraftId,
        organizationId,
        input.binding.projectId,
        fileUserId,
        input.fileValue,
        `TD-079 file sync ${input.binding.propertyKey}`,
        input.fileVersionId,
        input.binding.bindingId,
        uiDraftId,
        uiUserId,
        input.uiValue,
        `TD-079 ui draft ${input.binding.propertyKey}`
      ]
    );
    await client.query(
      `
      insert into parameter_file_sync_conflicts (
        id, organization_id, project_id,
        file_version_id, file_draft_id, ui_draft_id, file_value, ui_draft_value, status,
        parameter_spec_id, project_parameter_binding_id
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10)
      `,
      [
        conflictId,
        organizationId,
        input.binding.projectId,
        input.fileVersionId,
        fileDraftId,
        uiDraftId,
        input.fileValue,
        input.uiValue,
        input.binding.parameterSpecId,
        input.binding.bindingId
      ]
    );
  });
  return { conflictId, fileDraftId, uiDraftId };
}
