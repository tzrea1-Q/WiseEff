import { expect, it } from "vitest";
import type { PoolClient } from "pg";
import { getRootPostgresPool } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { createUserInvocation } from "../auth/trustedInvocation";
import { parseDtsValue } from "../dts/valueAst";
import { createCanonicalValueDraft } from "../parameter-bindings/drafts/service";
import { submitCanonicalValueChange } from "../parameter-bindings/drafts/changeService";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { createSourceAdminFixture, sourceAdminText } from "../parameter-files/sourceAdministration.testHelpers";
import { catalogProjectConfigurationsResponseSchema } from "../contracts/dtoSchemas/parameterCatalog";
import { registerParameterCatalogApi } from "./productionWire";

const definitionId = "pdef_acme_power_iin_max";
type Fixture = Awaited<ReturnType<typeof createSourceAdminFixture>>;

async function request(f: Fixture, query = "") {
  const router = createRouter();
  registerParameterCatalogApi(router, { db: f.api, objectStore: f.storage, resolveAuth: () => f.auth });
  return requestJson(createHttpServer(router), `/api/v2/catalog/definitions/${definitionId}/project-configurations${query}`);
}
async function read(f: Fixture, query = "") {
  const response = await request(f, query);
  expect(response.status).toBe(200);
  return catalogProjectConfigurationsResponseSchema.parse(response.body);
}

it.each([
  ["deleted property", sourceAdminText.replace("iin_max = <36>;", "")],
  ["suspended source", sourceAdminText.replace('compatible = "acme,power"', 'compatible = "unknown,power"')],
])("excludes a %s after the actual source revision writer commits", async (label, updated) => {
  const f = await createSourceAdminFixture(`parlib-${label.startsWith("deleted") ? "deleted" : "suspended"}`, createUserInvocation);
  try {
    expect((await read(f)).summary).toEqual({ configuredProjectCount: 1, configuredInstanceCount: 1 });
    await (await f.stage(updated, `parlib-${label}`)).apply();
    expect(await read(f)).toMatchObject({ summary: { configuredProjectCount: 0, configuredInstanceCount: 0 }, items: [] });
  } finally { await f.close(); }
}, 120_000);

it("keeps rows, counts and selected source on one snapshot across a concurrent current-value commit", async () => {
  const source = sourceAdminText.replace(/};$/, ' auxiliary { compatible = "acme,power"; iin_max = <43>; }; };');
  const f = await createSourceAdminFixture("parlib-snapshot", createUserInvocation, { sourceText: source });
  const pool = getRootPostgresPool(f.api)!;
  const originals = new Map<PoolClient, PoolClient["query"]>();
  let resume!: () => void;
  let reached!: () => void;
  let armed = true;
  const paused = new Promise<void>((resolve) => { reached = resolve; });
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  const intercept = (client: PoolClient) => {
    if (originals.has(client)) return;
    const original = client.query;
    originals.set(client, original);
    client.query = function (this: PoolClient, ...args: unknown[]) {
      if (armed && typeof args[0] === "string" && /md5\(coalesce\(string_agg/.test(args[0])) {
        armed = false; reached();
        return gate.then(() => Reflect.apply(original, this, args));
      }
      return Reflect.apply(original, this, args);
    } as typeof original;
  };
  try {
    const initial = await read(f);
    const bindingId = initial.items.find((item) => item.valuePreview === "<36>")!.bindingId;
    const firstPage = await read(f, "?limit=1");
    expect(firstPage.nextCursor).toBeTruthy();
    const staged = await f.stage(source.replace("<36>", "<42>"), "parlib-snapshot-change");
    pool.on("acquire", intercept);
    const pending = read(f, `?selectedBindingId=${bindingId}`);
    await paused;
    await staged.apply();
    resume();
    const before = await pending;
    expect(before.summary).toEqual({ configuredProjectCount: 1, configuredInstanceCount: 2 });
    expect(before.items.find((item) => item.bindingId === bindingId)?.valuePreview).toBe("<36>");
    expect(before.selected?.rawValue).toBe("<36>");
    const after = await read(f, `?selectedBindingId=${bindingId}`);
    expect(after.items.find((item) => item.bindingId === bindingId)?.valuePreview).toBe("<42>");
    expect(after.selected?.rawValue).toBe("<42>");
    const stale = await request(f, `?cursor=${firstPage.nextCursor}`);
    expect(stale.status).toBe(400);
  } finally {
    resume(); pool.off("acquire", intercept);
    for (const [client, query] of originals) client.query = query;
    await f.close();
  }
}, 120_000);

it("excludes persisted draft, pending review and device debug values", async () => {
  const f = await createSourceAdminFixture("parlib-pending", createUserInvocation);
  try {
    const initial = await read(f);
    const item = initial.items[0]!;
    const pin = await loadOwnedProjectValueSourcePin(f.api, { organizationId: f.organizationId, projectId: f.projectId,
      bindingId: item.bindingId, projectValueId: item.currentValueId });
    if (!pin) throw new Error("Fixture source pin unavailable");
    const reviewerId = "parlib-pending-reviewer";
    await f.db.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Reviewer','Reviewer',true)", [reviewerId, f.organizationId]);
    await f.db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values ('parlib-review-role',$1,$2,$3,'software-committer')", [reviewerId, f.organizationId, f.projectId]);
    const draft = await createCanonicalValueDraft(f.api, f.auth, { projectId: f.projectId, bindingId: item.bindingId,
      targetValue: parseDtsValue("iin_max", "<42>").value, reason: "Draft exclusion", baseRevisionId: pin.configRevisionId,
      baseCurrentValueId: item.currentValueId }, { ...f.security, objectStore: f.storage });
    expect((await read(f)).items[0]?.valuePreview).toBe("<36>");
    await submitCanonicalValueChange(f.api, f.auth, { projectId: f.projectId, draftId: draft.id,
      assignedToUserId: reviewerId, ...f.security });
    await f.db.query(`insert into dts_reload_runs(id,organization_id,project_id,config_revision_id,status,created_by_user_id)
      values ('parlib-debug-run',$1,$2,$3,'validated',$4)`, [f.organizationId, f.projectId, pin.configRevisionId, f.auth.user.id]);
    await f.db.query(`insert into dts_reload_run_targets(id,reload_run_id,binding_id,node_path,property_key,baseline_value,debug_value,
      canonical_binding_id,canonical_definition_id,canonical_definition_revision_id,canonical_current_value_id,canonical_catalog_release_id,
      canonical_source_pin_id,canonical_source_occurrence_id,canonical_config_revision_id,canonical_source_ref,canonical_source_format,canonical_source_locator)
      select 'parlib-debug-target','parlib-debug-run',null,'/charger','iin_max','<36>','<77>',binding.id,binding.definition_id,
        value.definition_revision_id,value.id,binding.catalog_release_id,pin.id,pin.source_occurrence_id,pin.config_revision_id,value.source_ref,'dts',pin.locator
      from parameter_catalog.project_parameter_bindings binding
      join parameter_catalog.project_parameter_values value on value.id=binding.current_value_id
      join parameter_catalog.project_value_source_pins pin on pin.project_value_id=value.id
      where binding.id=$1`, [item.bindingId]);
    const current = await read(f);
    expect(current.summary).toEqual({ configuredProjectCount: 1, configuredInstanceCount: 1 });
    expect(current.items[0]?.valuePreview).toBe("<36>");
  } finally { await f.close(); }
}, 120_000);
