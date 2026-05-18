import { useMemo, useState, type Dispatch, type FormEvent } from "react";
import { UserPlus } from "lucide-react";

import type { AppAction } from "@/App";
import { migrateLegacyRoleId, platformRoles, type PermissionKey, type PlatformRoleId } from "@/domain/users/types";
import type { PrototypeState } from "@/mockData";

type UserPermissionsPageProps = {
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  search: string;
};

const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" }
] as const;

type StatusFilter = (typeof statusOptions)[number]["value"];

const roleCapabilityDescriptions: Record<PlatformRoleId, string> = {
  guest: "仅可查看参数页面。",
  user: "可查看并修改参数，使用参数调试和节点调试，并上传日志进行智能分析。",
  committer: "包含 User 权限，并可审阅参数提交。",
  admin: "包含 Committer 权限，并可访问各应用后台和用户管理。"
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

export function UserPermissionsPage({ state, dispatch, search: _search }: UserPermissionsPageProps) {
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<PlatformRoleId | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [addUserError, setAddUserError] = useState("");
  const [initialRoleId, setInitialRoleId] = useState<PlatformRoleId>("user");

  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = useMemo(
    () =>
      state.users.filter((user) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          [user.name, user.email, user.title].some((value) => value.toLowerCase().includes(normalizedQuery));
        const normalizedRoleId = migrateLegacyRoleId(user.roleId);
        const matchesRole = roleFilter === "all" || normalizedRoleId === roleFilter;
        const matchesStatus =
          statusFilter === "all" || (statusFilter === "active" ? user.isActive : !user.isActive);

        return matchesQuery && matchesRole && matchesStatus;
      }),
    [normalizedQuery, roleFilter, state.users, statusFilter]
  );

  function handleAddUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedTitle = title.trim();

    if (!trimmedName || !trimmedEmail) {
      setAddUserError("Name and email are required.");
      return;
    }

    dispatch({
      type: "ADD_USER",
      name: trimmedName,
      email: trimmedEmail,
      title: trimmedTitle,
      roleId: initialRoleId
    });
    setAddUserOpen(false);
    setName("");
    setEmail("");
    setTitle("");
    setAddUserError("");
    setInitialRoleId("user");
  }

  return (
    <section className="user-permissions-page" aria-labelledby="user-permissions-title">
      <div className="user-permissions-summary">
        <div className="user-permissions-summary__copy">
          <span className="eyebrow">Access control</span>
          <h2 id="user-permissions-title">User permissions</h2>
          <p>{state.users.length} platform users across {platformRoles.length} roles.</p>
        </div>
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

      <div className="user-permissions-grid">
        <div className="user-permissions-table-card">
          <table aria-label="Platform users">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Title</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Last active</th>
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
                      <div>{user.email}</div>
                    </td>
                    <td>{user.title}</td>
                    <td>
                      <select
                        aria-label={`Role for ${user.name}`}
                        value={normalizedRoleId}
                        disabled={isCurrentUser}
                        onChange={(event) =>
                          dispatch({
                            type: "ASSIGN_USER_ROLE",
                            userId: user.id,
                            roleId: event.target.value as PlatformRoleId
                          })
                        }
                      >
                        {platformRoles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className="button"
                        type="button"
                        disabled={isCurrentUser}
                        onClick={() =>
                          dispatch({
                            type: "TOGGLE_USER_ACTIVE",
                            userId: user.id,
                            isActive: !user.isActive
                          })
                        }
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

        <aside className="user-permissions-capabilities" aria-label="角色权限说明">
          {platformRoles.map((role) => (
            <section key={role.id}>
              <h3>{role.name}</h3>
              <p>{roleCapabilityDescriptions[role.id]}</p>
              <ul>
                {role.permissions.map((permission) => (
                  <li key={permission}>{permissionLabels[permission]}</li>
                ))}
              </ul>
            </section>
          ))}
        </aside>
      </div>

      {addUserOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="add-user-title" className="user-permissions-modal">
          <form onSubmit={handleAddUserSubmit}>
            <h3 id="add-user-title">Add user</h3>
            <label>
              Name
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setAddUserError("");
                }}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setAddUserError("");
                }}
                required
              />
            </label>
            <label>
              Title
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              Initial role
              <select value={initialRoleId} onChange={(event) => setInitialRoleId(event.target.value as PlatformRoleId)}>
                {platformRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
            {addUserError ? <p role="alert">{addUserError}</p> : null}
            <div className="user-permissions-modal-actions">
              <button className="button" type="button" onClick={() => setAddUserOpen(false)}>
                Cancel
              </button>
              <button className="button primary" type="submit">
                Create user
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
