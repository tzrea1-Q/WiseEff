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
  it.each(["idle", "loading", "error", "ready", "empty"] as const)(
    "only shows retained zero personal KPIs as empty when the summary is available (%s)",
    (status) => {
      render(
        <SituationStrip
          status={status}
          kpis={overallKpis}
          personalKpis={{ ...personalKpis, contributionCount: 0, workflowCount: 0, openItemCount: 0, pendingTodoCount: 0 }}
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
      expect(screen.queryAllByText("0")).toHaveLength(status === "ready" ? 4 : 0);
    }
  );

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
