import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { TopBarActionsContext } from "../../components/layout";
import { initialState, projects } from "../../mockData";
import { ParameterComparisonPage } from "..";

function TopBarActionsHarness({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);
  const setStableActions = useCallback((nextActions: ReactNode | null | ((current: ReactNode | null) => ReactNode | null)) => {
    setActions(nextActions);
  }, []);
  const contextValue = useMemo(() => ({ setActions: setStableActions }), [setStableActions]);

  return (
    <TopBarActionsContext.Provider value={contextValue}>
      <header className="topbar">
        <div className="topbar-page-actions" role="toolbar" aria-label="参数对比页面操作">
          {actions}
        </div>
      </header>
      {children}
    </TopBarActionsContext.Provider>
  );
}

function renderPage(onComparisonSelectionChange = () => undefined) {
  return render(
    <TopBarActionsHarness>
      <ParameterComparisonPage
        state={initialState}
        onNavigate={() => undefined}
        search=""
        comparisonSelection={{
          baseProjectId: projects[0].id,
          targetProjectId: projects[1].id
        }}
        onComparisonSelectionChange={onComparisonSelectionChange}
      />
    </TopBarActionsHarness>
  );
}

describe("ParameterComparisonPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("mounts the integrated v2 comparison page", () => {
    renderPage();

    expect(screen.getByTestId("comparison-page-v2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(`基准项目 ${projects[0].code}`) })).toBeInTheDocument();
    expect(screen.getByText("差异参数")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索参数键、模块或含义")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: `${projects[1].code} / Δ` })).toBeInTheDocument();
  });

  it("swaps selected projects through the header action", () => {
    const onComparisonSelectionChange = vi.fn();
    renderPage(onComparisonSelectionChange);

    fireEvent.click(screen.getByRole("button", { name: "交换基准和对比项目" }));

    expect(onComparisonSelectionChange).toHaveBeenCalledWith(expect.any(Function));
  });
});
