import { describe, expect, it, vi } from "vitest";
import {
  ACCEPTANCE_WARMUP_ROUTES,
  QUALITY_WARMUP_ROUTES,
  warmPlaywrightFrontend,
  type WarmupPage
} from "../e2e/shared/runtimeWarmup";

describe("runtimeWarmup", () => {
  it("exports default warmup routes", () => {
    expect(QUALITY_WARMUP_ROUTES).toEqual(["/", "/logs"]);
    expect(ACCEPTANCE_WARMUP_ROUTES).toEqual(["/"]);
  });

  it("visits each route with domcontentloaded and waits for body", async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const waitFor = vi.fn().mockResolvedValue(undefined);
    const page: WarmupPage = {
      goto,
      locator: () => ({ waitFor })
    };

    await warmPlaywrightFrontend(page, ["/", "/logs"]);

    expect(goto).toHaveBeenCalledTimes(2);
    expect(goto).toHaveBeenNthCalledWith(1, "/", { waitUntil: "domcontentloaded" });
    expect(goto).toHaveBeenNthCalledWith(2, "/logs", { waitUntil: "domcontentloaded" });
    expect(waitFor).toHaveBeenCalledTimes(2);
    expect(waitFor).toHaveBeenCalledWith({ state: "visible" });
  });
});
