import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, AlertTriangle, RefreshCw, Search } from "lucide-react";
import type { PrototypeState } from "@/domain/prototype/types";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import {
  createUserGovernanceClient,
  type ProjectWorkflowRoleId,
  type ProjectWorkflowRoleBindingsDto
} from "@/infrastructure/http/userGovernanceClient";
import type { UserAccount } from "@/domain/users/types";
import { presentError } from "@/infrastructure/http/presentError";

export type ProjectReviewRolesPanelProps = {
  projectId: string;
  onBack: () => void;
  state?: PrototypeState;
  userGovernanceClient?: ReturnType<typeof createUserGovernanceClient>;
};

const ROLE_LABELS: Record<ProjectWorkflowRoleId, string> = {
  "hardware-committer": "硬件 MDE",
  "software-committer": "软件 MDE",
  "software-user": "软件开发"
};

const ALL_WORKFLOW_ROLES: ProjectWorkflowRoleId[] = [
  "hardware-committer",
  "software-committer",
  "software-user"
];

export function ProjectReviewRolesPanel({
  projectId,
  onBack,
  userGovernanceClient = createUserGovernanceClient()
}: ProjectReviewRolesPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bindingsDto, setBindingsDto] = useState<ProjectWorkflowRoleBindingsDto | null>(null);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [draftRoles, setDraftRoles] = useState<Record<string, ProjectWorkflowRoleId[]>>({});
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    user: UserAccount;
    currentRoles: ProjectWorkflowRoleId[];
    nextRoles: ProjectWorkflowRoleId[];
  } | null>(null);

  const loadData = useCallback(async (preserveError = false) => {
    setLoading(true);
    if (!preserveError) {
      setError(null);
    }
    try {
      const [usersList, projectBindings] = await Promise.all([
        userGovernanceClient.listUsers(),
        userGovernanceClient.getProjectWorkflowRoleBindings(projectId)
      ]);
      setUsers(usersList);
      setBindingsDto(projectBindings);

      // Initialize drafts with current roles
      const initialDrafts: Record<string, ProjectWorkflowRoleId[]> = {};
      for (const b of projectBindings.bindings) {
        initialDrafts[b.userId] = [...b.roles];
      }
      setDraftRoles(initialDrafts);
    } catch (err) {
      setError(presentError(err, "加载项目审核角色失败，请稍后重试。"));
    } finally {
      setLoading(false);
    }
  }, [projectId, userGovernanceClient]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Current roles per user from fetched DTO
  const currentRolesMap = useMemo(() => {
    const map = new Map<string, ProjectWorkflowRoleId[]>();
    if (bindingsDto) {
      for (const b of bindingsDto.bindings) {
        map.set(b.userId, b.roles);
      }
    }
    return map;
  }, [bindingsDto]);

  // Derived candidate pools
  const poolMembers = useMemo(() => {
    const activeBindings = bindingsDto?.bindings.filter((b) => b.isActive) ?? [];
    const hwMembers = activeBindings.filter((b) => b.roles.includes("hardware-committer"));
    const swcMembers = activeBindings.filter((b) => b.roles.includes("software-committer"));
    const swuMembers = activeBindings.filter(
      (b) => b.roles.includes("software-user") || b.roles.includes("software-committer")
    );

    return {
      hw: hwMembers,
      swc: swcMembers,
      swu: swuMembers
    };
  }, [bindingsDto]);

  const toggleUserRole = (userId: string, roleId: ProjectWorkflowRoleId) => {
    const currentDraft = draftRoles[userId] ?? currentRolesMap.get(userId) ?? [];
    const next = currentDraft.includes(roleId)
      ? currentDraft.filter((r) => r !== roleId)
      : [...currentDraft, roleId];
    setDraftRoles((prev) => ({ ...prev, [userId]: next }));
  };

  const handleOpenConfirm = (user: UserAccount) => {
    const current = currentRolesMap.get(user.id) ?? [];
    const next = draftRoles[user.id] ?? current;
    setConfirmDialog({
      open: true,
      user,
      currentRoles: current,
      nextRoles: next
    });
  };

  const handleConfirmSave = async () => {
    if (!confirmDialog) return;
    const { user, currentRoles, nextRoles } = confirmDialog;
    setSavingUserId(user.id);
    setError(null);
    setSaveSuccessMessage(null);

    try {
      await userGovernanceClient.updateProjectWorkflowRoleBindings(projectId, user.id, {
        roles: nextRoles,
        expectedRoles: currentRoles
      });

      setSaveSuccessMessage(`已成功更新 ${user.name} 的项目审核角色。`);
      setConfirmDialog(null);
      // Reload fresh data to update candidate pools
      await loadData();
    } catch (err: unknown) {
      const errObj = err as { details?: { code?: string }; message?: string };
      if (errObj?.details?.code === "role-bindings-stale") {
        setConfirmDialog(null);
        await loadData(true);
        setError(`更新冲突：${user.name} 的角色已被其他管理员修改。已刷新最新数据，请重新核对后保存。`);
      } else {
        setError(presentError(err, "更新项目审核角色失败，请重试。"));
      }
    } finally {
      setSavingUserId(null);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        (u.username && u.username.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        u.title.toLowerCase().includes(q)
    );
  }, [users, searchQuery]);

  if (loading) {
    return <SectionSkeleton label="正在加载项目审核角色配置…" />;
  }

  if (error && !bindingsDto) {
    return <SectionError message={error} onRetry={() => void loadData()} />;
  }

  const isReady = bindingsDto?.ready ?? false;
  const missingRoles = bindingsDto?.missingRoles ?? [];

  return (
    <div className="project-review-roles-panel" style={{ padding: "1.5rem", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <button
            type="button"
            className="button subtle"
            onClick={onBack}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            返回项目列表
          </button>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
            {projectId} 项目审核角色配置
          </h1>
          <p style={{ color: "var(--color-text-secondary, #64748b)", margin: "0.25rem 0 0 0", fontSize: "0.875rem" }}>
            配置该项目参数检视流转所需的三类专门职责（硬件 MDE、软件 MDE、软件开发），与组织角色解耦并支持独立维护。
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => void loadData()}
          disabled={loading}
          style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
        >
          <RefreshCw size={15} aria-hidden="true" />
          刷新
        </button>
      </div>

      {/* Readiness Status Banner */}
      {!isReady ? (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
            padding: "1rem",
            borderRadius: "0.5rem",
            backgroundColor: "var(--color-warning-surface, #fffbeb)",
            border: "1px solid var(--color-warning-border, #fef3c7)",
            color: "var(--color-warning-text, #92400e)",
            marginBottom: "1.5rem"
          }}
        >
          <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: "0.125rem" }} />
          <div>
            <strong>审核职责未就绪</strong>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem" }}>
              当前项目缺失以下审核角色：<strong>{missingRoles.map((r) => ROLE_LABELS[r]).join("、")}</strong>。
              在补齐全部三类角色前，普通参数变更提交将被门禁拦截。
            </p>
          </div>
        </div>
      ) : (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.75rem 1rem",
            borderRadius: "0.5rem",
            backgroundColor: "var(--color-success-surface, #f0fdf4)",
            border: "1px solid var(--color-success-border, #dcfce7)",
            color: "var(--color-success-text, #166534)",
            marginBottom: "1.5rem"
          }}
        >
          <CheckCircle2 size={18} />
          <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
            该项目审核职责已完备就绪，各阶段均有符合资格的可用候选人。
          </span>
        </div>
      )}

      {/* Candidate Pools Summary Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "1rem",
          marginBottom: "2rem"
        }}
      >
        {/* Hardware Committer Pool */}
        <div
          style={{
            padding: "1rem",
            borderRadius: "0.5rem",
            border: "1px solid var(--color-border, #e2e8f0)",
            backgroundColor: "var(--color-surface, #ffffff)"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <strong style={{ fontSize: "0.9375rem" }}>硬件 MDE 池</strong>
            <span
              style={{
                fontSize: "0.75rem",
                padding: "0.125rem 0.5rem",
                borderRadius: "9999px",
                backgroundColor: poolMembers.hw.length > 0 ? "#dcfce7" : "#fee2e2",
                color: poolMembers.hw.length > 0 ? "#166534" : "#991b1b"
              }}
            >
              {poolMembers.hw.length > 0 ? `${poolMembers.hw.length} 人就绪` : "缺失"}
            </span>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: 0 }}>
            负责第 1 阶段硬件检视
          </p>
          <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem" }}>
            {poolMembers.hw.length > 0 ? (
              poolMembers.hw.map((m) => m.name).join("、")
            ) : (
              <span style={{ color: "#ef4444" }}>暂无配置可用成员</span>
            )}
          </div>
        </div>

        {/* Software Committer Pool */}
        <div
          style={{
            padding: "1rem",
            borderRadius: "0.5rem",
            border: "1px solid var(--color-border, #e2e8f0)",
            backgroundColor: "var(--color-surface, #ffffff)"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <strong style={{ fontSize: "0.9375rem" }}>软件 MDE 池</strong>
            <span
              style={{
                fontSize: "0.75rem",
                padding: "0.125rem 0.5rem",
                borderRadius: "9999px",
                backgroundColor: poolMembers.swc.length > 0 ? "#dcfce7" : "#fee2e2",
                color: poolMembers.swc.length > 0 ? "#166534" : "#991b1b"
              }}
            >
              {poolMembers.swc.length > 0 ? `${poolMembers.swc.length} 人就绪` : "缺失"}
            </span>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: 0 }}>
            负责第 2 阶段软件检视
          </p>
          <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem" }}>
            {poolMembers.swc.length > 0 ? (
              poolMembers.swc.map((m) => m.name).join("、")
            ) : (
              <span style={{ color: "#ef4444" }}>暂无配置可用成员</span>
            )}
          </div>
        </div>

        {/* Software User Pool */}
        <div
          style={{
            padding: "1rem",
            borderRadius: "0.5rem",
            border: "1px solid var(--color-border, #e2e8f0)",
            backgroundColor: "var(--color-surface, #ffffff)"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <strong style={{ fontSize: "0.9375rem" }}>软件开发 (合入) 池</strong>
            <span
              style={{
                fontSize: "0.75rem",
                padding: "0.125rem 0.5rem",
                borderRadius: "9999px",
                backgroundColor: poolMembers.swu.length > 0 ? "#dcfce7" : "#fee2e2",
                color: poolMembers.swu.length > 0 ? "#166534" : "#991b1b"
              }}
            >
              {poolMembers.swu.length > 0 ? `${poolMembers.swu.length} 人就绪` : "缺失"}
            </span>
          </div>
          <p style={{ fontSize: "0.8125rem", color: "#64748b", margin: 0 }}>
            负责第 3 阶段合入（软件 MDE 可兼任）
          </p>
          <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem" }}>
            {poolMembers.swu.length > 0 ? (
              poolMembers.swu.map((m) => m.name).join("、")
            ) : (
              <span style={{ color: "#ef4444" }}>暂无配置可用成员</span>
            )}
          </div>
        </div>
      </div>

      {/* Notifications */}
      {saveSuccessMessage ? (
        <div
          role="status"
          style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#f0fdf4",
            border: "1px solid #dcfce7",
            borderRadius: "0.375rem",
            color: "#166534",
            marginBottom: "1rem",
            fontSize: "0.875rem"
          }}
        >
          {saveSuccessMessage}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            padding: "0.75rem 1rem",
            backgroundColor: "#fef2f2",
            border: "1px solid #fee2e2",
            borderRadius: "0.375rem",
            color: "#991b1b",
            marginBottom: "1rem",
            fontSize: "0.875rem"
          }}
        >
          {error}
        </div>
      ) : null}

      {/* Member Governance Table */}
      <section
        style={{
          backgroundColor: "var(--color-surface, #ffffff)",
          border: "1px solid var(--color-border, #e2e8f0)",
          borderRadius: "0.5rem",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            padding: "1rem",
            borderBottom: "1px solid var(--color-border, #e2e8f0)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem"
          }}
        >
          <div>
            <h2 style={{ fontSize: "1.125rem", margin: 0, fontWeight: 600 }}>组织成员职责授权</h2>
            <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.8125rem", color: "#64748b" }}>
              选择组织成员赋予本项目审核职责；已停用账号不可授予新角色。
            </p>
          </div>
          <div style={{ position: "relative", minWidth: "240px" }}>
            <Search
              size={15}
              style={{ position: "absolute", left: "0.625rem", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索成员姓名、职务或账号"
              style={{
                width: "100%",
                padding: "0.375rem 0.75rem 0.375rem 2rem",
                borderRadius: "0.375rem",
                border: "1px solid var(--color-border, #cbd5e1)",
                fontSize: "0.875rem"
              }}
              aria-label="搜索成员"
            />
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ backgroundColor: "#f8fafc", borderBottom: "1px solid var(--color-border, #e2e8f0)" }}>
                <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>成员</th>
                <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>职务</th>
                <th style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>状态</th>
                <th style={{ padding: "0.75rem 1rem", fontWeight: 600, textAlign: "center" }}>硬件 MDE</th>
                <th style={{ padding: "0.75rem 1rem", fontWeight: 600, textAlign: "center" }}>软件 MDE</th>
                <th style={{ padding: "0.75rem 1rem", fontWeight: 600, textAlign: "center" }}>软件开发</th>
                <th style={{ padding: "0.75rem 1rem", fontWeight: 600, textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
                    没有匹配的成员。
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const currentRoles = currentRolesMap.get(u.id) ?? [];
                  const userDraft = draftRoles[u.id] ?? currentRoles;
                  const isModified =
                    [...currentRoles].sort().join(",") !== [...userDraft].sort().join(",");
                  const isInactive = !u.isActive;

                  return (
                    <tr
                      key={u.id}
                      style={{
                        borderBottom: "1px solid var(--color-border, #e2e8f0)",
                        backgroundColor: isModified ? "#f0f9ff" : "transparent"
                      }}
                    >
                      <td style={{ padding: "0.75rem 1rem" }}>
                        <div style={{ fontWeight: 600 }}>{u.name}</div>
                        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          {u.username ?? u.email ?? u.id}
                        </div>
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "#475569" }}>{u.title}</td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.125rem 0.375rem",
                            borderRadius: "0.25rem",
                            backgroundColor: u.isActive ? "#dcfce7" : "#f1f5f9",
                            color: u.isActive ? "#166534" : "#64748b"
                          }}
                        >
                          {u.isActive ? "正常" : "已停用"}
                        </span>
                      </td>
                      {/* Checkboxes for 3 roles */}
                      {ALL_WORKFLOW_ROLES.map((roleId) => {
                        const checked = userDraft.includes(roleId);
                        const disabled = isInactive && !checked; // Inactive users can only uncheck

                        return (
                          <td key={roleId} style={{ padding: "0.75rem 1rem", textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled || savingUserId === u.id}
                              onChange={() => toggleUserRole(u.id, roleId)}
                              aria-label={`为 ${u.name} 配置 ${ROLE_LABELS[roleId]}`}
                              title={
                                disabled
                                  ? "已停用成员不可新增角色，仅可移除现有角色"
                                  : `${u.name} - ${ROLE_LABELS[roleId]}`
                              }
                            />
                          </td>
                        );
                      })}
                      {/* Action Button */}
                      <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                        <button
                          type="button"
                          className="button primary"
                          disabled={!isModified || savingUserId === u.id}
                          onClick={() => handleOpenConfirm(u)}
                          style={{ fontSize: "0.8125rem", padding: "0.25rem 0.625rem" }}
                        >
                          {savingUserId === u.id ? "保存中..." : "保存修改"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Confirmation Dialog */}
      {confirmDialog ? (
        <ConfirmDialog
          open={confirmDialog.open}
          title="确认更新项目审核角色"
          tone="primary"
          confirmLabel="确认保存"
          cancelLabel="取消"
          onCancel={() => setConfirmDialog(null)}
          onConfirm={handleConfirmSave}
          description={
            <div>
              <p>
                确认更新 <strong>{confirmDialog.user.name}</strong> 在项目 <strong>{projectId}</strong> 的审核角色配置？
              </p>
              <div style={{ marginTop: "0.75rem", fontSize: "0.875rem" }}>
                <div>
                  变更前：
                  {confirmDialog.currentRoles.length > 0
                    ? confirmDialog.currentRoles.map((r) => ROLE_LABELS[r]).join("、")
                    : "（无）"}
                </div>
                <div style={{ marginTop: "0.25rem" }}>
                  变更后：
                  <strong>
                    {confirmDialog.nextRoles.length > 0
                      ? confirmDialog.nextRoles.map((r) => ROLE_LABELS[r]).join("、")
                      : "（清空所有项目角色）"}
                  </strong>
                </div>
              </div>
              <p style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "#64748b" }}>
                提示：本次更新仅影响该用户在本项目中的审核角色，其组织角色及其他项目绑定保持不变。
              </p>
            </div>
          }
        />
      ) : null}
    </div>
  );
}
