import pg from "pg";
import { expect, type APIRequestContext } from "playwright/test";

import { compileCatalogRelease } from "../../../server/modules/catalog-kernel/compiler/index";
import { installPublishedRelease } from "../../../server/modules/catalog-kernel/install/installer";
import { jsonCatalogReleaseSource } from "../../../server/modules/catalog-kernel/interface";
import { firstReleaseBundle } from "../../../server/testing/parameterCatalog/cutoverPopulatedFixture";
import { authHeadersForRole } from "./bearerAuth";
import { withPgClient } from "./database";
import {
  startDisposablePostCutoverRuntime,
  type DisposablePostCutoverRuntime
} from "./disposablePostCutoverRuntime";
import {
  applyDisposableRuntimeEnv,
  captureProcessEnvForDisposableRuntime,
  restoreProcessEnvFromDisposableRuntime
} from "./semanticBindingFixture";

export const CANONICAL_RELOAD_ORGANIZATION_ID = "org-chargelab";
export const CANONICAL_RELOAD_PROJECT_ID = "canonical-reload-local";
export const CANONICAL_RELOAD_PROPERTY_KEY = "iin_max";
export const CANONICAL_RELOAD_BASELINE_VALUE = "<1000>";

const source = `/dts-v1/;
/ {
  charger {
    compatible = "acme,power";
    ${CANONICAL_RELOAD_PROPERTY_KEY} = ${CANONICAL_RELOAD_BASELINE_VALUE};
  };
};
`;

export type CanonicalReloadRuntime = {
  runtime: DisposablePostCutoverRuntime;
  projectId: string;
  organizationId: string;
  bindingId: string;
  restoreProcessEnv(): void;
};

/**
 * Starts a disposable post-cutover runtime that owns a Catalog fixture and one
 * canonical DTS Binding (`iin_max`, `<1000>`) created through the real
 * registration, config-set and source-upload APIs. The caller disposes the
 * runtime and restores the process environment.
 */
export async function startCanonicalReloadRuntime(
  request: APIRequestContext,
  label: string
): Promise<CanonicalReloadRuntime> {
  const environment = captureProcessEnvForDisposableRuntime();
  if (!environment.databaseUrl) throw new Error("Explicit disposable-runtime parent DATABASE_URL is required");
  const runtime = await startDisposablePostCutoverRuntime(environment.databaseUrl, {
    label,
    catalog: "fixture-owned"
  });
  applyDisposableRuntimeEnv(runtime);
  const projectId = CANONICAL_RELOAD_PROJECT_ID;
  const organizationId = CANONICAL_RELOAD_ORGANIZATION_ID;
  await withPgClient(async (client) => {
    await client.query(
      `insert into projects(id,organization_id,name,code,status)
       values ($1,$2,'Canonical reload local','CRELOAD','initialized')`,
      [projectId, organizationId]
    );
    await client.query(
      `insert into attribution_subjects(id,organization_id,subject_kind,display_name,source_key)
       values ('attr-reload-acme',$1,'driver-registration','Acme power','compatible:acme,power')`,
      [organizationId]
    );
    await client.query(
      `insert into driver_registrations(attribution_subject_id,driver_nature,instance_cardinality)
       values ('attr-reload-acme','physical-device','multiple')`
    );
    await client.query(
      `insert into parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
       values ('pmod-reload-acme',$1,'Acme power','pmod-reload-acme',1,'driver-group','curated','attr-reload-acme')`,
      [organizationId]
    );
  });
  const bundle = firstReleaseBundle();
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) throw new Error("Reviewed first-release fixture did not compile");
  const pool = new pg.Pool({ connectionString: runtime.databaseUrl });
  try {
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.value.aggregateDigest
    });
    expect(installed.ok, JSON.stringify(installed)).toBe(true);
  } finally {
    await pool.end();
  }
  const headers = authHeadersForRole("admin");
  const api = (route: string) => `${runtime.apiUrl}${route}`;
  const registration = await request.post(api(`/api/v2/organizations/${organizationId}/subject-registrations`), {
    headers: {
      ...headers,
      "X-WiseEff-Catalog-Release": compiled.value.release.id,
      "Idempotency-Key": "reload-acme-registration"
    },
    data: { subjectId: "csub_acme_power", placement: { mode: "use-default" }, reason: "Canonical reload fixture" }
  });
  expect(registration.status(), await registration.text()).toBe(201);
  const config = await request.post(api(`/api/v1/projects/${projectId}/config-sets`), {
    headers,
    data: { name: "default", description: "Canonical reload fixture" }
  });
  expect(config.status(), await config.text()).toBe(201);
  const configSetId = (await config.json()).item.id as string;
  const upload = () =>
    request.post(api(`/api/v1/projects/${projectId}/parameter-files`), {
      headers,
      data: { fileName: "charger.dts", contentBase64: Buffer.from(source).toString("base64") }
    });
  const first = await upload();
  expect(first.status(), await first.text()).toBe(201);
  const fileId = (await first.json()).item.id as string;
  const member = await request.post(api(`/api/v1/projects/${projectId}/config-sets/${configSetId}/files`), {
    headers,
    data: { fileId, role: "base", sortOrder: 0 }
  });
  expect(member.ok(), await member.text()).toBe(true);
  // Re-uploading the member publishes a Config Revision that discovers the Binding.
  const second = await upload();
  expect(second.status(), await second.text()).toBe(201);
  const bindings = await request.get(api(`/api/v2/projects/${projectId}/parameter-bindings`), { headers });
  expect(bindings.status(), await bindings.text()).toBe(200);
  const rows = (await bindings.json()).items as Array<{ id: string }>;
  expect(rows).toHaveLength(1);
  return {
    runtime,
    projectId,
    organizationId,
    bindingId: rows[0]!.id,
    restoreProcessEnv: () => restoreProcessEnvFromDisposableRuntime(environment)
  };
}

