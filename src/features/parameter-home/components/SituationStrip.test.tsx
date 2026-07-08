import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SituationStrip } from "./SituationStrip";

const overallKpis = {
  totalParameters: 51,
  managedProjects: 3,
  changeFrequency: 19,
  activeContributors: 5,
  highRiskParameters: 12
};

const personalKpis = {
  contributionCount: 4,
  workflowCount: 2,
  openItemCount: 1,
  pendingTodoCount: 3,
  highRiskTouchCount: 1
};

describe("SituationStrip", () => {
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
    expect(screen.getByText("12")).toBeInTheDocument();
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
          highRiskTouchCount: 0
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
