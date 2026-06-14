import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type FormEvent } from "react";
import { UserPlus } from "lucide-react";

import type { AppAction } from "@/App";
import { ColumnFilter } from "@/components/ColumnFilter";
import { toggleFilterValue, uniqueFilterValues, type HeaderFilterState } from "@/components/tableFilterUtils";
import { migrateLegacyRoleId, platformRoles, type PermissionKey, type PlatformRoleId } from "@/domain/users/types";
import type { PrototypeState, User } from "@/mockData";

type UserPermissionsPageProps = {
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  search: string;
  userGovernanceActions?: UserGovernanceActions;
};

export type UserGovernanceActions = {
  listUsers(): Promise<User[]>;
  createUser(input: { name: string; email: string; title: string; roleId: PlatformRoleId }): Promise<User | void>;
  assignUserRole(userId: string, roleId: PlatformRoleId): Promise<User | void>;
  setUserActive(userId: string, isActive: boolean): Promise<User | void>;
  listRegistrationRoleRequests?(): Promise<RegistrationRoleRequest[]>;
  approveRegistrationRoleRequest?(requestId: string): Promise<RegistrationRoleRequest | void>;
  rejectRegistrationRoleRequest?(requestId: string): Promise<RegistrationRoleRequest | void>;
};

export type RegistrationRoleRequest = {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  username: string | null;
  currentRoleId: PlatformRoleId;
  requestedRoleId: PlatformRoleId;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
};

const statusOptions = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "启用" },
  { value: "disabled", label: "停用" }
] as const;

type StatusFilter = (typeof statusOptions)[number]["value"];

const statusLabels: Record<Exclude<StatusFilter, "all">, string> = {
  active: "启用",
  disabled: "停用"
};

const roleLabels: Record<PlatformRoleId, string> = {
  guest: "访客",
  "hardware-user": "硬件用户",
  "software-user": "软件用户",
  "hardware-committer": "硬件提交人",
  "software-committer": "软件提交人",
  admin: "管理员"
};

const roleCapabilityDescriptions: Record<PlatformRoleId, string> = {
  guest: "仅可查看参数页面。",
  "hardware-user": "硬件侧可查看并提交参数修改，使用参数调试和日志分析。",
  "software-user": "软件侧可查看并提交参数修改，使用参数调试和日志分析。",
  "hardware-committer": "包含硬件用户权限，并可执行硬件侧参数检视。",
  "software-committer": "包含软件用户权限，并可执行软件侧参数检视。",
  admin: "包含全部提交人权限，并可访问各应用后台和用户管理。"
};

const permissionLabels: Record<PermissionKey, string> = {
  "parameter:view": "查看参数",
  "parameter:edit": "修改参数",
  "debugging:use": "使用调试平台",
  "logs:upload": "上传日志智能分析",
  "parameter:review": "审阅参数提交",
  "admin:access": "访问应用后台",
  "users:manage": "管理用户权限"
};

type UserColumnFilterKey = "user" | "title" | "role" | "status" | "lastActive";

type RoleHintState = {
  userId: string;
  x: number;
  y: number;
};

function roleLabelOf(roleId: PlatformRoleId) {
  const normalizedRoleId = migrateLegacyRoleId(roleId);
  return roleLabels[normalizedRoleId] ?? normalizedRoleId;
}

function statusLabelOf(isActive: boolean) {
  return isActive ? statusLabels.active : statusLabels.disabled;
}

function userColumnFilterValue(user: User, key: UserColumnFilterKey) {
  if (key === "user") {
    return user.name;
  }
  if (key === "title") {
    return user.title;
  }
  if (key === "role") {
    return roleLabelOf(user.roleId);
  }
  if (key === "status") {
    return statusLabelOf(user.isActive);
  }
  return user.lastActive;
}

function userAccountIdentifier(user: User) {
  return user.email ?? user.username ?? "无账号标识";
}

function RoleCapabilityTooltip({ roleId, position }: { roleId: PlatformRoleId; position: RoleHintState }) {
  const normalizedRoleId = migrateLegacyRoleId(roleId);
  const role = platformRoles.find((item) => item.id === normalizedRoleId);

  if (!role) {
    return null;
  }

  const roleLabel = roleLabelOf(role.id);

  const style = {
    "--role-tooltip-x": `${position.x}px`,
    "--role-tooltip-y": `${position.y}px`
  } as CSSProperties;

  return (
    <div className="user-permissions-role-tooltip" role="tooltip" aria-label={`${roleLabel}角色权限`} style={style}>
      <h3>{roleLabel}</h3>
      <p>{roleCapabilityDescriptions[role.id]}</p>
      <ul>
        {role.permissions.map((permission) => (
          <li key={permission}>{permissionLabels[permission]}</li>
        ))}
      </ul>
    </div>
  );
}

