import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const SINGLE_CANDIDATE_TASK: IdentityMappingTask = {
  ...AMBIGUOUS_TASK,
  id: "map-single-cand",
  candidateLogicalNodeIds: ["ln-a"],
  evidence: {
    ...AMBIGUOUS_TASK.evidence,
    candidates: [{ logicalNodeId: "ln-a", nodeLocator: "/amba/i2c@1/dev_a@10", name: "dev_a" }]
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

  it("supports resolved action for identity ambiguity", () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<IdentityMappingReview tasks={[AMBIGUOUS_TASK]} onResolve={onResolve} />);

    const review = screen.getByRole("region", { name: "节点对应审核" });
    fireEvent.change(within(review).getByRole("combobox", { name: "选择对应节点" }), {
      target: { value: "ln-a" }
    });
    fireEvent.change(within(review).getByLabelText("确认原因"), {
      target: { value: "Same physical instance" }
    });
    fireEvent.click(within(review).getByRole("button", { name: "确认对应" }));

    expect(onResolve).toHaveBeenCalledWith("map-amb-1", {
      decision: "resolved",
      selectedLogicalNodeId: "ln-a",
      reason: "Same physical instance"
    });
  });

  it("supports dismissed action for identity ambiguity", () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<IdentityMappingReview tasks={[AMBIGUOUS_TASK]} onResolve={onResolve} />);

    const review = screen.getByRole("region", { name: "节点对应审核" });
    fireEvent.change(within(review).getByLabelText("确认原因"), {
      target: { value: "Cannot decide safely" }
    });
    fireEvent.click(within(review).getByRole("button", { name: "驳回" }));

    expect(onResolve).toHaveBeenCalledWith("map-amb-1", {
      decision: "dismissed",
      reason: "Cannot decide safely"
    });
  });

  it("requires confirmAllCandidates for multi-candidate new_identity", () => {
    const onResolve = vi.fn();
    render(<IdentityMappingReview tasks={[AMBIGUOUS_TASK]} onResolve={onResolve} />);

    const review = screen.getByRole("region", { name: "节点对应审核" });
    fireEvent.change(within(review).getByLabelText("确认原因"), {
      target: { value: "Both are distinct boards" }
    });

    const declareButton = within(review).getByRole("button", { name: "声明新身份" });
    expect(declareButton).toBeDisabled();

    fireEvent.click(within(review).getByRole("checkbox", { name: "确认保留全部候选为新身份" }));
    expect(declareButton).toBeEnabled();

    fireEvent.click(declareButton);
    expect(onResolve).toHaveBeenCalledWith("map-amb-1", {
      decision: "new-identity",
      reason: "Both are distinct boards",
      confirmAllCandidates: true
    });
  });

  it("allows new_identity for a single candidate without confirmAllCandidates", () => {
    const onResolve = vi.fn();
    render(<IdentityMappingReview tasks={[SINGLE_CANDIDATE_TASK]} onResolve={onResolve} />);

    const review = screen.getByRole("region", { name: "节点对应审核" });
    expect(
      within(review).queryByRole("checkbox", { name: "确认保留全部候选为新身份" })
    ).not.toBeInTheDocument();

    fireEvent.change(within(review).getByLabelText("确认原因"), {
      target: { value: "Allocate fresh logical node" }
    });
    fireEvent.click(within(review).getByRole("button", { name: "声明新身份" }));

    expect(onResolve).toHaveBeenCalledWith("map-single-cand", {
      decision: "new-identity",
      reason: "Allocate fresh logical node"
    });
  });

  it("shows singleton guidance without identity resolve controls", () => {
    const onResolve = vi.fn();
    render(<IdentityMappingReview tasks={[SINGLETON_TASK]} onResolve={onResolve} />);

    const review = screen.getByRole("region", { name: "节点对应审核" });
    expect(within(review).getByRole("status", { name: "单例冲突修复指引" })).toHaveTextContent(
      /登记|拓扑/
    );
    expect(within(review).queryByRole("combobox", { name: "选择对应节点" })).not.toBeInTheDocument();
    expect(within(review).queryByRole("button", { name: "确认对应" })).not.toBeInTheDocument();
    expect(within(review).queryByRole("button", { name: "声明新身份" })).not.toBeInTheDocument();
    expect(within(review).queryByRole("button", { name: "驳回" })).not.toBeInTheDocument();
  });

  it("offers a governed loading and disabled state for protected re-resolve", async () => {
    let finishResolve!: () => void;
    const onResolve = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finishResolve = resolve;
      })
    );
    render(<IdentityMappingReview tasks={[RESOLVED_TASK]} onResolve={onResolve} />);

    const history = screen.getByRole("list", { name: "节点对应历史" });
    expect(within(history).getByText(/当前对应/)).toHaveTextContent("/amba/i2c@1/dev_a@10");

    const submitButton = within(history).getByRole("button", { name: "确认重新对应" });
    expect(submitButton).toHaveClass("subtle");
    expect(submitButton).toHaveAttribute("title", "请选择不同于当前对应的候选节点");

    fireEvent.change(within(history).getByRole("combobox", { name: "重新选择对应节点" }), {
      target: { value: "ln-b" }
    });
    expect(submitButton).toHaveAttribute("title", "请填写重新对应原因");
    fireEvent.change(within(history).getByLabelText("重新对应原因"), {
      target: { value: "Corrected after reviewing the board evidence" }
    });
    fireEvent.click(submitButton);

    expect(onResolve).toHaveBeenCalledWith("map-amb-1", {
      decision: "resolved",
      selectedLogicalNodeId: "ln-b",
      reason: "Corrected after reviewing the board evidence"
    });
    expect(submitButton).toHaveAttribute("aria-busy", "true");
    expect(submitButton.querySelector(".dts-status-icon--spin")).toBeInTheDocument();

    finishResolve();
    await vi.waitFor(() => expect(submitButton).not.toHaveAttribute("aria-busy"));
  });
});
