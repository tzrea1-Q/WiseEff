import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnifiedAgent } from "./UnifiedAgent";
import type { createAgentPlan } from "@/appConfig";
import { createPrototypeState } from "@/mockData";

const comparisonSelection = {
  baseProjectId: "aurora",
  targetProjectId: "nebula"
};

const parameterPlan = {
  shellVariant: "unified-glass-agent",
  contextTitle: "Parameter Agent",
  contextSummary: "Parameter context",
  steps: ["Read context"],
  prompts: [],
  actions: [
    { id: "filter-high-risk", label: "Filter high risk", requiresConfirm: false },
    { id: "draft-parameter-change", label: "Draft parameter change", requiresConfirm: true, requiredPermission: "parameter.edit" }
  ]
} satisfies ReturnType<typeof createAgentPlan>;

afterEach(() => {
  cleanup();
});

describe("UnifiedAgent permission boundaries", () => {
  it("hides parameter draft actions from Guest", () => {
    render(
      <UnifiedAgent
        path="/parameters"
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "guest" }}
        dispatch={vi.fn()}
        comparisonSelection={comparisonSelection}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));

    expect(screen.getByRole("button", { name: "Filter high risk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draft parameter change" })).not.toBeInTheDocument();
  });

  it("keeps permitted parameter draft actions executable for User", () => {
    const dispatch = vi.fn();
    render(
      <UnifiedAgent
        path="/parameters"
        plan={parameterPlan}
        state={{ ...createPrototypeState(), activeRoleId: "user" }}
        dispatch={dispatch}
        comparisonSelection={comparisonSelection}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 WiseAgent" }));
    fireEvent.click(screen.getByRole("button", { name: "Draft parameter change" }));
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ADD_CHANGE_REQUEST"
      })
    );
  });
});
