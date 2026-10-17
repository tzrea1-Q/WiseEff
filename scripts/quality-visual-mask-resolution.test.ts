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

it("masks only the optional Catalog banner after removal of the publication anchor, leaving the workbench compared", async () => {
  const counts = {
    ".parameter-catalog__banner": 1,
    ".parameter-catalog .navigator-workbench__body": 1,
    ".parameter-catalog__workspace": 1,
  };
  expect((await stableMasks(routePage(counts), "/parameter-admin")).map(String)).toEqual([
    ".parameter-catalog__banner",
  ]);
  expect((await stableMasks(routePage({ ...counts, ".parameter-catalog__banner": 0 }), "/parameter-admin")).map(String))
    .toEqual([]);
});

it("declares raw timestamps only for the log analysis state, not the failed-log state", async () => {
  expect(await stableMasks(routePage({}, true), "/logs")).toEqual([]);
  expect((await stableMasks(routePage({ ".rawlog-table__time": 3 }), "/logs")).map(String)).toEqual([".rawlog-table__time"]);
  await expect(stableMasks(routePage({}), "/logs")).rejects.toThrow("Visual mask did not resolve");
});
