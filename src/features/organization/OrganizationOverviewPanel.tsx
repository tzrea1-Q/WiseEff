import { useEffect, useState } from "react";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { OverviewPage } from "@/components/layout/OverviewPage";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";
import { withOrganizationScope } from "@/infrastructure/http/organizationScope";
import type { OrganizationWorkspaceSummary } from "@/infrastructure/http/userGovernanceClient";

export function OrganizationOverviewPanel({ load, onNavigate, organizationId }: {
  load?: () => Promise<OrganizationWorkspaceSummary>; onNavigate: (path: string) => void; organizationId?: string;
}) {
  const [summary, setSummary] = useState<OrganizationWorkspaceSummary | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSummary(null); setError("");
    void load?.().then(next => { if (!cancelled) setSummary(next); }).catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载组织概览，请重试。")); });
    return () => { cancelled = true; };
  }, [load, attempt]);
  if (!load) return <SectionEmpty message="组织概览需要连接真实 API。" />;
  if (error) return <SectionError message={error} onRetry={() => setAttempt(value => value + 1)} />;
  if (!summary) return <SectionSkeleton label="正在加载组织概览" />;
  const go = (path: string) => onNavigate(withOrganizationScope(path, organizationId));
  const admin = summary.administration;
  return <OverviewPage label="组织概览" summary={<div><h2>{summary.organization.name}</h2><p>{summary.organization.status === "suspended" ? "组织已停用，业务数据仅可查看。" : "组织正常运行"}</p></div>}>
    <div className="organization-overview__metrics" aria-label="组织统计">
      {([ ["成员", summary.counts.members, "/organization/members"], ["团队", summary.counts.teams, "/organization/teams"], ["项目", summary.counts.projects, admin ? "/organization/projects" : "/parameters"] ] as const).map(([label, count, path]) =>
        admin || label === "项目" ? <button key={label} className="organization-overview__metric" type="button" onClick={() => go(path)} aria-label={`${label} ${count}`}><span>{label}</span><strong>{count}</strong><span>查看列表</span></button>
          : <div key={label} className="organization-overview__metric"><span>{label}</span><strong>{count}</strong><span>由组织管理员管理</span></div>)}
    </div>
    {admin ? <section className="organization-overview__pending" aria-label="组织待办"><h3>待办</h3><div className="organization-operating-scope__actions">
      {admin.pendingInvitations !== null ? <Button variant="outline" onClick={() => go("/organization/invitations")}>待接受邀请 {admin.pendingInvitations}</Button> : null}
      <Button variant="outline" onClick={() => go("/organization/handovers")}>待交接事项 {admin.pendingHandovers}</Button>
      <Button variant="outline" onClick={() => go("/organization/members")}>待同步身份 {admin.pendingIdentitySync}</Button>
    </div></section> : <p>你可以查看本组织的项目和业务资源。成员、团队和项目权限由组织管理员维护。</p>}
  </OverviewPage>;
}

export function OrganizationResourcesPanel({ administrator, roleId, organizationId, onNavigate }: {
  administrator: boolean; roleId: string; organizationId?: string; onNavigate: (path: string) => void;
}) {
  const resources = [
    { title: "参数资源", detail: administrator ? "组织规范登记、模块归属与项目配置" : "查看组织内项目与参数配置", path: administrator ? "/parameter-admin" : "/parameters" },
    { title: "知识库", detail: "查阅组织已发布的工程知识", path: "/knowledge" },
    ...(roleId !== "guest" ? [{ title: "日志分析", detail: "查看日志与分析结果", path: "/logs" }] : []),
    ...(administrator ? [{ title: "设备代理", detail: "管理组织成员的配对与连接", path: "/organization/bridges" }, { title: "集成凭据", detail: "查看组织机器凭据与技能绑定", path: "/organization/integrations" }] : [])
  ];
  return <OverviewPage label="组织资源" summary={<p>进入现有业务控制台查看和管理当前组织的资源。</p>}>
    <div className="organization-resources__grid">{resources.map(resource => <button key={resource.title} type="button" aria-label={resource.title} className="organization-resources__link" onClick={() => onNavigate(withOrganizationScope(resource.path, organizationId))}><strong>{resource.title}</strong><span>{resource.detail}</span><span>进入控制台</span></button>)}</div>
    {!administrator ? <p>设备配对和集成凭据由组织管理员管理。</p> : null}
  </OverviewPage>;
}
