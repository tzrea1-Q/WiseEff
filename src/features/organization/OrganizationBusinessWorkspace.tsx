import { useEffect, useState, type ReactNode } from "react";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import type { OrganizationWorkspaceClient } from "@/infrastructure/http/userGovernanceClient";
import { presentError } from "@/infrastructure/http/presentError";

type Scope = Awaited<ReturnType<OrganizationWorkspaceClient["enterOperatingContext"]>>;
type Props = { actorId: string; organizationId?: string; homeSuspended?: boolean; homePath: string; workspaceClient?: OrganizationWorkspaceClient;
  initialScope?: Scope; onScopeResolved?: (scope: Scope) => void; onScopeError?: (failed: boolean) => void;
  onNavigate: (path: string) => void; children: ReactNode; proactiveInsights?: ReactNode };

/** The App's approved route owns the workspace, including while Back/Forward awaits a leave decision. */
export function OrganizationBusinessWorkspace(props: Props) {
  if (props.organizationId === undefined) return props.homeSuspended ? <div><p role="status">当前工作区仅可查看，请联系管理员。新业务、排队任务、回调和设备操作已暂停。</p>{props.children}</div> : <>{props.proactiveInsights}{props.children}</>;
  const initialScope = props.initialScope?.actor.user.id === props.actorId && props.initialScope.organization.id === props.organizationId ? props.initialScope : undefined;
  return <ResolvedWorkspace key={`${props.actorId}:${props.organizationId}`} {...props} organizationId={props.organizationId} initialScope={initialScope} />;
}

function ResolvedWorkspace({ actorId, organizationId, homePath, workspaceClient, children, onNavigate, proactiveInsights, initialScope, onScopeResolved, onScopeError }: Props & { organizationId: string }) {
  const [scope, setScope] = useState<Scope | null>(initialScope ?? null);
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (initialScope) return;
    setError("");
    onScopeError?.(false);
    if (!workspaceClient) { setError("当前连接不支持此工作区。"); onScopeError?.(true); return; }
    void workspaceClient.enterOperatingContext(organizationId).then((value) => {
      if (cancelled) return;
      if (value.actor.user.id !== actorId || value.organization.id !== organizationId) { setError("无法确认该工作区，请重试。"); onScopeError?.(true); return; }
      setScope(value); onScopeResolved?.(value);
    })
      .catch((failure: unknown) => { if (!cancelled) { setError(presentError(failure, "无法进入该工作区。")); onScopeError?.(true); } });
    return () => { cancelled = true; };
  }, [workspaceClient, actorId, organizationId, attempt, initialScope, onScopeResolved, onScopeError]);
  if (error) return <SectionError message={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!scope) return <SectionSkeleton label="正在进入工作区" />;
  const platform = scope.actor.roles.some(role => role.projectId === null && role.roleId === "platform-admin");
  const administrator = platform || scope.actor.permissions.includes("users:manage") && scope.actor.roles.some(role => role.projectId === null && role.roleId === "admin");
  return <div className="min-w-0">
    {administrator ? <section className="organization-operating-scope" aria-label="当前操作组织">
      <div><span className="organization-operating-scope__label">当前操作组织</span><strong>{scope.organization.name}</strong><code>{scope.organization.id}</code>
        {scope.organization.id !== scope.actor.organization.id ? <span>所属组织：{scope.actor.organization.name}</span> : null}</div>
      {platform ? <div className="organization-operating-scope__actions"><Button variant="outline" onClick={() => onNavigate("/platform/organizations")}>组织目录</Button>
        {organizationId !== undefined ? <Button variant="outline" onClick={() => onNavigate(homePath)}>返回所属组织</Button> : null}</div> : null}
    </section> : null}
    {scope.organization.status === "suspended" ? <p role="status">{administrator ? "组织已停用，业务数据仅可查看。新业务、排队任务、回调和设备操作已暂停，请联系平台管理员恢复组织。" : "当前工作区仅可查看，请联系管理员。新业务、排队任务、回调和设备操作已暂停。"}</p> : null}
    {scope.organization.status !== "suspended" ? proactiveInsights : null}
    {children}
  </div>;
}