export function UserPermissionsPage({ state, dispatch, search: _search, userGovernanceActions }: UserPermissionsPageProps) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<PlatformRoleId | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [columnFilters, setColumnFilters] = useState<HeaderFilterState>({});
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [addUserError, setAddUserError] = useState("");
  const [initialRoleId, setInitialRoleId] = useState<PlatformRoleId>("hardware-user");
  const [registrationRoleRequests, setRegistrationRoleRequests] = useState<RegistrationRoleRequest[]>([]);
  const [registrationRoleRequestError, setRegistrationRoleRequestError] = useState("");
  const [decidingRequestId, setDecidingRequestId] = useState("");
  const [activeRoleHint, setActiveRoleHint] = useState<RoleHintState | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = useMemo(
    () =>
      state.users.filter((user) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          [user.name, user.email, user.username, user.title].some((value) => (value ?? "").toLowerCase().includes(normalizedQuery));
        const normalizedRoleId = migrateLegacyRoleId(user.roleId);
        const matchesRole = roleFilter === "all" || normalizedRoleId === roleFilter;
        const matchesStatus =
          statusFilter === "all" || (statusFilter === "active" ? user.isActive : !user.isActive);
        const matchesColumnFilters = (["user", "title", "role", "status", "lastActive"] as UserColumnFilterKey[]).every((key) => {
          const selectedValues = columnFilters[key] ?? [];
          return selectedValues.length === 0 || selectedValues.includes(userColumnFilterValue(user, key));
        });

        return matchesQuery && matchesRole && matchesStatus && matchesColumnFilters;
      }),
    [columnFilters, normalizedQuery, roleFilter, state.users, statusFilter]
  );

  function toggleColumnFilter(key: UserColumnFilterKey, value: string) {
    setColumnFilters((current) => ({
      ...current,
      [key]: toggleFilterValue(current[key] ?? [], value)
    }));
  }

  function clearColumnFilter(key: UserColumnFilterKey) {
    setColumnFilters((current) => ({ ...current, [key]: [] }));
  }

  function renderColumnFilter(key: UserColumnFilterKey, label: string) {
    return (
      <ColumnFilter
        label={label}
        groupLabel={`${label}筛选`}
        values={uniqueFilterValues(state.users, (user) => userColumnFilterValue(user, key))}
        selectedValues={columnFilters[key] ?? []}
        onToggle={(value) => toggleColumnFilter(key, value)}
        onClear={() => clearColumnFilter(key)}
      />
    );
  }

  function renderHeader(key: UserColumnFilterKey, label: string) {
    return (
      <div className="user-permissions-table-head">
        <span>{label}</span>
        {renderColumnFilter(key, label)}
      </div>
    );
  }

  function showRoleHint(userId: string, target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    const tooltipWidth = 280;
    const tooltipHeight = 204;
    const margin = 16;
    const opensBeside = window.innerWidth >= 900 && rect.right + 12 + tooltipWidth <= window.innerWidth - margin;
    const x = opensBeside
      ? rect.right + 12
      : Math.max(margin, Math.min(rect.left, window.innerWidth - tooltipWidth - margin));
    const y = opensBeside
      ? Math.max(margin, Math.min(rect.top, window.innerHeight - tooltipHeight - margin))
      : Math.max(margin, Math.min(rect.bottom + 10, window.innerHeight - tooltipHeight - margin));

    setActiveRoleHint({ userId, x, y });
  }

  function hideRoleHint(userId: string) {
    setActiveRoleHint((current) => (current?.userId === userId ? null : current));
  }

  useEffect(() => {
    if (!userGovernanceActions?.listRegistrationRoleRequests) {
      setRegistrationRoleRequests([]);
      return;
    }

    let cancelled = false;
    userGovernanceActions
      .listRegistrationRoleRequests()
      .then((items) => {
        if (!cancelled) {
          setRegistrationRoleRequests(items.filter((item) => item.status === "pending"));
          setRegistrationRoleRequestError("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRegistrationRoleRequestError(error instanceof Error ? error.message : "加载注册角色申请失败。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userGovernanceActions]);

  async function decideRegistrationRoleRequest(request: RegistrationRoleRequest, decision: "approve" | "reject") {
    setRegistrationRoleRequestError("");
    setDecidingRequestId(request.id);

    try {
      if (decision === "approve") {
        if (!userGovernanceActions?.approveRegistrationRoleRequest) {
          throw new Error("注册角色申请审批尚未启用。");
        }
        await userGovernanceActions.approveRegistrationRoleRequest(request.id);
        dispatch({ type: "ASSIGN_USER_ROLE", userId: request.userId, roleId: request.requestedRoleId });
      } else {
        if (!userGovernanceActions?.rejectRegistrationRoleRequest) {
          throw new Error("注册角色申请拒绝尚未启用。");
        }
        await userGovernanceActions.rejectRegistrationRoleRequest(request.id);
      }
      setRegistrationRoleRequests((items) => items.filter((item) => item.id !== request.id));
    } catch (error) {
      setRegistrationRoleRequestError(error instanceof Error ? error.message : "注册角色申请处理失败。");
    } finally {
      setDecidingRequestId("");
    }
  }

  async function handleAddUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedTitle = title.trim();

    if (!trimmedName || !trimmedEmail) {
      setAddUserError("姓名和邮箱不能为空。");
      return;
    }

    try {
      const createdUser = await userGovernanceActions?.createUser({
        name: trimmedName,
        email: trimmedEmail,
        title: trimmedTitle,
        roleId: initialRoleId
      });
      dispatch({
        type: "ADD_USER",
        id: createdUser?.id,
        name: createdUser?.name ?? trimmedName,
        email: createdUser?.email ?? trimmedEmail,
        title: createdUser?.title ?? trimmedTitle,
        roleId: createdUser?.roleId ?? initialRoleId
      });
    } catch (error) {
      setAddUserError(error instanceof Error ? error.message : "创建用户失败。");
      return;
    }

    setAddUserOpen(false);
    setName("");
    setEmail("");
    setTitle("");
    setAddUserError("");
    setInitialRoleId("hardware-user");
  }

  return (
    <section className="user-permissions-page" aria-label="用户权限">
      <div className="user-permissions-summary">
        <button className="button primary user-permissions-primary-action" type="button" onClick={() => setAddUserOpen(true)}>
          <UserPlus size={16} aria-hidden="true" />
          <span>添加用户</span>
        </button>
      </div>

      <div className="user-permissions-filters" role="search" aria-label="用户筛选">
        <label className="user-permissions-filter-field user-permissions-filter-field--search">
          <span className="user-permissions-filter-label">搜索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户" />
        </label>
        <label className="user-permissions-filter-field">
          <span className="user-permissions-filter-label">角色</span>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as PlatformRoleId | "all")}>
            <option value="all">全部角色</option>
            {platformRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {roleLabelOf(role.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="user-permissions-filter-field">
          <span className="user-permissions-filter-label">状态</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="user-permissions-approval-queue" aria-label="注册角色申请">
        <div className="user-permissions-approval-queue__header">
          <div>
            <span className="eyebrow">注册申请</span>
            <h3>角色申请</h3>
          </div>
          <span className="user-permissions-approval-count">{registrationRoleRequests.length} 条待处理</span>
        </div>
        {registrationRoleRequestError ? (
          <p role="alert" className="user-permissions-modal-error">{registrationRoleRequestError}</p>
        ) : null}
        {registrationRoleRequests.length > 0 ? (
          <div className="user-permissions-approval-list">
            {registrationRoleRequests.map((request) => (
              <article className="user-permissions-approval-item" key={request.id}>
                <div className="user-permissions-approval-user">
                  <strong>{request.userName}</strong>
                  <span>{request.username ?? request.userId}</span>
                </div>
                <div className="user-permissions-approval-role-change">
                  <span>{roleLabelOf(request.currentRoleId)}</span>
                  <span aria-hidden="true">→</span>
                  <span>{roleLabelOf(request.requestedRoleId)}</span>
                </div>
                <div className="user-permissions-approval-actions">
                  <button
                    className="button primary"
                    type="button"
                    disabled={decidingRequestId === request.id}
                    onClick={() => void decideRegistrationRoleRequest(request, "approve")}
                  >
                    通过
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={decidingRequestId === request.id}
                    onClick={() => void decideRegistrationRoleRequest(request, "reject")}
                  >
                    拒绝
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="user-permissions-approval-empty">暂无待处理角色申请。</p>
        )}
      </section>

      <div className="user-permissions-grid">
        <div className="user-permissions-table-card">
          <table aria-label="平台用户">
            <caption className="sr-only">平台用户</caption>
            <thead>
              <tr>
                <th scope="col">{renderHeader("user", "用户")}</th>
                <th scope="col">{renderHeader("title", "职务")}</th>
                <th scope="col" className="user-permissions-role-header">{renderHeader("role", "角色")}</th>
                <th scope="col">{renderHeader("status", "状态")}</th>
                <th scope="col">{renderHeader("lastActive", "最近活跃")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => {
                const isCurrentUser = user.id === state.currentUserId;
                const normalizedRoleId = migrateLegacyRoleId(user.roleId);

                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.name}</strong>
                      <div>{userAccountIdentifier(user)}</div>
                    </td>
                    <td>{user.title}</td>
                    <td
                      className="user-permissions-role-cell"
                      onMouseEnter={(event) => showRoleHint(user.id, event.currentTarget)}
                      onMouseLeave={() => hideRoleHint(user.id)}
                    >
                      <div className="user-permissions-role-control">
                        <select
                          className="user-permissions-role-select"
                          aria-label={`调整 ${user.name} 的角色`}
                          value={normalizedRoleId}
                          disabled={isCurrentUser}
                          onFocus={(event) => showRoleHint(user.id, event.currentTarget)}
                          onBlur={() => hideRoleHint(user.id)}
                          onChange={async (event) => {
                            const roleId = event.target.value as PlatformRoleId;
                            await userGovernanceActions?.assignUserRole(user.id, roleId);
                            dispatch({
                              type: "ASSIGN_USER_ROLE",
                              userId: user.id,
                              roleId
                            });
                          }}
                        >
                          {platformRoles.map((role) => (
                            <option key={role.id} value={role.id}>
                              {roleLabelOf(role.id)}
                            </option>
                          ))}
                        </select>
                        {activeRoleHint?.userId === user.id ? (
                          <RoleCapabilityTooltip roleId={normalizedRoleId} position={activeRoleHint} />
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <button
                        className="button"
                        type="button"
                        disabled={isCurrentUser}
                        onClick={async () => {
                          const isActive = !user.isActive;
                          await userGovernanceActions?.setUserActive(user.id, isActive);
                          dispatch({
                            type: "TOGGLE_USER_ACTIVE",
                            userId: user.id,
                            isActive
                          });
                        }}
                      >
                        {user.isActive ? `停用 ${user.name}` : `启用 ${user.name}`}
                      </button>
                    </td>
                    <td>{user.lastActive}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {addUserOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="add-user-title" className="user-permissions-modal">
          <form className="user-permissions-modal-card" onSubmit={handleAddUserSubmit}>
            <h3 id="add-user-title">添加用户</h3>
            <div className="user-permissions-modal-fields">
              <label className="user-permissions-modal-field">
                <span>姓名</span>
                <input
                  className="user-permissions-modal-control"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setAddUserError("");
                  }}
                  required
                />
              </label>
              <label className="user-permissions-modal-field">
                <span>邮箱</span>
                <input
                  className="user-permissions-modal-control"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setAddUserError("");
                  }}
                  required
                />
              </label>
              <label className="user-permissions-modal-field">
                <span>职务</span>
                <input className="user-permissions-modal-control" value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="user-permissions-modal-field">
                <span>初始角色</span>
                <select
                  className="user-permissions-modal-control"
                  value={initialRoleId}
                  onChange={(event) => setInitialRoleId(event.target.value as PlatformRoleId)}
                >
                  {platformRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {roleLabelOf(role.id)}
                    </option>
                  ))}
                </select>
              </label>
              {addUserError ? <p role="alert" className="user-permissions-modal-error">{addUserError}</p> : null}
            </div>
            <div className="user-permissions-modal-actions">
              <button
                className="button user-permissions-modal-action user-permissions-modal-action--secondary"
                type="button"
                onClick={() => setAddUserOpen(false)}
              >
                取消
              </button>
              <button className="button primary user-permissions-modal-action user-permissions-modal-action--primary" type="submit">
                创建用户
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
