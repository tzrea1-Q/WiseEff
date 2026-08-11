import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DtsReloadCandidateMeaning } from "@/features/dts-reload/DtsReloadCandidateMeaning";

describe("DtsReloadCandidateMeaning", () => {
  it("renders the meaning body when documentation is present", () => {
    render(<DtsReloadCandidateMeaning meaning="Controls charge temperature limit." />);
    expect(screen.getByRole("heading", { name: "参数含义" })).toBeInTheDocument();
    expect(screen.getByText("Controls charge temperature limit.")).toBeInTheDocument();
    expect(screen.queryByText("暂无参数含义说明。")).not.toBeInTheDocument();
  });

  it("shows an empty state when meaning is missing", () => {
    render(<DtsReloadCandidateMeaning meaning="   " />);
    expect(screen.getByRole("heading", { name: "参数含义" })).toBeInTheDocument();
    expect(screen.getByText("暂无参数含义说明。")).toBeInTheDocument();
  });
});
