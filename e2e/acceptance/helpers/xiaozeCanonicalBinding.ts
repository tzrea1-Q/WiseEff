import { expect, type APIRequestContext } from "playwright/test";

import { authHeadersForRole } from "./bearerAuth";
import { apiRoute } from "./runtime";

export type XiaozeCanonicalBinding = { bindingId: string; baseValue: number };

/**
 * Resolve the published input-current tuning value, not an arbitrary identity
 * or critical property, through canonical read APIs (no raw catalog SQL).
 * Require a current structured DTS source; setup belongs to the runtime owner.
 */
export async function resolveSeededWritableSingleCellBinding(
  request: APIRequestContext,
  projectId: string
): Promise<XiaozeCanonicalBinding> {
  const response = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), {
    headers: authHeadersForRole("admin")
  });
  expect(response.status(), await response.text()).toBe(200);
  const items = (await response.json()).items as Array<{
    id: string;
    definitionId: string;
    effectiveRevisionId: string;
    currentValueId: string;
    sourceFileId: string | null;
    sourceNodePath: string | null;
    propertyKey: string;
    schemaState: string;
    rawValue?: string | null;
  }>;
  const candidates = items
    .filter((item) => item.definitionId === "pdef_drv_huawei_charging_core_iin_max"
      && item.propertyKey === "iin_max" && /^<[0-9]{1,6}>$/.test(item.rawValue ?? ""))
    .sort((left, right) => left.id.localeCompare(right.id));
  const first = candidates[0];
  if (!first) {
    throw new Error(`No published canonical ${projectId} input-current Binding with a single-cell DTS value was found.`);
  }
  expect(first.id).toMatch(/^pbind_[0-9a-f]{64}$/);
  expect(first.currentValueId).toBeTruthy();
  expect(first.sourceFileId).toBeTruthy();
  expect(first.sourceNodePath, "Runtime owner must materialize the current canonical source structural model.").toBeTruthy();
  expect(first.schemaState).toBe("valid");
  const definitionResponse = await request.get(apiRoute(`/api/v2/catalog/definitions/${first.definitionId}`), {
    headers: authHeadersForRole("admin")
  });
  expect(definitionResponse.status(), await definitionResponse.text()).toBe(200);
  expect(definitionResponse.headers()["x-wiseeff-catalog-release"]).toBeTruthy();
  const definition = (await definitionResponse.json()).item;
  expect(definition.id).toBe(first.definitionId);
  expect(definition.propertyKey).toBe(first.propertyKey);
  expect(definition.lifecycle).toBe("active");
  expect(definition.currentRevision.id).toBe(first.effectiveRevisionId);
  expect(definition.currentRevision.publishedInCatalogReleaseId).toBeTruthy();
  expect(definition.currentRevision.valueShape).toMatchObject({
    kind: "json-schema",
    schema: { type: "array", items: { type: "integer", minimum: 0 } }
  });
  return { bindingId: first.id, baseValue: Number((first.rawValue ?? "").replace(/[<>]/g, "")) };
}
