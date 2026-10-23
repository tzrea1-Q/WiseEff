import { useEffect, useState, type ReactNode } from "react";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import type { OrganizationWorkspaceClient } from "@/infrastructure/http/userGovernanceClient";
import { presentError } from "@/infrastructure/http/presentError";

type Props = { actorId: string; organizationId?: string; homeSuspended?: boolean; homePath: string; workspaceClient?: OrganizationWorkspaceClient;
  onNavigate: (path: string) => void; children: ReactNode; proactiveInsights?: ReactNode };

/** The App's approved route owns the workspace, including while Back/Forward awaits a leave decision. */
export function OrganizationBusinessWorkspace(props: Props) {
  if (props.organizationId === undefined) return props.homeSuspended ? <div><p role="status">组织已停用，业务数据仅可查看。新业务、排队任务、回调和设备操作已暂停，请联系平台管理员恢复组织。</p>{props.children}</div> : <>{props.proactiveInsights}{props.children}</>;
  return <ResolvedWorkspace key={`${props.actorId}:${props.organizationId}`} {...props} organizationId={props.organizationId} />;
}

function ResolvedWorkspace({ organizationId, homePath, workspaceClient, children, onNavigate, proactiveInsights }: Props & { organizationId: string }) {
  const [scope, setScope] = useState<Awaited<ReturnType<OrganizationWorkspaceClient["enterOperatingContext"]>> | null>(null);
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    if (!workspaceClient) { setError("当前连接不支持选择组织。"); return; }
    void workspaceClient.enterOperatingContext(organizationId).then((value) => { if (!cancelled) setScope(value); })
      .catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法进入该组织工作区。")); });
    return () => { cancelled = true; };
  }, [workspaceClient, organizationId, attempt]);
  if (error) return <SectionError message={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!scope) return <SectionSkeleton label="正在进入组织工作区" />;
  return <div className="min-w-0">
    <section className="organization-operating-scope" aria-label="当前操作组织">
      <div><span className="organization-operating-scope__label">当前操作组织</span><strong>{scope.organization.name}</strong><code>{scope.organization.id}</code>
        {scope.organization.id !== scope.actor.organization.id ? <span>所属组织：{scope.actor.organization.name}</span> : null}</div>
      {scope.actor.roles.some(role => role.projectId === null && role.roleId === "platform-admin") ? <div className="organization-operating-scope__actions"><Button variant="outline" onClick={() => onNavigate("/platform/organizations")}>组织目录</Button>
        {organizationId !== undefined ? <Button variant="outline" onClick={() => onNavigate(homePath)}>返回所属组织</Button> : null}</div> : null}
    </section>
    {scope.organization.status === "suspended" ? <p role="status">组织已停用，业务数据仅可查看。新业务、排队任务、回调和设备操作已暂停，请联系平台管理员恢复组织。</p> : null}
    {scope.organization.status !== "suspended" ? proactiveInsights : null}
    {children}
  </div>;
}
