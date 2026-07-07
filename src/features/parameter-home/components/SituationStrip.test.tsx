import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SituationStrip } from "./SituationStrip";

describe("SituationStrip", () => {
  it("renders KPIs when ready", () => {
    render(
      <SituationStrip
        status="ready"
        kpis={{
          totalParameters: 51,
          managedProjects: 3,
          changeFrequency: 19,
          activeContributors: 5,
          highRiskParameters: 12
        }}
      />
    );
    expect(screen.getByText("51")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows skeleton while loading", () => {
    render(<SituationStrip status="loading" kpis={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
