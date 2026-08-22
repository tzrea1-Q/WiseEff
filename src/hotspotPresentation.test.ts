import { describe, expect, it, vi } from "vitest";
import type { PrototypeState } from "@/domain/prototype/types";
import { computeEyebrow } from "./hotspotPresentation";

describe("computeEyebrow", () => {
  it("shows project coverage for module hotspots and recent change for project hotspots", () => {
    const state = {
      parameters: [
        { module: "Charging Policy", projectId: "aurora" },
        { module: "Charging Policy", projectId: "nebula" },
        { module: "Battery Safety", projectId: "aurora" }
      ]
    } as Pick<PrototypeState, "parameters">;

    expect(
      computeEyebrow({ module: "Charging Policy", projectCode: "2 个项目" }, state)
    ).toBe("2 个项目 · 2 项目");
    expect(
      computeEyebrow({ module: "项目参数", projectCode: "AUR-Prod", lastChangedAt: "36 分钟前" }, state)
    ).toBe("最近变更 36 分钟前");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:00:00.000Z"));
    expect(
      computeEyebrow(
        { module: "项目参数", projectCode: "AUR-Prod", lastChangedAt: "2026-07-06T09:01:09.370Z" },
        state
      )
    ).toBe("最近变更 2 天前");
    vi.useRealTimers();

    expect(computeEyebrow({ module: "项目参数", projectCode: "AUR-Prod" }, state)).toBe("多次变更");
  });
});
