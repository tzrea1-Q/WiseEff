import type { AuthContext } from "../auth/types";
import { canMergeParameters, canReviewParameterStage } from "../parameter-kernel/policy";
import { parameterChangeRequestStatuses } from "../parameter-kernel/workflowStatus";

export function legacyRequestAccessSql(auth: AuthContext, values: unknown[], alias: string, includeOwner = true) {
  if (!auth.user.isActive) return "false";
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const organizationWide = auth.roles.some((role) =>
    role.projectId === null || role.roleId === "admin" || role.roleId === "platform-admin"
  );
  const projectIds = [...new Set(auth.roles.flatMap((role) => role.projectId ? [role.projectId] : []))];
  const projectAccess = organizationWide ? "true" : `${alias}.project_id = any(${bind(projectIds)}::text[])`;
  const owner = includeOwner ? [`${alias}.submitter_user_id = ${bind(auth.user.id)}`] : [];
  const reviewProjects = auth.roles.some((role) => role.roleId === "admin") ? [...projectIds, undefined] : projectIds;
  const reviewer = reviewProjects.flatMap((projectId) => {
    const statuses = parameterChangeRequestStatuses.filter((status) =>
      projectId === undefined || canReviewParameterStage(auth, projectId, status)
      || (status === "software_merge" && canMergeParameters(auth, projectId))
    );
    if (!statuses.length) return [];
    const nodeAssignment = auth.roles.some((role) => role.roleId === "admin") ? "true"
      : `(${alias}.edit_subject_kind <> 'node-enablement' or ${alias}.assigned_to_user_id = ${bind(auth.user.id)})`;
    const stages = bind(statuses);
    const project = projectId === undefined ? "true" : `${alias}.project_id = ${bind(projectId)}`;
    return [`(${project} and ((${alias}.status = any(${stages}::text[]) and ${nodeAssignment})
      or (${alias}.status in ('merged', 'rejected') and exists (
        select 1 from parameter_review_decisions history
        where history.organization_id = ${alias}.organization_id
          and history.request_id = ${alias}.id
          and history.from_status = any(${stages}::text[])
      ))))`];
  });
  return `(${projectAccess} and (${[...owner, ...reviewer].join(" or ") || "false"}))`;
}
