import type { Dispatch, ReactNode, SetStateAction } from "react";

import type { AppAction } from "@/App";
import { canAccessPage, canPerform, getAccessibleFallbackPath, getRequiredRoleForPage, getRequiredRoleLabel } from "@/app/permissions";
import { DebuggingPage } from "@/DebuggingPage";
import { migrateLegacyRoleId } from "@/domain/users/types";
import { LogAdminPage } from "@/LogAdminPage";
import { NodeDebuggingPage } from "@/NodeDebuggingPage";
import { ParameterAdminPage } from "@/ParameterAdminPage";
import { ParameterComparisonPage } from "@/ParameterComparison";
import type { ComparisonProjectSelection } from "@/ParameterComparison/types";
import { ParameterManagementHomePage } from "@/ParameterManagementHomePage";
import { ParametersPage as UserParametersPage } from "@/ParametersPage";
import { UserPermissionsPage } from "@/UserPermissionsPage";
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
  const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
  if (!canAccessPage(currentRoleId, page.key)) {
    const requiredRole = getRequiredRoleForPage(page.key);
    return (
      <section className="permission-denied-page" aria-label="Permission denied">
        <span className="eyebrow">Access control</span>
        <h2>Permission denied</h2>
        <p>Current role: {getRequiredRoleLabel(currentRoleId)}</p>
        <p>Required role: {getRequiredRoleLabel(requiredRole)}</p>
        <button className="button primary" type="button" onClick={() => onNavigate(getAccessibleFallbackPath(currentRoleId))}>
          Back to accessible workspace
        </button>
      </section>
    );
  }

  switch (page.key) {
    case "parameters":
      return (
        <UserParametersPage
          state={state}
          dispatch={dispatch}
          onNavigate={onNavigate}
          search={search}
          canEdit={canPerform(currentRoleId, "parameter.edit")}
        />
      );
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
    case "user-permissions":
      return <UserPermissionsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    default:
      return <HomePage />;
  }
}
