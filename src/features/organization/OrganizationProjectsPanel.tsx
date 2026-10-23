import { useEffect, useState, type ReactNode } from "react";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SelectControl } from "@/components/common/SelectControl";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Badge } from "@/components/ui/badge";
import { roleLabels } from "@/UserPermissionsPage";
import { presentError } from "@/infrastructure/http/presentError";
import type { createUserGovernanceClient, ProjectMember } from "@/infrastructure/http/userGovernanceClient";

export type ProjectMembershipClient = Pick<ReturnType<typeof createUserGovernanceClient>, "listProjectCandidates" | "getProjectMembers">;

export function OrganizationProjectsPanel({ client }: { client?: ProjectMembershipClient }) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setProjects(null); setError("");
    void client.listProjectCandidates().then((next) => {
      if (cancelled) return;
      setProjects(next); setSelectedId((id) => next.some((project) => project.id === id) ? id : next[0]?.id ?? "");
    }).catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载组织项目，请重试。")); });
    return () => { cancelled = true; };
  }, [client, attempt]);

  if (!client) return <SectionEmpty message="项目参与名单需要连接真实 API。" />;
  if (error) return <SectionError message={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!projects) return <SectionSkeleton label="正在加载组织项目" />;
  if (!projects.length) return <SectionEmpty title="暂无项目" message="创建项目后可在此查看参与名单。" />;
  return <ProjectRoster key={selectedId} client={client} projectId={selectedId} projectSelector={
    <SelectControl ariaLabel="选择项目" value={selectedId} options={projects.map((project) => ({ value: project.id, label: project.name }))} onValueChange={setSelectedId} />
  } />;
}

function ProjectRoster({ client, projectId, projectSelector }: { client: ProjectMembershipClient; projectId: string; projectSelector: ReactNode }) {
  const [members, setMembers] = useState<ProjectMember[] | null>(null), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setMembers(null); setError("");
    void client.getProjectMembers(projectId).then((next) => { if (!cancelled) setMembers(next.members); })
      .catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载项目参与名单，请重试。")); });
    return () => { cancelled = true; };
  }, [client, projectId, attempt]);
  return <AdminListPage label="项目参与" headerActions={null} headerContent="项目参与名单" filterBar={projectSelector}
    notice={<p>名单仅供查看，编辑权限沿用现有角色。组织和平台管理员可直接管理项目，审核与合入职责单独配置。</p>}
    tableState={error ? <SectionError message={error} onRetry={() => setAttempt((value) => value + 1)} /> : members === null ? <SectionSkeleton label="正在加载项目参与名单" /> : undefined}
    table={{ rows: members ?? [], rowKey: (member) => member.userId, ariaLabel: "项目参与名单", columns: [
      { key: "name", header: "成员", render: (member) => member.name },
      { key: "username", header: "用户名", render: (member) => member.username ?? "未设置" },
      { key: "title", header: "职务", render: (member) => member.title || "未设置" },
      { key: "roles", header: "项目编辑角色", render: (member) => member.roles.map((role) => roleLabels[role]).join("、") },
      { key: "status", header: "账号状态", render: (member) => <Badge variant={member.isActive ? "secondary" : "outline"}>{member.isActive ? "已启用" : "已停用"}</Badge> }
    ] }} emptyState={{ title: "暂无项目参与者", message: "管理员仍可直接管理此项目。" }} />;
}
