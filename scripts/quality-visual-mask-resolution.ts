import type { Locator } from "playwright/test";

export async function resolveVisualMasks(required: Locator[], optional: Locator[]): Promise<Locator[]> {
  const masks: Locator[] = [];
  for (const mask of optional) {
    if (await mask.count() > 0) masks.push(mask);
  }
  masks.push(...required);
  for (const mask of masks) {
    if (await mask.count() === 0) throw new Error(`Visual mask did not resolve: ${mask}`);
  }
  return masks;
}
