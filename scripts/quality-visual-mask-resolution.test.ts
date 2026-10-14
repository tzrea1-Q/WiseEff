import { expect, it } from "vitest";
import type { Locator, Page } from "playwright/test";
import { resolveVisualMasks } from "./quality-visual-mask-resolution";
import { stableMasks } from "../e2e/quality/helpers";

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

function routePage(counts: Record<string, number>, failedLog = false) {
  return {
    locator: (selector: string) => ({
      count: async () => counts[selector] ?? 0,
      isVisible: async () => selector === ".log-error-alert" && failedLog,
      toString: () => selector,
    }),
  } as unknown as Page;
}

it("declares the current Catalog workbench body, not its retired workspace selector", async () => {
  const counts = { ".parameter-catalog__anchor": 1, ".parameter-catalog .navigator-workbench__body": 1 };
  expect((await stableMasks(routePage(counts), "/parameter-admin")).map(String)).toEqual(Object.keys(counts));
  await expect(stableMasks(routePage({ ...counts, ".parameter-catalog .navigator-workbench__body": 0 }), "/parameter-admin"))
    .rejects.toThrow("Visual mask did not resolve");
});

it("declares raw timestamps only for the log analysis state, not the failed-log state", async () => {
  expect(await stableMasks(routePage({}, true), "/logs")).toEqual([]);
  expect((await stableMasks(routePage({ ".rawlog-table__time": 3 }), "/logs")).map(String)).toEqual([".rawlog-table__time"]);
  await expect(stableMasks(routePage({}), "/logs")).rejects.toThrow("Visual mask did not resolve");
});
