import { expect, type APIRequestContext } from "playwright/test";

import { authHeadersForRole } from "./bearerAuth";
import { apiRoute } from "./runtime";

export type XiaozeCanonicalBinding = { bindingId: string; baseValue: number };

/**
 * Resolve a seeded canonical Catalog Binding whose current DTS value is a
 * single integer cell, through the public Bindings read API (no raw catalog SQL).
 * Sorted by Binding id so every run in the same database picks the same one.
 */
export async function resolveSeededSingleCellBinding(
  request: APIRequestContext,
  projectId: string
): Promise<XiaozeCanonicalBinding> {
  const response = await request.get(apiRoute(`/api/v2/projects/${projectId}/parameter-bindings`), {
    headers: authHeadersForRole("admin")
  });
  expect(response.status(), await response.text()).toBe(200);
  const items = (await response.json()).items as Array<{ id: string; rawValue?: string | null }>;
  const candidates = items
    .filter((item) => /^<[0-9]{1,6}>$/.test(item.rawValue ?? ""))
    .sort((left, right) => left.id.localeCompare(right.id));
  const first = candidates[0];
  if (!first) {
    throw new Error(`No seeded canonical ${projectId} Binding with a single-cell DTS value was found.`);
  }
  expect(first.id).toMatch(/^pbind_[0-9a-f]{64}$/);
  return { bindingId: first.id, baseValue: Number((first.rawValue ?? "").replace(/[<>]/g, "")) };
}
