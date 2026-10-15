import { SelectControl } from "@/components/common/SelectControl";
import { TabPanel } from "@/components/ui/tab-panel";
import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent } from "react";
import { RefreshCw, UserPlus } from "lucide-react";

import { canPerform } from "@/app/permissions";
import type { AppAction } from "@/application/state/appState";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { SearchField } from "@/components/common/SearchField";
import { filterItems } from "@/lib/search";
import { userAccountSearchProfile } from "@/lib/search/profiles";
import type { Column } from "@/components/admin";
import { AdminListPage, AdminListPageHeader } from "@/components/layout/AdminListPage";
import { ModalDialog } from "@/components/common/ModalDialog";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MemberDetailsDialog } from "@/components/admin/MemberDetailsDialog";
import { ColumnFilter } from "@/components/ColumnFilter";
import { ViewSwitch } from "@/components/ui/view-switch";
import {
  toggleFilterValue,
  uniqueFilterValues,
  type HeaderFilterConfig,
  type HeaderFilterState
} from "@/components/tableFilterUtils";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { formatLastActive, normalizeTimestampInput } from "@/domain/format/formatLastActive";
import { presentError } from "@/infrastructure/http/presentError";
import { migrateLegacyRoleId, pickPrimaryPlatformRoleId, platformRoles, type PlatformRoleId } from "@/domain/users/types";
import type { PrototypeState, User } from "@/domain/prototype/types";
import type { DataTableSort } from "@/components/admin/DataTable";
import "./user-permissions-page.css";

type UserDirectoryStatus = "loading" | "ready" | "error";

export type UserPermissionsPageProps = {
  state: PrototypeState;
  dispatch: Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  search: string;
  userGovernanceActions?: UserGovernanceActions;
  /** API-mode user-directory hydration lifecycle; mock mode stays "ready". */
  userDirectoryStatus?: UserDirectoryStatus;
  userDirectoryError?: string;
  onUserDirectoryRetry?: () => void;
};

export type UserGovernanceActions = {
  listUsers(): Promise<User[]>;
  createUser(input: { name: string; username: string; title: string; password: string; roleId: PlatformRoleId }): Promise<User | void>;
  assignUserRole(userId: string, roleId: PlatformRoleId): Promise<User | void>;
  setUserActive(userId: string, isActive: boolean): Promise<User | void>;
  deleteUser(userId: string): Promise<void>;
  resetUserPassword?(userId: string, password: string): Promise<User | void>;
  updateUserProfile?(userId: string, input: { name: string; title: string }): Promise<User>;
  listRegistrationRoleRequests?(status?: "pending" | "decided"): Promise<RegistrationRoleRequest[]>;
  approveRegistrationRoleRequest?(requestId: string): Promise<RegistrationRoleRequest | void>;
  rejectRegistrationRoleRequest?(requestId: string): Promise<RegistrationRoleRequest | void>;
  getOrganization?(): Promise<{ id: string; name: string; createdAt: string }>;
  updateOrganization?(input: { name: string }): Promise<{ id: string; name: string; createdAt: string }>;
};

