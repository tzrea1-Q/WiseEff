import type { Dispatch, ReactNode } from "react";

import type { AppAction } from "@/App";
import { canAccessPage, canPerform, getAccessibleFallbackPath, getRequiredRoleForPage, getRequiredRoleLabel } from "@/app/permissions";
import { DebuggingPage } from "@/DebuggingPage";
import { migrateLegacyRoleId } from "@/domain/users/types";
import { LogAdminPage } from "@/LogAdminPage";
import { NodeDebuggingPage } from "@/NodeDebuggingPage";
import { ParameterAdminPage } from "@/ParameterAdminPage";
import { ParameterManagementHomePage } from "@/ParameterManagementHomePage";
import { ParametersPage as UserParametersPage } from "@/ParametersPage";
import { UserPermissionsPage } from "@/UserPermissionsPage";
import { NoEntryPage } from "@/components/NoEntryPage";
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
  HomePage: () => ReactNode;
  ParameterSubmissionsPage: (props: PageProps) => ReactNode;
  ParameterReviewPage: (props: PageProps) => ReactNode;
  onNewProject?: () => void;
  TopBarProjectId?: string;
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
  HomePage,
  ParameterSubmissionsPage,
  ParameterReviewPage,
  onNewProject,
  TopBarProjectId,
  LogDashboardPage,
  LogsPage,
  DebuggingAdminPage
}: PageRouterProps) {
  const currentRoleId = migrateLegacyRoleId(state.activeRoleId);
  const searchProjectId = new URLSearchParams(search).get("project") ?? "";
  const effectiveParametersProjectId = searchProjectId || state.activeProjectId;
  const activeProjectInitializationStatus =
    state.projectInitializationStatuses[effectiveParametersProjectId] ?? "initialized";
  const canEditParameters =
    canPerform(currentRoleId, "parameter.edit") && activeProjectInitializationStatus === "initialized";

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
          effectiveProjectId={effectiveParametersProjectId}
          canEdit={canEditParameters}
          initializationStatus={activeProjectInitializationStatus}
          topBarProjectId={TopBarProjectId ?? effectiveParametersProjectId}
        />
      );
    case "parameter-submissions":
      return <ParameterSubmissionsPage state={state} dispatch={dispatch} onNavigate={onNavigate} search={search} />;
    case "parameter-home":
      return (
        <ParameterManagementHomePage
          state={state}
          onNavigate={onNavigate}
          onNewProject={onNewProject}
          timeWindow={parameterHomeTimeWindow}
        />
      );
    case "parameter-comparison":
      return (
        <NoEntryPage
          title="页面不可用"
          description="独立参数对比页面已下线，请回到参数工作台通过参数行的查看按钮查看跨项目对比。"
          actionLabel="参数工作台"
          actionPath="/parameters"
          onNavigate={onNavigate}
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
