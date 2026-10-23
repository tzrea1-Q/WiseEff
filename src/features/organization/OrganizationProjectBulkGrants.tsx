import { useEffect, useRef, useState } from "react";
import { DataTable } from "@/components/admin/DataTable";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { SelectControl } from "@/components/common/SelectControl";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import { Button } from "@/components/ui/button";
import { roleLabels } from "@/UserPermissionsPage";
import { presentError } from "@/infrastructure/http/presentError";
import type { ProjectMember, ProjectMemberRoleId } from "@/infrastructure/http/userGovernanceClient";
import type { ProjectMembershipClient } from "./OrganizationProjectsPanel";

type Grant = { userId: string; name: string; previous: ProjectMemberRoleId[]; next: ProjectMemberRoleId[]; state: "ready" | "saved" | "review" | "blocked"; message: string };
const labels = (roles: ProjectMemberRoleId[]) => roles.map((role) => roleLabels[role]).join("、") || "无";
const roleOptions = (["hardware-user", "software-user", "hardware-committer", "software-committer"] as const).map((value) => ({ value, label: roleLabels[value] }));

export function OrganizationProjectBulkGrants({ client, projectId, projectName, onUpdated, onClose }: {
  client: ProjectMembershipClient; projectId: string; projectName: string; onUpdated: (members: ProjectMember[]) => void; onClose: () => void;
}) {
  const [data, setData] = useState<{ teams: Awaited<ReturnType<ProjectMembershipClient["listTeams"]>>; users: Awaited<ReturnType<ProjectMembershipClient["listUsers"]>> } | null>(null);
  const [teamId, setTeamId] = useState(""), [userIds, setUserIds] = useState<string[]>([]), [roles, setRoles] = useState<ProjectMemberRoleId[]>([]);
  const [rows, setRows] = useState<Grant[] | null>(null), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0), [submitted, setSubmitted] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setError("");
    void Promise.all([client.listTeams(), client.listUsers()]).then(([teams, users]) => { if (!cancelled) setData({ teams, users }); })
      .catch((failure: unknown) => { if (!cancelled) setError(presentError(failure, "无法加载团队与成员，请重试。")); });
    return () => { cancelled = true; };
  }, [client, attempt]);

  async function preview(reconcile = false) {
    if (pending) return;
    setPending(true); setError("");
    try {
      const [roster, users] = await Promise.all([client.getProjectMembers(projectId), client.listUsers()]);
      if (!alive.current) return;
      const grants = userIds.map((userId): Grant => {
        const old = rows?.find((row) => row.userId === userId);
        if (reconcile && old?.state === "saved") return old;
        const person = users.find((user) => user.id === userId), previous = roster.members.find((member) => member.userId === userId)?.roles ?? [];
        const next = [...new Set([...previous, ...roles])];
        const blocked = !person ? "成员已不存在或不属于当前组织" : !person.isActive ? "账号已停用，未授予角色" : "";
        const satisfied = roles.every((role) => previous.includes(role));
        const known = person ?? data?.users.find((user) => user.id === userId);
        return { userId, name: known ? `${known.name}${known.username ? ` · ${known.username}` : ""}` : old?.name ?? userId, previous, next, state: blocked ? "blocked" : satisfied ? "saved" : "ready",
          message: blocked || (satisfied ? "已核实生效" : "待授予") };
      });
      setRows(grants); setData((current) => current ? { ...current, users } : current); onUpdated(roster.members);
    } catch (failure) { if (alive.current) setError(presentError(failure, "无法核对当前权限，请重试。")); }
    finally { if (alive.current) setPending(false); }
  }
  async function grant() {
    if (!rows || pending) return;
    setPending(true); setSubmitted(true); setError("");
    for (const row of rows.filter((item) => item.state === "ready")) {
      if (!alive.current) return;
      let result: Grant;
      try {
        const roster = await client.updateProjectMember(projectId, row.userId, { roles: row.next, expectedRoles: row.previous });
        if (!alive.current) return;
        const actual = roster.members.find((member) => member.userId === row.userId);
        result = { ...row, state: "saved", message: actual?.isActive ? "已生效" : "已保存角色；账号已停用" };
        onUpdated(roster.members);
      } catch (failure) {
        result = { ...row, state: "review", message: `${presentError(failure, "授权未确认。")} 请重新核对后重试。` };
      }
      if (alive.current) setRows((current) => current?.map((item) => item.userId === row.userId ? result : item) ?? null);
    }
    if (alive.current) setPending(false);
  }
  const readyCount = rows?.filter((row) => row.state === "ready").length ?? 0;
  const savedCount = rows?.filter((row) => row.state === "saved").length ?? 0;
  return <ModalDialog open className="user-permissions-modal-card member-details-card modal-card--lg" onDismiss={() => { if (!pending) onClose(); }}>{({ titleId }) => <>
    <h2 id={titleId}>批量授予项目角色</h2>
    <div className="member-details">
      <p>项目：{projectName}</p>
      <p className="member-details__hint">从团队选择具体人员，添加角色并保留已有角色。后续团队增减不影响本次个人授权；审核与合入职责另行配置。</p>
      {error && <SectionError message={error} onRetry={() => { if (data) void preview(Boolean(rows)); else setAttempt((value) => value + 1); }} />}
      {!data && !error ? <SectionSkeleton label="正在加载团队与成员" /> : data && !rows ? <div className="member-details__section" inert={pending}>
        <SelectControl ariaLabel="选择来源团队" value={teamId} options={data.teams.map((team) => ({ value: team.id, label: team.name }))} onValueChange={(id) => { setTeamId(id); setUserIds(data.teams.find((team) => team.id === id)?.memberIds ?? []); }} />
        <MultiSelectDropdown label="选择实际授权成员" value={userIds} options={[...new Set([...(data.teams.find((team) => team.id === teamId)?.memberIds ?? []), ...userIds])].map((id) => {
          const user = data.users.find((item) => item.id === id);
          return { value: id, label: user ? `${user.name} · ${user.username ?? user.id}${user.isActive ? "" : "（已停用）"}` : `${id}（成员不可用）` };
        })} onChange={setUserIds} />
        <MultiSelectDropdown label="授予项目编辑角色" value={roles} options={roleOptions} onChange={(values) => setRoles(values as ProjectMemberRoleId[])} />
        <p className="member-details__hint">已选择 {userIds.length} 人。停用或不属于当前组织的成员会在预览中标明，不能提交。</p>
      </div> : null}
      {rows && <>
        <DataTable fluid ariaLabel="批量项目授权结果" rows={rows} rowKey={(row) => row.userId} columns={[
          { key: "name", header: "具体成员", render: (row) => row.name },
          { key: "project", header: "项目", render: () => projectName },
          { key: "previous", header: "原项目角色", render: (row) => labels(row.previous) },
          { key: "next", header: "拟授予后角色", render: (row) => labels(row.next) },
          { key: "result", header: "结果", render: (row) => row.message }
        ]} />
        {submitted && <p role="status">已生效 {savedCount} 人，待处理 {rows.length - savedCount} 人</p>}
      </>}
    </div>
    <div className="user-permissions-modal-actions">
      {!rows ? <Button disabled={pending || !data || !userIds.length || !roles.length} onClick={() => void preview()}>预览授权</Button> : <>
        <Button variant="outline" disabled={pending} onClick={() => { setRows(null); setSubmitted(false); setError(""); }}>重新选择</Button>
        {rows.some((row) => row.state === "review" || row.state === "blocked") && <Button variant="outline" disabled={pending} onClick={() => void preview(true)}>重新核对未完成项</Button>}
        {readyCount > 0 && <Button disabled={pending} onClick={() => void grant()}>{pending ? "正在授予" : `确认授予 ${readyCount} 人`}</Button>}
      </>}
      <Button variant="outline" disabled={pending} onClick={onClose}>关闭</Button>
    </div>
  </>}</ModalDialog>;
}
