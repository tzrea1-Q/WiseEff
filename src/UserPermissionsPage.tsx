import { useMemo, useState, type Dispatch, type FormEvent } from "react";

import type { AppAction } from "@/App";
import { migrateLegacyRoleId, platformRoles, type PlatformRoleId } from "@/domain/users/types";
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
        <span className="eyebrow">Access control</span>
        <h2 id="user-permissions-title">User permissions</h2>
        <p>{state.users.length} platform users across {platformRoles.length} roles.</p>
        <button className="button primary" type="button" onClick={() => setAddUserOpen(true)}>
          Add user
        </button>
      </div>

      <div className="user-permissions-filters" role="search" aria-label="User filters">
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users" />
        </label>
        <label>
          Role
          <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as PlatformRoleId | "all")}>
            <option value="all">All roles</option>
            {platformRoles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
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

        <aside className="user-permissions-capabilities" aria-label="Role capabilities">
          {platformRoles.map((role) => (
            <section key={role.id}>
              <h3>{role.name}</h3>
              <p>{role.description}</p>
              <ul>
                {role.permissions.map((permission) => (
                  <li key={permission}>{permission}</li>
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
