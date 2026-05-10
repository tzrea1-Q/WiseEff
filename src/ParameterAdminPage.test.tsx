import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ParameterAdminPage } from "./ParameterAdminPage";
import { initialState } from "./mockData";

function renderPage(search = "") {
  return render(
    <ParameterAdminPage
      state={initialState}
      dispatch={vi.fn()}
      onNavigate={vi.fn()}
      search={search}
    />
  );
}

describe("ParameterAdminPage", () => {
  it("renders the page heading", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: /项目参数管理后台/ })).toBeInTheDocument();
  });

  it("renders at least one parameter list item", () => {
    renderPage();

    expect(screen.getAllByRole("button", { name: /fast_charge|charge_voltage|battery/ }).length).toBeGreaterThan(0);
  });
});