export type RegistrationRoleRequest = {
  id: string;
  organizationId: string;
  organizationName?: string;
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

export const roleLabels: Record<PlatformRoleId, string> = {
  guest: "访客",
  "hardware-user": "硬件开发",
  "software-user": "软件开发",
  "hardware-committer": "硬件MDE",
  "software-committer": "软件MDE",
  admin: "管理员",
  "platform-admin": "平台超级管理员"
};

export const roleCapabilityDescriptions: Record<PlatformRoleId, string> = {
  guest: "仅可查看参数页面。",
  "hardware-user": "硬件侧可查看并提交参数修改，使用参数调试和日志分析。",
  "software-user": "软件侧可查看并提交参数修改，在变更审阅页完成合入推进，并使用参数调试和日志分析。",
  "hardware-committer": "包含硬件开发权限，并可执行硬件侧参数检视。",
  "software-committer": "包含软件开发权限，并可执行软件侧参数检视。",
  admin: "包含全部提交人权限，并可访问各应用后台和组织管理。",
  "platform-admin": "跨组织平台运营角色，在本组织内拥有管理员能力，并可访问平台控制台。"
};

type UserColumnFilterKey = "user" | "title" | "role" | "status" | "lastActive";

type UserPermissionsWorkspace = "accounts" | "approvals";

type PendingGovernanceAction =
  | { kind: "role"; user: User; nextRoleId: PlatformRoleId }
  | { kind: "active"; user: User; nextActive: boolean }
  | { kind: "delete"; user: User };

function roleLabelOf(roleId: PlatformRoleId) {
  const normalizedRoleId = migrateLegacyRoleId(roleId);
  return roleLabels[normalizedRoleId] ?? normalizedRoleId;
}

function canGrantPlatformAdmin(state: PrototypeState) {
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  return organizationRoleOf(currentUser) === "platform-admin";
}

function organizationRoleOf(user?: User) {
  const roles = user?.roles?.filter((role) => role.projectId === null && platformRoles.some((item) => item.id === role.roleId));
  return roles?.length ? pickPrimaryPlatformRoleId(roles.map((role) => role.roleId)) : migrateLegacyRoleId(user?.roleId ?? "guest");
}

function organizationRoleLabels(user: User) {
  const roles = user.roles?.filter((role) => role.projectId === null && platformRoles.some((item) => item.id === role.roleId));
  return [...new Set((roles?.length ? roles.map((role) => role.roleId) : [user.roleId]).map(roleLabelOf))];
}

function isPlatformAdminLocked(state: PrototypeState, user: User) {
  return organizationRoleOf(user) === "platform-admin" && !canGrantPlatformAdmin(state);
}

function visiblePlatformRoles(state: PrototypeState) {
  return platformRoles.filter((role) => role.id !== "platform-admin" || canGrantPlatformAdmin(state));
}

function assignableRolesForUser(state: PrototypeState, userRoleId: PlatformRoleId) {
  const normalizedRoleId = migrateLegacyRoleId(userRoleId);
  return platformRoles.filter(
    (role) => role.id !== "platform-admin" || canGrantPlatformAdmin(state) || normalizedRoleId === "platform-admin"
  );
}

function statusLabelOf(isActive: boolean) {
  return isActive ? "启用" : "停用";
}

function readColumnFilters(search: string): HeaderFilterState {
  const params = new URLSearchParams(search);
  return {
    role: (params.get("roles") ?? "").split(",").filter((id) => platformRoles.some((role) => role.id === id)).map((id) => roleLabelOf(id as PlatformRoleId)),
    status: (params.get("statuses") ?? "").split(",").filter((value) => value === "active" || value === "disabled").map((value) => value === "active" ? "启用" : "停用")
  };
}

function readPage(search: string) {
  const value = Number(new URLSearchParams(search).get("page"));
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function readSort(search: string): DataTableSort {
  const params = new URLSearchParams(search);
  const key = params.get("sort") ?? "user";
  return { key: ["user", "title", "role", "status", "lastActive"].includes(key) ? key : "user", direction: params.get("dir") === "desc" ? "desc" : "asc" };
}

/** Precise-timestamp tooltip for real timestamps; original value when display is 未知. */
function lastActiveTooltip(value: string) {
  const normalized = normalizeTimestampInput(value);
  if (normalized) {
    return formatAbsolute(normalized);
  }
  if (formatLastActive(value) === "未知") {
    return value;
  }
  return undefined;
}

function userColumnFilterValue(user: User, key: UserColumnFilterKey) {
  if (key === "user") {
    return user.name;
  }
  if (key === "title") {
    return user.title;
  }
  if (key === "role") {
    return roleLabelOf(organizationRoleOf(user));
  }
  if (key === "status") {
    return statusLabelOf(user.isActive);
  }
  return formatLastActive(user.lastActive);
}

function userAccountIdentifier(user: User) {
  return user.username ?? user.email ?? "无账号标识";
}

export function UserPermissionsPage({
  state,
  dispatch,
  search,
  userGovernanceActions,
  userDirectoryStatus: userDirectoryStatusOverride,
  userDirectoryError: userDirectoryErrorOverride,
  onUserDirectoryRetry
}: UserPermissionsPageProps) {
  // Governed rows hydrate when the page mounts (the governance client only
  // exists in api mode, so its presence doubles as the mode guard); the page
  // owns the loading/error lifecycle, with the props kept as test overrides.
  const canManageDirectory =
    Boolean(userGovernanceActions) && canPerform(migrateLegacyRoleId(state.activeRoleId), "users.manage");
  const [selfDirectoryStatus, setSelfDirectoryStatus] = useState<UserDirectoryStatus>(
    canManageDirectory ? "loading" : "ready"
  );
  const [selfDirectoryError, setSelfDirectoryError] = useState("");
  const [directoryReloadToken, setDirectoryReloadToken] = useState(0);
  useEffect(() => {
    if (!userGovernanceActions || !canPerform(migrateLegacyRoleId(state.activeRoleId), "users.manage")) {
      return;
    }

    let cancelled = false;
    // First load / retry-after-error shows the skeleton; once hydrated,
    // re-entering the page refreshes in the background without one.
    setSelfDirectoryStatus((current) => (current === "ready" ? current : "loading"));
    userGovernanceActions
      .listUsers()
      .then((users) => {
        if (!cancelled) {
          dispatch({ type: "HYDRATE_USERS", users });
          setSelfDirectoryStatus("ready");
          setSelfDirectoryError("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSelfDirectoryStatus("error");
          setSelfDirectoryError(presentError(error, "无法加载用户名录，请稍后重试。"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [directoryReloadToken, dispatch, state.activeRoleId, userGovernanceActions]);
  const userDirectoryStatus = userDirectoryStatusOverride ?? selfDirectoryStatus;
  const userDirectoryError = userDirectoryErrorOverride ?? selfDirectoryError;
  const handleUserDirectoryRetry =
    onUserDirectoryRetry ?? (() => setDirectoryReloadToken((token) => token + 1));

  const [query, setQuery] = useState(() => new URLSearchParams(search).get("q") ?? "");
  const [columnFilters, setColumnFilters] = useState<HeaderFilterState>(() => readColumnFilters(search));
  const [page, setPage] = useState(() => readPage(search));
  const [sort, setSort] = useState<DataTableSort>(() => readSort(search));
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [addUserError, setAddUserError] = useState("");
  const [addUserPending, setAddUserPending] = useState(false);
  const addUserSubmitting = useRef(false);
  const [initialRoleId, setInitialRoleId] = useState<PlatformRoleId>("hardware-user");
  const [registrationRoleRequests, setRegistrationRoleRequests] = useState<RegistrationRoleRequest[]>([]);
  const [registrationRoleRequestError, setRegistrationRoleRequestError] = useState("");
  const [decidingRequestId, setDecidingRequestId] = useState("");
  const [workspace, setWorkspace] = useState<UserPermissionsWorkspace>(() => new URLSearchParams(search).get("tab") === "approvals" ? "approvals" : "accounts");
  const [approvalView, setApprovalView] = useState<"pending" | "decided">(() => new URLSearchParams(search).get("requests") === "decided" ? "decided" : "pending");
  const [requestStatus, setRequestStatus] = useState<UserDirectoryStatus>("loading");
  const [requestReloadToken, setRequestReloadToken] = useState(0);
  const [pendingRequestDecision, setPendingRequestDecision] = useState<{ request: RegistrationRoleRequest; decision: "approve" | "reject" } | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const selectedMember = state.users.find((user) => user.id === memberId);
  const inactiveWorkspace = workspace === "accounts" ? "approvals" : "accounts";
  const [pendingGovernance, setPendingGovernance] = useState<PendingGovernanceAction | null>(null);
  const [governancePending, setGovernancePending] = useState(false);
  const [governanceError, setGovernanceError] = useState<string | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetPasswordError, setResetPasswordError] = useState("");
  const [resetPasswordPending, setResetPasswordPending] = useState(false);

  const approvalWorkflowEnabled = Boolean(userGovernanceActions?.listRegistrationRoleRequests);
  const pendingApprovalCount = registrationRoleRequests.filter((request) => request.status === "pending").length;

  useEffect(() => {
    const restore = (value: string) => {
      const params = new URLSearchParams(value);
      setQuery(params.get("q") ?? ""); setColumnFilters(readColumnFilters(value));
      setWorkspace(params.get("tab") === "approvals" ? "approvals" : "accounts");
      setApprovalView(params.get("requests") === "decided" ? "decided" : "pending");
      setPage(readPage(value)); setSort(readSort(value));
    };
    restore(search);
    const onPopState = () => restore(window.location.search);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [search]);

  useEffect(() => {
    if (!window.location.pathname.startsWith("/organization/members")) return;
    const url = new URL(window.location.href);
    const values: Record<string, string> = {
      q: query, tab: workspace === "approvals" ? "approvals" : "", requests: approvalView === "decided" ? "decided" : "",
      roles: (columnFilters.role ?? []).map((label) => platformRoles.find((role) => roleLabelOf(role.id) === label)?.id).filter(Boolean).join(","),
      statuses: (columnFilters.status ?? []).map((label) => label === "启用" ? "active" : "disabled").join(","),
      page: page > 1 ? String(page) : "", sort: sort.key === "user" && sort.direction === "asc" ? "" : sort.key,
      dir: sort.direction === "desc" ? "desc" : ""
    };
    Object.entries(values).forEach(([key, value]) => { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); });
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [query, columnFilters, workspace, approvalView, page, sort]);

  function applyUpdatedUser(user: User) {
    dispatch({ type: "HYDRATE_USERS", users: state.users.map((current) => current.id === user.id ? user : current) });
  }

  function clearFilters() { setQuery(""); setColumnFilters({}); setPage(1); }

  const filteredUsers = useMemo(
    () => {
      const searched = filterItems(state.users, query, userAccountSearchProfile);
      return searched.filter((user) => {
        const matchesColumnFilters = (["user", "title", "role", "status", "lastActive"] as UserColumnFilterKey[]).every((key) => {
          const selectedValues = columnFilters[key] ?? [];
          if (key === "role") return selectedValues.length === 0 || selectedValues.some((value) => organizationRoleLabels(user).includes(value));
          return selectedValues.length === 0 || selectedValues.includes(userColumnFilterValue(user, key));
        });

        return matchesColumnFilters;
      });
    },
    [columnFilters, query, state.users]
  );

  function toggleColumnFilter(key: UserColumnFilterKey, value: string) {
    setPage(1);
    setColumnFilters((current) => ({
      ...current,
      [key]: toggleFilterValue(current[key] ?? [], value)
    }));
  }

  function clearColumnFilter(key: UserColumnFilterKey) {
    setColumnFilters((current) => ({ ...current, [key]: [] }));
  }

  function headerFilterConfig(key: UserColumnFilterKey, label: string): HeaderFilterConfig<User> {
    return {
      label,
      groupLabel: `${label}筛选`,
      values: key === "role" ? [...new Set(state.users.flatMap(organizationRoleLabels))].sort((a, b) => a.localeCompare(b, "zh-CN")) : uniqueFilterValues(state.users, (user) => userColumnFilterValue(user, key)),
      selectedValues: columnFilters[key] ?? [],
      getValue: (user) => userColumnFilterValue(user, key),
      onToggle: (value) => toggleColumnFilter(key, value),
      onClear: () => clearColumnFilter(key)
    };
  }

  useEffect(() => {
    if (!approvalWorkflowEnabled && workspace === "approvals") {
      setWorkspace("accounts");
    }
  }, [approvalWorkflowEnabled, workspace]);

  useEffect(() => {
    if (!userGovernanceActions?.listRegistrationRoleRequests) {
      setRegistrationRoleRequests([]);
      return;
    }

    let cancelled = false;
    setRequestStatus("loading");
    setRegistrationRoleRequestError("");
    userGovernanceActions
      .listRegistrationRoleRequests(approvalView)
      .then((items) => {
        if (!cancelled) {
          setRegistrationRoleRequests(items);
          setRequestStatus("ready");
          setRegistrationRoleRequestError("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRegistrationRoleRequestError(presentError(error, "加载注册角色申请失败，请稍后重试。"));
          setRequestStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [userGovernanceActions, approvalView, requestReloadToken]);

  async function decideRegistrationRoleRequest(request: RegistrationRoleRequest, decision: "approve" | "reject") {
    if (decidingRequestId) return;
    setRegistrationRoleRequestError("");
    setDecidingRequestId(request.id);

    try {
      if (decision === "approve") {
        if (!userGovernanceActions?.approveRegistrationRoleRequest) {
          throw new Error("注册角色申请审批尚未启用。");
        }
        await userGovernanceActions.approveRegistrationRoleRequest(request.id);
        dispatch({ type: "ASSIGN_USER_ROLE", userId: request.userId, roleId: request.requestedRoleId });
        dispatch({ type: "TOGGLE_USER_ACTIVE", userId: request.userId, isActive: true });
      } else {
        if (!userGovernanceActions?.rejectRegistrationRoleRequest) {
          throw new Error("注册角色申请拒绝尚未启用。");
        }
        await userGovernanceActions.rejectRegistrationRoleRequest(request.id);
      }
      setRegistrationRoleRequests((items) => items.filter((item) => item.id !== request.id));
      setPendingRequestDecision(null);
      dispatch({ type: "ADD_NOTIFICATION", message: `${decision === "approve" ? "已通过并启用" : "已拒绝"} ${request.userName} 的注册申请` });
      setDirectoryReloadToken((value) => value + 1);
    } catch (error) {
      setRegistrationRoleRequestError(presentError(error, "注册角色申请处理失败，请稍后重试。"));
    } finally {
      setDecidingRequestId("");
    }
  }

  // Role and activation changes are irreversible-in-effect governance actions:
  // both go through a light confirm dialog and an awaited, error-projected call.
  async function confirmGovernanceAction() {
    if (!pendingGovernance || governancePending) return;
    setGovernancePending(true);
    setGovernanceError(null);
    try {
      if (pendingGovernance.kind === "role") {
        const updated = await userGovernanceActions?.assignUserRole(pendingGovernance.user.id, pendingGovernance.nextRoleId);
        dispatch({
          type: "ASSIGN_USER_ROLE",
          userId: pendingGovernance.user.id,
          roleId: pendingGovernance.nextRoleId
        });
        if (updated) applyUpdatedUser(updated);
        dispatch({ type: "ADD_NOTIFICATION", message: `已更新 ${pendingGovernance.user.name} 的组织角色` });
      } else if (pendingGovernance.kind === "active") {
        await userGovernanceActions?.setUserActive(pendingGovernance.user.id, pendingGovernance.nextActive);
        dispatch({
          type: "TOGGLE_USER_ACTIVE",
          userId: pendingGovernance.user.id,
          isActive: pendingGovernance.nextActive
        });
      } else {
        await userGovernanceActions?.deleteUser(pendingGovernance.user.id);
        dispatch({ type: "DELETE_USER", userId: pendingGovernance.user.id });
        dispatch({ type: "ADD_NOTIFICATION", message: `已注销用户 ${pendingGovernance.user.name}` });
      }
      setPendingGovernance(null);
    } catch (error) {
      // Server refusals (e.g. self-lock protection) must be visible, not swallowed.
      setGovernanceError(presentError(error, "用户治理操作失败，请稍后重试。"));
    } finally {
      setGovernancePending(false);
    }
  }

  async function handleAddUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addUserSubmitting.current) return;
    const trimmedName = name.trim();
    const trimmedUsername = username.trim();
    const trimmedTitle = title.trim();

    if (!trimmedName || !trimmedUsername || !password) {
      setAddUserError("姓名、用户名和初始密码不能为空。");
      return;
    }

    if (password !== confirmPassword) {
      setAddUserError("两次输入的密码不一致。");
      return;
    }

    addUserSubmitting.current = true;
    setAddUserPending(true);
    try {
      const createdUser = await userGovernanceActions?.createUser({
        name: trimmedName,
        username: trimmedUsername,
        title: trimmedTitle,
        password,
        roleId: initialRoleId
      });
      dispatch({
        type: "ADD_USER",
        id: createdUser?.id,
        name: createdUser?.name ?? trimmedName,
        username: createdUser?.username ?? trimmedUsername,
        title: createdUser?.title ?? trimmedTitle,
        roleId: createdUser?.roleId ?? initialRoleId
      });
    } catch (error) {
      setAddUserError(presentError(error, "创建用户失败，请稍后重试。"));
      return;
    } finally {
      addUserSubmitting.current = false;
      setAddUserPending(false);
    }

    setAddUserOpen(false);
    setName("");
    setUsername("");
    setTitle("");
    setPassword("");
    setConfirmPassword("");
    setAddUserError("");
    setInitialRoleId("hardware-user");
    dispatch({ type: "ADD_NOTIFICATION", message: `已创建并启用 ${trimmedName} 的账号` });
  }

  function dismissAddUser() {
    if (addUserSubmitting.current) return;
    setAddUserOpen(false); setName(""); setUsername(""); setTitle(""); setPassword(""); setConfirmPassword(""); setAddUserError(""); setInitialRoleId("hardware-user");
  }

  function openResetPassword(user: User) {
    setResetPasswordUser(user);
    setResetPassword("");
    setResetConfirmPassword("");
    setResetPasswordError("");
  }

  async function handleResetPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetPasswordUser || !userGovernanceActions?.resetUserPassword || resetPasswordPending) {
      return;
    }
    if (resetPassword.length < 8) {
      setResetPasswordError("密码至少需要 8 个字符。");
      return;
    }
    if (resetPassword !== resetConfirmPassword) {
      setResetPasswordError("两次输入的密码不一致。");
      return;
    }
    setResetPasswordPending(true);
    setResetPasswordError("");
    try {
      await userGovernanceActions.resetUserPassword(resetPasswordUser.id, resetPassword);
      dispatch({ type: "ADD_NOTIFICATION", message: `已重置 ${resetPasswordUser.name} 的密码，其全部会话已退出` });
      setResetPasswordUser(null);
      setResetPassword("");
      setResetConfirmPassword("");
    } catch (error) {
      setResetPasswordError(presentError(error, "重置密码失败，请稍后重试。"));
    } finally {
      setResetPasswordPending(false);
    }
  }

  const accountColumns: Array<Column<User>> = [
    {
      key: "user",
      header: "用户",
      sortAccessor: (user) => user.name,
      render: (user) => (
        <div className="member-identity">
          <strong>{user.name}{user.id === state.currentUserId ? <Badge variant="secondary">我</Badge> : null}</strong>
          <span>{userAccountIdentifier(user)}</span>
        </div>
      )
    },
    {
      key: "title",
      header: "职务",
      sortAccessor: (user) => user.title,
      render: (user) => user.title || <span className="member-list-meta">未填写</span>
    },
    {
      key: "role",
      header: "组织角色",
      sortAccessor: (user) => roleLabelOf(organizationRoleOf(user)),
      headerFilter: <ColumnFilter compact label="组织角色" groupLabel="组织角色筛选"
        values={[...new Set(state.users.flatMap(organizationRoleLabels))].sort((a, b) => a.localeCompare(b, "zh-CN"))}
        selectedValues={columnFilters.role ?? []} onToggle={(value) => toggleColumnFilter("role", value)} onClear={() => clearColumnFilter("role")} />,
      render: (user) => {
        const roles = [...new Set((user.roles ?? []).filter((role) => role.projectId === null && platformRoles.some((item) => item.id === role.roleId)).map((role) => role.roleId))];
        return <span className="member-role-label" title={roles.map(roleLabelOf).join("、")}>{roleLabelOf(organizationRoleOf(user))}{roles.length > 1 ? <span className="member-list-meta"> +{roles.length - 1}</span> : null}</span>;
      }
    },
    {
      key: "projectRoles",
      header: "项目职责",
      render: (user) => {
        const projectBindings = (user.roles ?? []).filter(
          (r) => r.projectId !== null && !r.roleId.startsWith("catalog-capability-")
        );
        return (
          <span title={projectBindings.map((binding) => `${state.configDraft.projects.find((project) => project.id === binding.projectId)?.name ?? binding.projectId}：${roleLabelOf(binding.roleId)}`).join("；")}>
            {projectBindings.length ? `${new Set(projectBindings.map((binding) => binding.projectId)).size} 个项目` : "未分配"}
          </span>
        );
      }
    },
    {
      key: "status",
      header: "状态",
      sortAccessor: (user) => statusLabelOf(user.isActive),
      headerFilter: headerFilterConfig("status", "状态"),
      render: (user) => <span className="member-status" data-active={user.isActive}>{statusLabelOf(user.isActive)}</span>
    },
    {
      key: "lastActive",
      header: "最近活跃",
      sortAccessor: (user) => { const value = normalizeTimestampInput(user.lastActive); return value ? new Date(value).getTime() : 0; },
      render: (user) => <span title={lastActiveTooltip(user.lastActive)}>{user.lastActive === "never" ? "从未登录" : formatLastActive(user.lastActive)}</span>
    }
  ];

  return (
    <section className="user-permissions-page" aria-label="用户权限">
      <AdminListPageHeader label="平台用户" className="user-permissions-toolbar" content={
        approvalWorkflowEnabled ? (
          <ViewSwitch
            variant="tabs"
            ariaLabel="用户权限工作区"
            value={workspace}
            onValueChange={(value) => setWorkspace(value as UserPermissionsWorkspace)}
            items={[
              { value: "accounts", label: "成员列表", id: "user-permissions-workspace-accounts", panelId: "user-permissions-workspace-accounts-panel" },
              {
                value: "approvals",
                label: <><span>注册申请</span>{approvalView === "pending" && requestStatus === "ready" && pendingApprovalCount > 0 ? <span className="user-permissions-workspace-tab-count">{pendingApprovalCount}</span> : null}</>,
                id: "user-permissions-workspace-approvals",
                panelId: "user-permissions-workspace-approvals-panel"
              }
            ]}
          />
        ) : (
          <div className="user-permissions-workspace-heading">
            <span className="eyebrow">用户治理</span>
            <h2>成员列表</h2>
          </div>
        )} actions={workspace === "accounts" ? <button className="button primary user-permissions-primary-action" type="button" onClick={() => setAddUserOpen(true)}>
          <UserPlus size={16} aria-hidden="true" /><span>添加用户</span>
        </button> : null} />

      {approvalWorkflowEnabled && workspace === "accounts" && approvalView === "pending" && requestStatus === "ready" && pendingApprovalCount > 0 ? (
        <p className="user-permissions-pending-hint">
          当前有 <strong>{pendingApprovalCount}</strong> 条注册角色申请待处理。
          <button type="button" className="user-permissions-pending-hint__action" onClick={() => setWorkspace("approvals")}>
            前往处理
          </button>
        </p>
      ) : null}

      {workspace === "accounts" ? (
        <>
          <TabPanel
            className="user-permissions-grid"
            role={approvalWorkflowEnabled ? "tabpanel" : undefined}
            id="user-permissions-workspace-accounts-panel"
            aria-labelledby={approvalWorkflowEnabled ? "user-permissions-workspace-accounts" : undefined}
          >
            <AdminListPage label="平台用户" headerActions={null}
              filterBar={
                      <div className="user-permissions-filters" role="search" aria-label="用户筛选">
                  <label className="admin-list-page__filter-field user-permissions-filter-field user-permissions-filter-field--search">
                    <span className="user-permissions-filter-label">搜索</span>
                    <SearchField value={query} onValueChange={(value) => { setQuery(value); setPage(1); }} placeholder="搜索姓名、账号或职务" ariaLabel="搜索用户" />
                  </label>
                  <span className="member-list-meta" role="status">{filteredUsers.length === state.users.length ? `共 ${state.users.length} 位成员` : `找到 ${filteredUsers.length} / ${state.users.length} 位成员`}</span>
                  {filteredUsers.length > 0 && (query || Object.values(columnFilters).some((values) => values.length)) ? <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>清除筛选条件</Button> : null}
                </div>}
              tableState={userDirectoryStatus === "loading" ? <SectionSkeleton label="正在加载用户名录" />
                : userDirectoryStatus === "error" ? <SectionError message={userDirectoryError || "无法加载用户名录，请稍后重试。"} onRetry={handleUserDirectoryRetry} /> : undefined}
              table={{ ariaLabel: "平台用户", rows: filteredUsers, rowKey: (user) => user.id, columns: accountColumns,
                page, onPageChange: setPage, sort, onSort: (key) => { setSort({ key, direction: sort.key === key && sort.direction === "asc" ? "desc" : "asc" }); setPage(1); } }}
              emptyState={{ message: state.users.length === 0 ? "还没有任何用户，点击右上角「添加用户」创建第一个账号。" : "没有符合筛选条件的用户，请调整搜索或筛选条件。",
                actionLabel: state.users.length === 0 ? "添加用户" : "清除筛选条件", onAction: () => {
                  if (state.users.length === 0) setAddUserOpen(true);
                  else clearFilters();
                } }}
              rowActions={(user) => {
                const locked = isPlatformAdminLocked(state, user);
                const disabledReason = user.id === state.currentUserId ? "不能注销当前登录账号。"
                  : locked ? "只有平台超级管理员可以注销平台超级管理员。" : undefined;
                return {
                  label: `${user.name} 操作`,
                  primaryAction: { id: "details", label: "查看", ariaLabel: `查看 ${user.name} 的成员资料`, onSelect: () => setMemberId(user.id) },
                  items: [
                    ...(userGovernanceActions?.resetUserPassword ? [{ id: "password", label: "重置密码", ariaLabel: `重置 ${user.name} 的密码`, onSelect: () => openResetPassword(user) }] : []),
                    { id: "active", label: user.isActive ? "停用" : "启用", disabled: user.id === state.currentUserId || locked,
                      description: user.id === state.currentUserId ? "不能停用当前登录账号。" : locked ? "只有平台超级管理员可以停用平台超级管理员。" : undefined,
                      onSelect: () => { setGovernanceError(null); setPendingGovernance({ kind: "active", user, nextActive: !user.isActive }); } },
                    { id: "delete", label: "注销", ariaLabel: `注销 ${user.name}`, destructive: true as const,
                      disabled: Boolean(disabledReason), description: disabledReason, descriptionId: disabledReason ? `delete-user-reason-${user.id}` : undefined,
                      onRequestConfirmation: () => { setGovernanceError(null); setPendingGovernance({ kind: "delete", user }); } }
                  ]
                };
              }} />
            {filteredUsers.filter((user) => user.id === state.currentUserId || isPlatformAdminLocked(state, user)).map((user) =>
              <span key={user.id} id={`delete-user-reason-${user.id}`} className="sr-only">
                {user.id === state.currentUserId ? "不能注销当前登录账号。" : "只有平台超级管理员可以注销平台超级管理员。"}
              </span>)}
          </TabPanel>
        </>
      ) : (
        <TabPanel
          className="user-permissions-approval-queue"
          role="tabpanel"
          id="user-permissions-workspace-approvals-panel"
          aria-labelledby="user-permissions-workspace-approvals"
          aria-label="注册角色申请"
        >
          <div className="user-permissions-approval-queue__header">
            <div>
              <p className="user-permissions-approval-queue__hint">核对申请人的组织与角色后审批，通过将立即启用账号。</p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={requestStatus === "loading" || Boolean(decidingRequestId)} onClick={() => setRequestReloadToken((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" />刷新申请</Button>
          </div>
          <ViewSwitch variant="toggle" ariaLabel="申请范围" value={approvalView} onValueChange={(value) => { if (!decidingRequestId) setApprovalView(value as "pending" | "decided"); }} items={[
            { value: "pending", label: "待处理", disabled: Boolean(decidingRequestId) }, { value: "decided", label: "处理历史", disabled: Boolean(decidingRequestId) }
          ]} />
          {requestStatus === "loading" ? <SectionSkeleton label="正在加载注册申请" />
            : requestStatus === "error" ? <SectionError message={registrationRoleRequestError} onRetry={() => setRequestReloadToken((value) => value + 1)} />
            : registrationRoleRequests.length > 0 ? (
            <div className="user-permissions-approval-list">
              {registrationRoleRequests.map((request) => (
                <article className="user-permissions-approval-item" key={request.id}>
                  <div className="user-permissions-approval-user">
                    <strong>{request.userName}</strong>
                    <span>{request.username ?? request.userId}</span>
                    <span className="member-approval-item-meta">{request.organizationName ?? request.organizationId}</span>
                    <time className="member-approval-item-meta" dateTime={request.createdAt}>申请于 {formatAbsolute(request.createdAt)}</time>
                  </div>
                  <div className="user-permissions-approval-role-change">
                    <span>{roleLabelOf(request.currentRoleId)}</span>
                    <span aria-hidden="true">→</span>
                    <span>{roleLabelOf(request.requestedRoleId)}</span>
                  </div>
                  <div className="user-permissions-approval-actions">
                    {request.status === "pending" ? <>
                    <button
                      className="button primary"
                      type="button"
                      disabled={Boolean(decidingRequestId)}
                      onClick={() => { setRegistrationRoleRequestError(""); setPendingRequestDecision({ request, decision: "approve" }); }}
                    >
                      通过
                    </button>
                    <button
                      className="button"
                      type="button"
                      disabled={Boolean(decidingRequestId)}
                      onClick={() => { setRegistrationRoleRequestError(""); setPendingRequestDecision({ request, decision: "reject" }); }}
                    >
                      拒绝
                    </button>
                    </> : <div><Badge variant={request.status === "approved" ? "secondary" : "outline"}>{request.status === "approved" ? "已通过" : "已拒绝"}</Badge>
                      {request.decidedAt ? <p className="member-approval-item-meta">{formatAbsolute(request.decidedAt)}</p> : null}</div>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <SectionEmpty message={approvalView === "pending" ? "暂无待处理角色申请。" : "暂无已处理的注册申请。"} />
          )}
        </TabPanel>
      )}

      {approvalWorkflowEnabled ? (
        <div hidden role="tabpanel"
          id={`user-permissions-workspace-${inactiveWorkspace}-panel`}
          aria-labelledby={`user-permissions-workspace-${inactiveWorkspace}`} />
      ) : null}

      {selectedMember ? <MemberDetailsDialog key={selectedMember.id} user={selectedMember} state={state} actions={userGovernanceActions}
        onUpdated={applyUpdatedUser} onClose={() => { setMemberId(null); setDirectoryReloadToken((value) => value + 1); }} roleLabel={roleLabelOf}
        roleEditor={<>
          <SelectControl className="user-permissions-role-select" ariaLabel={`调整 ${selectedMember.name} 的角色`} withinModal
            value={organizationRoleOf(selectedMember)} disabled={selectedMember.id === state.currentUserId || isPlatformAdminLocked(state, selectedMember)}
            onValueChange={(value) => { if (value !== organizationRoleOf(selectedMember)) { setGovernanceError(null); setPendingGovernance({ kind: "role", user: selectedMember, nextRoleId: value as PlatformRoleId }); } }}
            options={assignableRolesForUser(state, organizationRoleOf(selectedMember)).map((role) => ({ value: role.id, label: roleLabelOf(role.id) }))} />
          <p className="member-details__hint">{roleCapabilityDescriptions[organizationRoleOf(selectedMember)]}</p>
          <p className="member-details__hint">{selectedMember.roles && !selectedMember.roles.some((role) => role.projectId === null && platformRoles.some((item) => item.id === role.roleId))
            ? "未授予组织级角色，项目权限仍独立生效。" : `已授予：${organizationRoleLabels(selectedMember).join("、")}`}</p>
          {selectedMember.id === state.currentUserId ? <p className="member-details__hint">不能调整当前登录账号的角色。</p>
            : isPlatformAdminLocked(state, selectedMember) ? <p className="member-details__hint">只有平台超级管理员可以调整此账号的角色。</p> : null}
        </>} /> : null}

      <ConfirmDialog open={pendingRequestDecision !== null} title={pendingRequestDecision?.decision === "approve" ? "通过注册申请？" : "拒绝注册申请？"}
        description={pendingRequestDecision ? <div><p>{pendingRequestDecision.request.userName} · {pendingRequestDecision.request.organizationName ?? pendingRequestDecision.request.organizationId}</p>
          <p>申请角色：{roleLabelOf(pendingRequestDecision.request.requestedRoleId)}</p>
          <p>{roleCapabilityDescriptions[pendingRequestDecision.request.requestedRoleId]}</p>
          <p>{pendingRequestDecision.decision === "approve" ? "通过后立即启用账号，并授予上述组织角色。" : "拒绝后，该注册角色申请将结束处理。"}</p></div> : undefined}
        confirmLabel={pendingRequestDecision?.decision === "approve" ? "通过并启用" : "确认拒绝"} tone={pendingRequestDecision?.decision === "approve" ? "primary" : "danger"}
        pending={Boolean(decidingRequestId)} error={registrationRoleRequestError || null}
        onCancel={() => { if (!decidingRequestId) { setPendingRequestDecision(null); setRegistrationRoleRequestError(""); } }}
        onConfirm={() => { if (pendingRequestDecision) void decideRegistrationRoleRequest(pendingRequestDecision.request, pendingRequestDecision.decision); }} />

      <ConfirmDialog
        open={pendingGovernance !== null}
        title={
          pendingGovernance?.kind === "role"
            ? "确认调整用户角色"
            : pendingGovernance?.kind === "delete"
              ? "确认注销用户"
              : pendingGovernance?.nextActive
                ? "确认启用用户"
                : "确认停用用户"
        }
        description={
          pendingGovernance ? (
            pendingGovernance.kind === "role" ? (
              <div>
                <p>
                  将把 <strong>{pendingGovernance.user.name}</strong> 的组织角色从「
                  {roleLabelOf(organizationRoleOf(pendingGovernance.user))}」调整为「
                  {roleLabelOf(pendingGovernance.nextRoleId)}」，新权限立即生效。
                </p>
                <p className="member-details__hint">{roleCapabilityDescriptions[pendingGovernance.nextRoleId]}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  注意：本次修改仅更新组织级内置角色，该用户在各项目中的项目审核角色与职责绑定将完整保留。
                </p>
              </div>
            ) : pendingGovernance.kind === "delete" ? (
              <p>
                将永久删除 <strong>{pendingGovernance.user.name}</strong>（
                {userAccountIdentifier(pendingGovernance.user)}）。账号的角色、凭据、会话和临时数据将一并清除；业务与审计历史记录会保留，
                历史记录中的用户关联会解除。此操作不可恢复。
              </p>
            ) : pendingGovernance.nextActive ? (
              <p>
                将启用 <strong>{pendingGovernance.user.name}</strong>（
                {userAccountIdentifier(pendingGovernance.user)}），该账号将恢复登录与操作权限。
              </p>
            ) : (
              <p>
                将停用 <strong>{pendingGovernance.user.name}</strong>（
                {userAccountIdentifier(pendingGovernance.user)}），停用后该账号无法登录平台。
              </p>
            )
          ) : null
        }
        confirmLabel={
          pendingGovernance?.kind === "role"
            ? "确认调整"
            : pendingGovernance?.kind === "delete"
              ? "确认注销"
              : pendingGovernance?.nextActive
                ? "确认启用"
                : "确认停用"
        }
        tone={
          pendingGovernance?.kind === "delete" ||
          (pendingGovernance?.kind === "active" && !pendingGovernance.nextActive)
            ? "danger"
            : "primary"
        }
        pending={governancePending}
        pendingLabel={pendingGovernance?.kind === "delete" ? "注销中…" : "提交中…"}
        error={governanceError}
        onCancel={() => {
          if (governancePending) return;
          setPendingGovernance(null);
          setGovernanceError(null);
        }}
        onConfirm={() => void confirmGovernanceAction()}
      />

      {addUserOpen && (
        <ModalDialog
          open
          onDismiss={addUserPending ? undefined : dismissAddUser}
          className="user-permissions-modal-card modal-card--sm"
          backdropClassName="user-permissions-modal"
        >
          {({ titleId }) => (
          <form className="modal-form-contents" onSubmit={handleAddUserSubmit} aria-busy={addUserPending}>
            <h3 id={titleId}>添加用户</h3>
            <fieldset className="user-permissions-modal-fields" disabled={addUserPending}>
              <p className="member-details__hint">创建本组织的本地账号，创建后立即启用。职务选填，其余为必填项。</p>
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
                <span>用户名</span>
                <input
                  className="user-permissions-modal-control"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setAddUserError("");
                  }}
                  autoComplete="username"
                  aria-label="用户名"
                  minLength={3}
                  maxLength={64}
                  aria-describedby="member-username-hint"
                  required
                />
                <span id="member-username-hint" className="member-details__hint">3–64 个字符，用于登录。</span>
              </label>
              <label className="user-permissions-modal-field">
                <span>职务</span>
                <input className="user-permissions-modal-control" value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className="user-permissions-modal-field">
                <span>初始密码</span>
                <input
                  className="user-permissions-modal-control"
                  type="password"
                  value={password}
                  minLength={8}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setAddUserError("");
                  }}
                  autoComplete="new-password"
                  aria-label="初始密码"
                  aria-describedby="member-password-hint"
                  required
                />
                <span id="member-password-hint" className="member-details__hint">至少 8 个字符，请通过可信方式交给成员。</span>
              </label>
              <label className="user-permissions-modal-field">
                <span>确认密码</span>
                <input
                  className="user-permissions-modal-control"
                  type="password"
                  value={confirmPassword}
                  minLength={8}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setAddUserError("");
                  }}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="user-permissions-modal-field">
                <span>初始角色</span>
                <SelectControl
                  className="user-permissions-modal-control"
                  ariaLabel="初始角色"
                  value={initialRoleId}
                  onValueChange={setInitialRoleId}
                  options={visiblePlatformRoles(state).map((role) => ({ value: role.id, label: roleLabelOf(role.id) }))}
                />
              </label>
              <p className="member-details__hint">{roleCapabilityDescriptions[initialRoleId]}</p>
              {addUserError ? <p role="alert" className="user-permissions-modal-error">{addUserError}</p> : null}
            </fieldset>
            <div className="user-permissions-modal-actions">
              <button
                className="button user-permissions-modal-action user-permissions-modal-action--secondary"
                type="button"
                disabled={addUserPending}
                onClick={dismissAddUser}
              >
                取消
              </button>
              <button className="button primary user-permissions-modal-action user-permissions-modal-action--primary" type="submit" disabled={addUserPending}>
                {addUserPending ? "创建中…" : "创建用户"}
              </button>
            </div>
          </form>
          )}
        </ModalDialog>
      )}

      {resetPasswordUser && userGovernanceActions?.resetUserPassword ? (
        <ModalDialog
          open
          onDismiss={resetPasswordPending ? undefined : () => setResetPasswordUser(null)}
          className="user-permissions-modal-card modal-card--sm"
          backdropClassName="user-permissions-modal"
        >
          {({ titleId }) => (
            <form className="modal-form-contents" onSubmit={handleResetPasswordSubmit}>
              <h3 id={titleId}>重置密码</h3>
              <div className="user-permissions-modal-fields">
                <p className="user-permissions-reset-hint">
                  将为 <strong>{resetPasswordUser.name}</strong>（{userAccountIdentifier(resetPasswordUser)}
                  ）设置新密码，并退出该账号的全部会话。
                </p>
                <label className="user-permissions-modal-field">
                  <span>新密码</span>
                  <input
                    className="user-permissions-modal-control"
                    type="password"
                    value={resetPassword}
                    minLength={8}
                    onChange={(event) => {
                      setResetPassword(event.target.value);
                      setResetPasswordError("");
                    }}
                    autoComplete="new-password"
                    required
                  />
                </label>
                <label className="user-permissions-modal-field">
                  <span>确认新密码</span>
                  <input
                    className="user-permissions-modal-control"
                    type="password"
                    value={resetConfirmPassword}
                    minLength={8}
                    onChange={(event) => {
                      setResetConfirmPassword(event.target.value);
                      setResetPasswordError("");
                    }}
                    autoComplete="new-password"
                    required
                  />
                </label>
                {resetPasswordError ? <p role="alert" className="user-permissions-modal-error">{resetPasswordError}</p> : null}
              </div>
              <div className="user-permissions-modal-actions">
                <button
                  className="button user-permissions-modal-action user-permissions-modal-action--secondary"
                  type="button"
                  disabled={resetPasswordPending}
                  onClick={() => setResetPasswordUser(null)}
                >
                  取消
                </button>
                <button
                  className="button primary user-permissions-modal-action user-permissions-modal-action--primary"
                  type="submit"
                  disabled={resetPasswordPending}
                >
                  {resetPasswordPending ? "提交中…" : "确认重置"}
                </button>
              </div>
            </form>
          )}
        </ModalDialog>
      ) : null}
    </section>
  );
}
