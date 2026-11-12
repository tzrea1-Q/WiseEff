import { canAccessParameterReviewPage } from "@/app/permissions";
import type { PageProps } from "@/app/routes";
import { ViewSwitch } from "@/components/ui/view-switch";
import { migrateLegacyRoleId, pickPrimaryPlatformRoleId } from "@/domain/users/types";
import { getContextQuery } from "@/workbenchUi";
import { useCallback, useMemo, useState } from "react";
import { ParameterReviewPage } from "./ParameterReviewPage";
import { ParameterSubmissionsPage } from "./ParameterSubmissionsPage";

export function ParameterChangesPage(props: PageProps) {
  const { state, search, runtimeMode, sessionRoles, projectMemberships, onNavigate } = props;
  const projectId = getContextQuery(search).projectId || state.activeProjectId;
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const projectRoles = useMemo(() => sessionRoles?.filter((role) => role.projectId === null || role.projectId === projectId) ?? [], [sessionRoles, projectId]);
  const canReview = runtimeMode === "api"
    ? Boolean(currentUser?.isActive && projectRoles.some((role) => canAccessParameterReviewPage(role.roleId)
      && (!props.sessionPermissions || props.sessionPermissions.includes("parameter:review")
        || (migrateLegacyRoleId(role.roleId) === "software-user" && props.sessionPermissions.includes("parameter:edit")))))
    : canAccessParameterReviewPage(state.activeRoleId);
  const requestedScope = new URLSearchParams(search).get("scope");
  const scope = canReview && requestedScope !== "mine" ? "review" : "mine";
  const scopeKey = JSON.stringify([scope, projectId, state.currentUserId, state.activeRoleId, currentUser?.isActive,
    currentUser?.roles, sessionRoles, projectMemberships, props.sessionPermissions]);
  const [busyState, setBusyState] = useState({ scopeKey, busy: false });
  const busy = busyState.scopeKey === scopeKey && busyState.busy;
  const onBusyChange = useCallback((next: boolean) => setBusyState((current) =>
    current.scopeKey === scopeKey && current.busy === next ? current : { scopeKey, busy: next }), [scopeKey]);
  const reviewState = useMemo(() => runtimeMode === "api" ? { ...state,
    activeRoleId: pickPrimaryPlatformRoleId(projectRoles.map((role) => role.roleId).filter(canAccessParameterReviewPage)),
    users: state.users.map((user) => user.id === state.currentUserId ? { ...user,
      roles: (sessionRoles ?? []).map((role) => ({ ...role, roleId: migrateLegacyRoleId(role.roleId) })) } : user)
  } : state, [runtimeMode, state, projectRoles, sessionRoles]);

  if (!state.configDraft.projects.some((project) => project.id === projectId)) {
    return <div className="review-state"><p role="alert">项目链接无效，未加载其他项目的变更。</p></div>;
  }

  return <div className="parameter-changes-page">
    {canReview ? <ViewSwitch variant="toggle" ariaLabel="变更中心视图" value={scope} onValueChange={(value) => {
      const params = new URLSearchParams(window.location.search);
      params.set("scope", value);
      params.delete("request"); params.delete("legacyRequest"); params.delete("memberRequest");
      onNavigate(`/parameter-changes?${params.toString()}`);
    }} items={[{ value: "mine", label: "我的提交", disabled: busy }, { value: "review", label: "审阅队列", disabled: busy }]} /> : null}
    {scope === "review" ? <ParameterReviewPage key={scopeKey} {...props} state={reviewState} onBusyChange={onBusyChange} scopeToProject />
      : <ParameterSubmissionsPage key={scopeKey} {...props} onBusyChange={onBusyChange} />}
  </div>;
}