/**
 * Starts a real reload run for the canonical Binding. The exact canonical value and
 * DTS Source Pin identities are taken from the candidate list, as the workbench does.
 */
export async function startCanonicalReloadRun(
  request: APIRequestContext,
  fixture: CanonicalReloadRuntime,
  debugValue: string,
  role: "admin" = "admin"
): Promise<{ id: string; status: string }> {
  const headers = authHeadersForRole(role);
  const candidates = await request.get(
    `${fixture.runtime.apiUrl}/api/v1/dts-reload/projects/${fixture.projectId}/candidates`,
    { headers }
  );
  expect(candidates.status(), await candidates.text()).toBe(200);
  const candidate = ((await candidates.json()).items as Array<Record<string, unknown>>).find(
    (item) => item.bindingId === fixture.bindingId
  );
  expect(candidate, "canonical Binding must be a reload candidate").toBeTruthy();
  // Same projection the workbench sends: exact canonical value and DTS Source Pin identities.
  const pin = candidate!.protectedReferencePin as Record<string, unknown>;
  const writeback = candidate!.writebackSourcePin as Record<string, unknown>;
  const pins = {
    definitionId: pin.definitionId,
    definitionRevisionId: pin.definitionRevisionId,
    currentValueId: pin.currentValueId,
    catalogReleaseId: pin.catalogReleaseId,
    configRevisionId: pin.configRevisionId,
    sourcePinId: pin.sourcePinId,
    sourceOccurrenceId: pin.sourceOccurrenceId,
    sourceRef: writeback.sourceRef,
    sourceFormat: pin.sourceFormat,
    sourceLocator: pin.sourceLocator
  };
  const started = await request.post(
    `${fixture.runtime.apiUrl}/api/v1/dts-reload/projects/${fixture.projectId}/runs`,
    { headers, data: { targets: [{ bindingId: fixture.bindingId, debugValue, ...pins }] } }
  );
  expect(started.status(), await started.text()).toBe(201);
  return (await started.json()).item as { id: string; status: string };
}
