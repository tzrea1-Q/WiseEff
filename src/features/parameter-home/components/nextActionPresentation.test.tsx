import { describe, expect, it } from "vitest";
import type { WorkbenchAction } from "../workbench/derivePersonalWorkbench";
import { getNextActionPresentation } from "./nextActionPresentation";

function action(over: Partial<WorkbenchAction>): WorkbenchAction {
  return {
    id: "test-action",
    kind: "todo",
    priority: "secondary",
    title: "Test",
    description: "Test",
    meta: "Test",
    path: "/",
    source: "admin",
    ...over
  };
}

describe("getNextActionPresentation", () => {
  it("maps known admin actions to distinct icon tones", () => {
    expect(getNextActionPresentation(action({ id: "admin-import-batches" })).tone).toBe("import");
    expect(getNextActionPresentation(action({ id: "admin-user-review" })).tone).toBe("users");
    expect(getNextActionPresentation(action({ id: "admin-high-risk-library" })).tone).toBe("risk-governance");
  });

  it("cycles hotspot recommendations across icon tones", () => {
    const tones = [0, 1, 2].map((index) =>
      getNextActionPresentation(
        action({ id: "hotspot-x", kind: "recommendation", source: "hotspot", visualKey: `hotspot-variant-${index}` })
      ).tone
    );
    expect(tones).toEqual(["hotspot-alert", "hotspot-trend", "hotspot-focus"]);
  });
});
