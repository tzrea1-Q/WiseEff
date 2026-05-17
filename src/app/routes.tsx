import type { Dispatch, ReactNode, SetStateAction } from "react";

import type { AppAction } from "@/App";
import { DebuggingPage } from "@/DebuggingPage";
import { LogAdminPage } from "@/LogAdminPage";
import { NodeDebuggingPage } from "@/NodeDebuggingPage";
import { ParameterAdminPage } from "@/ParameterAdminPage";
import { ParameterComparisonPage } from "@/ParameterComparison";
import type { ComparisonProjectSelection } from "@/ParameterComparison/types";
import { ParameterManagementHomePage } from "@/ParameterManagementHomePage";
import { ParametersPage as UserParametersPage } from "@/ParametersPage";
import type { PageConfig } from "@/appConfig";
import type { PrototypeState } from "@/mockData";
import type { HomepageTimeWindow } from "@/parameterHomepageAnalytics";

export type PageProps = {
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  search: string;
  parameterHomeTimeWindow?: HomepageTimeWindow;
};

export type PageRouterProps = PageProps & {
  page: PageConfig;
  comparisonSelection: ComparisonProjectSelection;
  onComparisonSelectionChange: Dispatch<SetStateAction<ComparisonProjectSelection>>;
  onSearchChange: (search: string) => void;
  HomePage: () => ReactNode;
  ParameterSubmissionsPage: (props: PageProps) => ReactNode;
  ParameterReviewPage: (props: PageProps) => ReactNode;
  LogDashboardPage: (props: { state: PrototypeState; onNavigate: (path: string) => void }) => ReactNode;
  LogsPage: (props: PageProps) => ReactNode;
  DebuggingAdminPage: (props: PageProps) => ReactNode;
};

export function PageRouter({
  page,
  state,
  dispatch,
  onNavigate,
  search,
  parameterHomeTimeWindow,
  comparisonSelection,
  onComparisonSelectionChange,
  onSearchChange,
  HomePage,
  ParameterSubmissionsPage,
  ParameterReviewPage,
  LogDashboardPage,
  LogsPage,
  DebuggingAdminPage
}: PageRouterProps) {
  switch (page.key) {
    case "parameters":
      return <UserParametersPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "parameter-submissions":
      return <ParameterSubmissionsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "parameter-home":
      return <ParameterManagementHomePage state={state} onNavigate={onNavigate} timeWindow={parameterHomeTimeWindow} />;
    case "parameter-comparison":
      return (
        <ParameterComparisonPage
          state={state}
          onNavigate={onNavigate}
          search={search}
          comparisonSelection={comparisonSelection}
          onComparisonSelectionChange={onComparisonSelectionChange}
          onSearchChange={onSearchChange}
        />
      );
    case "parameter-review":
      return <ParameterReviewPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "parameter-admin":
      return <ParameterAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "log-dashboard":
      return <LogDashboardPage state={state} onNavigate={onNavigate} />;
    case "logs":
      return <LogsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "log-admin":
      return <LogAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "debugging":
      return <DebuggingPage state={state} dispatch={dispatch} />;
    case "node-debugging":
      return <NodeDebuggingPage state={state} />;
    case "debugging-admin":
      return <DebuggingAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    default:
      return <HomePage />;
  }
}
