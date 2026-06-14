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
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" }
] as const;

type StatusFilter = (typeof statusOptions)[number]["value"];

const roleCapabilityDescriptions: Record<PlatformRoleId, string> = {
  guest: "仅可查看参数页面。",
  "hardware-user": "硬件侧可查看并提交参数修改，使用参数调试和日志分析。",
  "software-user": "软件侧可查看并提交参数修改，使用参数调试和日志分析。",
  "hardware-committer": "包含硬件 User 权限，并可执行硬件侧参数检视。",
  "software-committer": "包含硬件 User 权限，并可执行软件侧参数检视。",
  admin: "包含全部 Committer 权限，并可访问各应用后台和用户管理。"
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

function roleNameOf(roleId: PlatformRoleId) {
  const normalizedRoleId = migrateLegacyRoleId(roleId);
  return platformRoles.find((role) => role.id === normalizedRoleId)?.name ?? normalizedRoleId;
}

function userColumnFilterValue(user: User, key: UserColumnFilterKey) {
  if (key === "user") {
    return user.name;
  }
  if (key === "title") {
    return user.title;
  }
  if (key === "role") {
    return roleNameOf(user.roleId);
  }
  if (key === "status") {
    return user.isActive ? "Active" : "Disabled";
  }
  return user.lastActive;
}

function userAccountIdentifier(user: User) {
  return user.email ?? user.username ?? "No account identifier";
}

function RoleCapabilityTooltip({ roleId, position }: { roleId: PlatformRoleId; position: RoleHintState }) {
  const role = platformRoles.find((item) => item.id === roleId);

  if (!role) {
    return null;
  }

  const style = {
    "--role-tooltip-x": `${position.x}px`,
    "--role-tooltip-y": `${position.y}px`
  } as CSSProperties;

  return (
    <div className="user-permissions-role-tooltip" role="tooltip" aria-label={`${role.name} role permissions`} style={style}>
      <h3>{role.name}</h3>
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
          setRegistrationRoleRequestError(error instanceof Error ? error.message : "Load registration role requests failed.");
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
          throw new Error("Registration role approval is not enabled.");
        }
        await userGovernanceActions.approveRegistrationRoleRequest(request.id);
        dispatch({ type: "ASSIGN_USER_ROLE", userId: request.userId, roleId: request.requestedRoleId });
      } else {
        if (!userGovernanceActions?.rejectRegistrationRoleRequest) {
          throw new Error("Registration role rejection is not enabled.");
        }
        await userGovernanceActions.rejectRegistrationRoleRequest(request.id);
      }
      setRegistrationRoleRequests((items) => items.filter((item) => item.id !== request.id));
    } catch (error) {
      setRegistrationRoleRequestError(error instanceof Error ? error.message : "Registration role request decision failed.");
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
      setAddUserError("Name and email are required.");
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
      setAddUserError(error instanceof Error ? error.message : "Create user failed.");
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
    <section className="user-permissions-page" aria-label="User permissions">
      <div className="user-permissions-summary">
        <button className="button primary user-permissions-primary-action" type="button" onClick={() => setAddUserOpen(true)}>
          <UserPlus size={16} aria-hidden="true" />
          <span>Add user</span>
        </button>
      </div>

      <div className="user-permissions-filters" role="search" aria-label="User filters">
        <label className="user-permissions-filter-field user-permissions-filter-field--search">
          <span className="user-permissions-filter-label">Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users" />
        </label>
        <label className="user-permissions-filter-field">
          <span className="user-permissions-filter-label">Role</span>
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as PlatformRoleId | "all")}>
            <option value="all">All roles</option>
            {platformRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <label className="user-permissions-filter-field">
          <span className="user-permissions-filter-label">Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="user-permissions-approval-queue" aria-label="Registration role requests">
        <div className="user-permissions-approval-queue__header">
          <div>
            <span className="eyebrow">Registration</span>
            <h3>Role requests</h3>
          </div>
          <span className="user-permissions-approval-count">{registrationRoleRequests.length} pending</span>
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
                  <span>{roleNameOf(request.currentRoleId)}</span>
                  <span aria-hidden="true">→</span>
                  <span>{roleNameOf(request.requestedRoleId)}</span>
                </div>
                <div className="user-permissions-approval-actions">
                  <button
                    className="button primary"
                    type="button"
                    disabled={decidingRequestId === request.id}
                    onClick={() => void decideRegistrationRoleRequest(request, "approve")}
                  >
                    Approve
                  </button>
                  <button
                    className="button"
                    type="button"
                    disabled={decidingRequestId === request.id}
                    onClick={() => void decideRegistrationRoleRequest(request, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="user-permissions-approval-empty">No pending role requests.</p>
        )}
      </section>

      <div className="user-permissions-grid">
        <div className="user-permissions-table-card">
          <table aria-label="Platform users">
            <thead>
              <tr>
                <th scope="col">{renderHeader("user", "User")}</th>
                <th scope="col">{renderHeader("title", "Title")}</th>
                <th scope="col" className="user-permissions-role-header">{renderHeader("role", "Role")}</th>
                <th scope="col">{renderHeader("status", "Status")}</th>
                <th scope="col">{renderHeader("lastActive", "Last active")}</th>
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
                          aria-label={`Role for ${user.name}`}
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
                              {role.name}
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
                        {user.isActive ? `Disable ${user.name}` : `Enable ${user.name}`}
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
            <h3 id="add-user-title">Add user</h3>
            <div className="user-permissions-modal-fields">
              <label className="user-permissions-modal-field">
                <span>Name</span>
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
                <span>Email</span>
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
                <span>Title</span>
                <input className="user-permissions-modal-control" value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="user-permissions-modal-field">
                <span>Initial role</span>
                <select
                  className="user-permissions-modal-control"
                  value={initialRoleId}
                  onChange={(event) => setInitialRoleId(event.target.value as PlatformRoleId)}
                >
                  {platformRoles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
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
                Cancel
              </button>
              <button className="button primary user-permissions-modal-action user-permissions-modal-action--primary" type="submit">
                Create user
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
