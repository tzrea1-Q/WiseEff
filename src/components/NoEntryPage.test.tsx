import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoEntryPage } from "./NoEntryPage";

describe("NoEntryPage", () => {
  it("renders an accessible no-entry state and navigates through the configured action", () => {
    const onNavigate = vi.fn();

    render(
      <NoEntryPage
        title="Route retired"
        description="This workspace has moved into the parameter table."
        actionLabel="Back to parameters"
        actionPath="/parameters"
        onNavigate={onNavigate}
      />
    );

    const region = screen.getByRole("region", { name: "Route retired" });

    expect(region).toHaveClass("no-entry-page");
    expect(screen.getByRole("heading", { name: "Route retired" })).toBeInTheDocument();
    expect(screen.getByText("This workspace has moved into the parameter table.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to parameters" }));

    expect(onNavigate).toHaveBeenCalledWith("/parameters");
  });
});
