import { useEffect, useState } from "react";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { OverviewPage } from "@/components/layout/OverviewPage";
import { Button } from "@/components/ui/button";
import { presentError } from "@/infrastructure/http/presentError";
import { withOrganizationScope } from "@/infrastructure/http/organizationScope";
import type { OrganizationWorkspaceSummary } from "@/infrastructure/http/userGovernanceClient";
import { isWorkflowVisible, VISIBLE_WORKFLOWS, type WorkflowId } from "@/domain/workflowDiscovery";
import type { WorkflowPublicationView } from "@/application/workflow-publication/useWorkflowPublication";
import { WorkflowPublicationNotice } from "@/components/layout/WorkflowPublicationNotice";

export function OrganizationOverviewPanel({ load, onNavigate, organizationId, visibleWorkflows = VISIBLE_WORKFLOWS }: {
  load?: () => Promise<OrganizationWorkspaceSummary>; onNavigate: (path: string) => void; organizationId?: string;
  visibleWorkflows?: readonly WorkflowId[];
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
  const pending = admin ? [
    { label: "待接受邀请", count: admin.pendingInvitations ?? 0, path: "/organization/invitations?status=pending" },
    { label: "待交接事项", count: admin.pendingHandovers, path: "/organization/handovers" },
    { label: "待同步身份", count: admin.pendingIdentitySync, path: "/organization/members?identity=pending" }
  ].filter(item => item.count > 0) : [];
  return <OverviewPage label={`${summary.organization.name}概览`} quickActions={admin ? <section className="organization-overview__pending" aria-label="组织待办"><h3>待办</h3>
    {pending.length ? <div className="organization-operating-scope__actions">{pending.map(item => <Button key={item.label} variant="outline" onClick={() => go(item.path)}>{item.label} {item.count}</Button>)}</div> : <p>暂无待处理事项</p>}
  </section> : undefined}>
    <div className="organization-overview__metrics" aria-label="组织统计">
      {([ ["成员", summary.counts.members, "/organization/members"], ["团队", summary.counts.teams, "/organization/teams"], ["项目", summary.counts.projects, admin ? "/organization/projects" : "/parameters"] ] as const).map(([label, count, path]) =>
        admin || (label === "项目" && isWorkflowVisible("parameter-management", visibleWorkflows)) ? <button key={label} className="organization-overview__metric" type="button" onClick={() => go(path)} aria-label={`${label} ${count}`}><span>{label}</span><strong>{count}</strong></button>
          : <div key={label} className="organization-overview__metric"><span>{label}</span><strong>{count}</strong></div>)}
    </div>
  </OverviewPage>;
}

export function OrganizationResourcesPanel({ administrator, roleId, organizationId, onNavigate, visibleWorkflows = VISIBLE_WORKFLOWS, publication }: {
  administrator: boolean; roleId: string; organizationId?: string; onNavigate: (path: string) => void;
  visibleWorkflows?: readonly WorkflowId[];
  publication?: WorkflowPublicationView;
}) {
  if (!administrator && publication && publication.status !== "ready") return <WorkflowPublicationNotice status={publication.status} onRetry={publication.retry} />;
  const resources = [
    ...(!administrator && isWorkflowVisible("parameter-management", visibleWorkflows) ? [{ title: "参数资源", detail: "查看组织内项目与参数配置", path: "/parameters" }] : []),
    ...(!administrator && isWorkflowVisible("knowledge", visibleWorkflows) ? [{ title: "知识库", detail: "查阅组织已发布的工程知识", path: "/knowledge" }] : []),
    ...(!administrator && roleId !== "guest" && isWorkflowVisible("log-analysis", visibleWorkflows) ? [{ title: "日志分析", detail: "查看日志与分析结果", path: "/logs" }] : []),
    ...(administrator ? [{ title: "设备代理", detail: "管理组织成员的配对与连接", path: "/organization/bridges" }, { title: "集成凭据", detail: "查看组织机器凭据与技能绑定", path: "/organization/integrations" }] : [])
  ];
  return <OverviewPage label="组织资源">
    <div className="organization-resources__grid">{resources.map(resource => <button key={resource.title} type="button" aria-label={resource.title} className="organization-resources__link" onClick={() => onNavigate(withOrganizationScope(resource.path, organizationId))}><strong>{resource.title}</strong><span>{resource.detail}</span></button>)}</div>
    {!resources.length ? <SectionEmpty message="当前暂无可访问的组织资源。" /> : null}
  </OverviewPage>;
}
