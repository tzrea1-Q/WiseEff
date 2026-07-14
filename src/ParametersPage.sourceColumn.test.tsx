import { render, screen } from "@testing-library/react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ParametersPage } from "./ParametersPage";
import { TopBarActionsContext } from "./components/layout";
import { initialState } from "./mockData";

function TopBarActionsHarness({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);
  const setStableActions = useCallback((nextActions: ReactNode | null | ((current: ReactNode | null) => ReactNode | null)) => {
    setActions(nextActions);
  }, []);
  const contextValue = useMemo(() => ({ setActions: setStableActions }), [setStableActions]);

  return (
    <TopBarActionsContext.Provider value={contextValue}>
      <header className="topbar">
        <div className="topbar-page-actions" role="toolbar" aria-label="参数来源列测试">
          {actions}
        </div>
      </header>
      {children}
    </TopBarActionsContext.Provider>
  );
}

describe("ParametersPage source column", () => {
  it("shows file source path or manual fallback", () => {
    const sourceState = {
      ...initialState,
      parameters: initialState.parameters.map((parameter, index) =>
        index === 0
          ? {
              ...parameter,
              sourceFileName: "charger_policy.dts",
              sourceNodePath: "/power/charging/fast_charge_current_limit_ma"
            }
          : parameter
      )
    };

    render(
      <TopBarActionsHarness>
        <ParametersPage
          state={sourceState}
          dispatch={vi.fn()}
          onNavigate={vi.fn()}
          search=""
        />
      </TopBarActionsHarness>
    );

    expect(screen.getByRole("columnheader", { name: "来源" })).toBeInTheDocument();
    expect(screen.getByText("charger_policy.dts → /power/charging/fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.getAllByText("手动").length).toBeGreaterThan(0);
  });
});
