import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SituationStrip } from "./SituationStrip";

const overallKpis = {
  totalParameters: 51,
  totalBindings: 51,
  totalDefinitions: 40,
  managedProjects: 3,
  changeFrequency: 19,
  activeContributors: 5,
  highRiskParameters: null,
  riskAvailability: "unavailable" as const
};

const personalKpis = {
  contributionCount: 4,
  workflowCount: 2,
  openItemCount: 1,
  pendingTodoCount: 3,
  highRiskTouchCount: 1
};

describe("SituationStrip", () => {
  it.each(["personal", "overall"] as const)("does not substitute %s samples from the other scope", (scope) => {
    render(<SituationStrip status="ready" scope={scope} roleView="user" onScopeChange={() => undefined}
      kpis={scope === "overall" ? null : overallKpis}
      personalKpis={scope === "personal" ? null : personalKpis} />);
    expect(screen.getAllByText("暂无样本")).toHaveLength(scope === "personal" ? 5 : 6);
    expect(screen.queryByText("不可用")).not.toBeInTheDocument();
  });

  it.each(["idle", "loading", "error", "ready", "empty"] as const)(
    "only shows retained zero personal KPIs as empty when the summary is available (%s)",
    (status) => {
      render(
        <SituationStrip
          status={status}
          kpis={overallKpis}
          personalKpis={{ ...personalKpis, contributionCount: 0, workflowCount: 0, openItemCount: 0, pendingTodoCount: 0, highRiskTouchCount: 0 }}
          scope="personal"
          roleView="user"
          onScopeChange={() => undefined}
          error="态势指标加载失败"
        />
      );

      const emptyMessage = screen.queryByText("当前时间窗口暂无个人活动");
      if (status === "ready" || status === "empty") {
        expect(emptyMessage).toBeInTheDocument();
      } else {
        expect(emptyMessage).not.toBeInTheDocument();
      }
      if (status === "idle" || status === "loading") {
        expect(screen.getByRole("status")).toBeInTheDocument();
      }
      if (status === "error") {
        expect(screen.getByText("态势指标加载失败")).toBeInTheDocument();
      }
      expect(screen.queryAllByText("0")).toHaveLength(0);
      expect(screen.queryAllByText("暂无样本")).toHaveLength(status === "ready" || status === "empty" ? 5 : 0);
    }
  );

  it("does not infer observations from an empty overall inventory marked ready", () => {
    render(<SituationStrip status="ready" scope="overall" roleView="user" onScopeChange={() => undefined}
      kpis={{ ...overallKpis, totalParameters: 0, totalBindings: 0, totalDefinitions: 0, managedProjects: 0,
        changeFrequency: 0, activeContributors: 0 }} personalKpis={personalKpis} />);
    expect(screen.getAllByText("暂无样本")).toHaveLength(6);
    expect(screen.getByText("当前时间窗口暂无参数活动数据。")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("keeps an observed personal risk count even when other counts are zero", () => {
    render(<SituationStrip status="ready" scope="personal" roleView="user" onScopeChange={() => undefined}
      kpis={overallKpis} personalKpis={{ contributionCount: 0, workflowCount: 0, openItemCount: 0,
        pendingTodoCount: 0, highRiskTouchCount: 2 }} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText("0")).toHaveLength(4);
    expect(screen.queryByText("当前时间窗口暂无个人活动")).not.toBeInTheDocument();
  });

  it("renders KPIs when ready", () => {
    render(
      <SituationStrip
        status="ready"
        kpis={overallKpis}
        personalKpis={personalKpis}
        scope="overall"
        roleView="user"
        onScopeChange={() => undefined}
      />
    );
    expect(screen.getByText("51")).toBeInTheDocument();
    expect(screen.getByText("不可用")).toBeInTheDocument();
  });

  it("shows personal empty message when personal KPIs are all zero", () => {
    render(
      <SituationStrip
        status="ready"
        kpis={overallKpis}
        personalKpis={{
          contributionCount: 0,
          workflowCount: 0,
          openItemCount: 0,
          pendingTodoCount: 0,
          highRiskTouchCount: null,
          riskAvailability: "unavailable"
        }}
        scope="personal"
        roleView="guest"
        onScopeChange={() => undefined}
      />
    );

    expect(screen.getByText("当前时间窗口暂无个人活动（访客只读视角）")).toBeInTheDocument();
  });

  it("shows skeleton while loading", () => {
    render(
      <SituationStrip
        status="loading"
        kpis={null}
        personalKpis={null}
        scope="overall"
        roleView="user"
        onScopeChange={() => undefined}
      />
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
