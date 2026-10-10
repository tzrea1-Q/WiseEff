import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { IdentityMappingTask } from "@/domain/parameter-topology/types";
import { IdentityMappingReview } from "./IdentityMappingReview";

afterEach(() => {
  cleanup();
});

const AMBIGUOUS_TASK: IdentityMappingTask = {
  id: "map-amb-1",
  projectId: "project-1",
  configRevisionId: "rev-1",
  previousLogicalNodeId: "ln-prev",
  candidateLogicalNodeIds: ["ln-a", "ln-b"],
  taskKind: "identity-ambiguity",
  status: "open",
  createdAt: "2026-07-31T00:00:00.000Z",
  evidence: {
    previousNodeLocator: "/amba/i2c@1/dev@10",
    evidence: ["unit-address", "ambiguous-candidates"],
    candidates: [
      { logicalNodeId: "ln-a", nodeLocator: "/amba/i2c@1/dev_a@10", name: "dev_a" },
      { logicalNodeId: "ln-b", nodeLocator: "/amba/i2c@1/dev_b@10", name: "dev_b" }
    ],
    risk: "高风险（匹配冲突）"
  }
};

const SINGLETON_TASK: IdentityMappingTask = {
  id: "map-singleton-1",
  projectId: "project-1",
  configRevisionId: "rev-1",
  previousLogicalNodeId: null,
  candidateLogicalNodeIds: ["ln-inst-1", "ln-inst-2"],
  taskKind: "singleton-cardinality",
  status: "open",
  createdAt: "2026-07-31T00:00:00.000Z",
  evidence: {
    evidence: ["singleton-per-project violation", "driver registration expects one instance"],
    candidates: [
      { logicalNodeId: "ln-inst-1", nodeLocator: "/amba/i2c@1/sc8562@6E", name: "sc8562" },
      { logicalNodeId: "ln-inst-2", nodeLocator: "/amba/i2c@2/sc8562@7F", name: "sc8562" }
    ]
  }
};

const RESOLVED_TASK: IdentityMappingTask = {
  ...AMBIGUOUS_TASK,
  status: "resolved",
  reason: "Initial continuity choice",
  resolvedAt: "2026-08-18T00:00:00.000Z",
  evidence: {
    ...AMBIGUOUS_TASK.evidence,
    selectedLogicalNodeId: "ln-a",
    selectedNodeLocator: "/amba/i2c@1/dev_a@10",
    continuityReusable: true
  }
};

describe("IdentityMappingReview", () => {
  it("shows taskKind badges for identity ambiguity and singleton cardinality", () => {
    render(<IdentityMappingReview tasks={[AMBIGUOUS_TASK, SINGLETON_TASK]} />);

    const review = screen.getByRole("region", { name: "节点对应审核" });
    expect(within(review).getByText("身份歧义")).toBeInTheDocument();
    expect(within(review).getByText("单例冲突")).toBeInTheDocument();
  });

  it("shows singleton guidance without identity resolve controls", () => {
    render(<IdentityMappingReview tasks={[SINGLETON_TASK]} />);

    const review = screen.getByRole("region", { name: "节点对应审核" });
    expect(within(review).getByRole("status", { name: "单例冲突修复指引" })).toHaveTextContent(
      /登记|拓扑/
    );
    expect(within(review).queryByRole("combobox", { name: "选择对应节点" })).not.toBeInTheDocument();
    expect(within(review).queryByRole("button", { name: "确认对应" })).not.toBeInTheDocument();
    expect(within(review).queryByRole("button", { name: "声明新身份" })).not.toBeInTheDocument();
    expect(within(review).queryByRole("button", { name: "驳回" })).not.toBeInTheDocument();
  });

  it("retains resolved evidence and current identity without mutation controls", () => {
    render(<IdentityMappingReview tasks={[RESOLVED_TASK]} />);
    const history = screen.getByRole("list", { name: "节点对应历史" });
    expect(within(history).getByText(/当前对应/)).toHaveTextContent("/amba/i2c@1/dev_a@10");
    expect(within(history).getByText(/原因/)).toHaveTextContent("Initial continuity choice");
    expect(within(history).queryByRole("button")).not.toBeInTheDocument();
    expect(within(history).queryByRole("combobox")).not.toBeInTheDocument();
  });
});
