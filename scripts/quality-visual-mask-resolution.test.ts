import { expect, it } from "vitest";
import type { Locator } from "playwright/test";
import { resolveVisualMasks } from "./quality-visual-mask-resolution";

const locator = (count: number) => ({ count: async () => count }) as Locator;

it("requires route masks to resolve, selects only populated optional masks, and rejects any unresolved capture mask", async () => {
  const required = locator(3);
  const optional = locator(1);
  expect(await resolveVisualMasks([required], [locator(0), optional])).toEqual([optional, required]);
  await expect(resolveVisualMasks([locator(0)], [])).rejects.toThrow("Visual mask did not resolve");
  await expect(resolveVisualMasks([required], [])).resolves.toEqual([required]);
  let calls = 0;
  const disappearing = { count: async () => ++calls === 1 ? 1 : 0 } as Locator;
  await expect(resolveVisualMasks([], [disappearing])).rejects.toThrow("Visual mask did not resolve");
});
