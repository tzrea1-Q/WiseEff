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
import { AccountTransferDialog } from "@/features/organization/AccountTransferDialog";
import type { AccountTransferClient } from "@/infrastructure/http/accountTransferClient";
import { MemberOrganizationRolesPanel } from "@/components/admin/MemberOrganizationRolesPanel";
import { SettingsLeaveGuard } from "@/components/layout/SettingsFormPage";
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
import { migrateLegacyRoleId, organizationRoleIds, pickPrimaryPlatformRoleId, platformRoles, type PlatformRoleId } from "@/domain/users/types";
import type { CreateGovernedUserInput, UpdateOrganizationRolesInput, OrganizationTeamsClient, OrganizationTeamDto } from "@/infrastructure/http/userGovernanceClient";
import type { LocalAuthPublicConfigDto } from "@/infrastructure/http/authClient";
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
  teamActions?: OrganizationTeamsClient;
  accountTransferClient?: AccountTransferClient;
  /** Directory state belongs to this explicit organization, never to the shell identity. */
  directoryScope?: string;
  projectCandidates?: Array<{ id: string; name: string }>;
  reviewRolesClient?: import("@/components/parameter-admin-next/ProjectReviewRolesPanel").ProjectReviewRolesPanelProps["userGovernanceClient"];
  /** API-mode user-directory hydration lifecycle; mock mode stays "ready". */
  userDirectoryStatus?: UserDirectoryStatus;
  userDirectoryError?: string;
  onUserDirectoryRetry?: () => void;
  onCurrentAccountChanged?: (accessEnded: boolean) => Promise<void>;
};

export type UserGovernanceActions = {
  listUsers(): Promise<User[]>;
  createUser(input: CreateGovernedUserInput): Promise<User | void>;
  getAuthenticationConfig?(): Promise<LocalAuthPublicConfigDto>;
  setOidcIdentity?(userId: string, input: { issuer: string; subject: string; email?: string; expectedIdentity: { issuer: string; subject: string } | null }): Promise<User>;
  updateOrganizationRoles(userId: string, input: UpdateOrganizationRolesInput): Promise<User | void>;
  setUserActive(userId: string, isActive: boolean): Promise<User | void>;
  deleteUser(userId: string): Promise<void>;
  resetUserPassword?(userId: string, password: string): Promise<User | void>;
  updateUserProfile?(userId: string, input: { name: string; title: string }): Promise<User>;
  listRegistrationRoleRequests?(status?: "pending" | "decided"): Promise<RegistrationRoleRequest[]>;
  approveRegistrationRoleRequest?(requestId: string): Promise<RegistrationRoleRequest | void>;
  rejectRegistrationRoleRequest?(requestId: string): Promise<RegistrationRoleRequest | void>;
  enableBasicRegistrationRoleRequest?(requestId: string): Promise<RegistrationRoleRequest | void>;
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
  decisionOutcome?: "requested-role-enabled" | "basic-enabled" | "rejected-disabled" | "rejected-preserved" | null;
  decisionCanLogin?: boolean | null;
  decisionRoleIds?: PlatformRoleId[] | null;
  accountChanged?: boolean;
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
  "hardware-user": "可查看组织项目，使用参数调试和日志分析；参数修改需配置项目参与和编辑角色。",
  "software-user": "可查看组织项目，使用参数调试和日志分析；参数修改需配置项目参与和编辑角色，合入职责单独配置。",
  "hardware-committer": "包含硬件开发工具权限；参数修改需项目编辑角色，硬件审核职责单独配置。",
  "software-committer": "包含软件开发工具权限；参数修改需项目编辑角色，软件审核职责单独配置。",
  admin: "包含全部提交人权限，并可访问各应用后台和组织管理。",
  "platform-admin": "平台运营角色，在本组织内拥有管理员能力，并可管理平台超级管理员授权。"
};

type UserColumnFilterKey = "user" | "title" | "role" | "status" | "lastActive";

type UserPermissionsWorkspace = "accounts" | "approvals";

type PendingGovernanceAction =
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
  return user ? pickPrimaryPlatformRoleId(organizationRoleIds(user)) : "guest";
}

function organizationRoleLabels(user: User) {
  return organizationRoleIds(user).map(roleLabelOf);
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
  teamActions,
  accountTransferClient,
  directoryScope,
  projectCandidates,
  reviewRolesClient,
  userDirectoryStatus: userDirectoryStatusOverride,
  userDirectoryError: userDirectoryErrorOverride,
  onUserDirectoryRetry,
  onCurrentAccountChanged
}: UserPermissionsPageProps) {
  const [scopedUsers, setScopedUsers] = useState<User[]>([]);
  const [transferringUser, setTransferringUser] = useState<User | null>(null);
  const [transferMessage, setTransferMessage] = useState("");
  const users = directoryScope ? scopedUsers : state.users;
  const projects = projectCandidates ?? state.configDraft.projects;
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
  const [teams, setTeams] = useState<OrganizationTeamDto[] | null>(null), [teamError, setTeamError] = useState("");
  useEffect(() => {
    if (!teamActions) return;
    let cancelled = false;
    setTeams(null); setTeamError("");
    void teamActions.listTeams().then((items) => { if (!cancelled) setTeams(items); })
      .catch((failure: unknown) => { if (!cancelled) setTeamError(presentError(failure, "团队归属加载失败，请刷新名录。")); });
    return () => { cancelled = true; };
  }, [teamActions, directoryReloadToken]);
  const teamNames = (userId: string) => teams?.filter((team) => team.memberIds.includes(userId)).map((team) => team.name).join("、") || "未加入团队";
  const [authentication, setAuthentication] = useState<{ provider: string; oidcIssuer?: string }>({ provider: userGovernanceActions?.getAuthenticationConfig ? "pending" : "local" });
  useEffect(() => {
    if (!userGovernanceActions || !canPerform(migrateLegacyRoleId(state.activeRoleId), "users.manage")) {
      return;
    }

    let cancelled = false;
    // First load / retry-after-error shows the skeleton; once hydrated,
    // re-entering the page refreshes in the background without one.
    setSelfDirectoryStatus((current) => (current === "ready" ? current : "loading"));
    Promise.all([userGovernanceActions.listUsers(), userGovernanceActions.getAuthenticationConfig?.()])
      .then(([users, config]) => {
        if (!cancelled) {
          if (config) setAuthentication(config);
          if (directoryScope) setScopedUsers(users);
          else dispatch({ type: "HYDRATE_USERS", users });
          setSelfDirectoryStatus("ready");
          setSelfDirectoryError("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAuthentication((current) => current.provider === "pending" ? { provider: "unavailable" } : current);
          setSelfDirectoryStatus("error");
          setSelfDirectoryError(presentError(error, "无法加载用户名录，请稍后重试。"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [directoryReloadToken, dispatch, state.activeRoleId, userGovernanceActions, directoryScope]);
  const userDirectoryStatus = userDirectoryStatusOverride ?? selfDirectoryStatus;
  const userDirectoryError = userDirectoryErrorOverride ?? selfDirectoryError;
  const handleUserDirectoryRetry =
    onUserDirectoryRetry ?? (() => setDirectoryReloadToken((token) => token + 1));

  const [query, setQuery] = useState(() => new URLSearchParams(search).get("q") ?? "");
  const [columnFilters, setColumnFilters] = useState<HeaderFilterState>(() => readColumnFilters(search));
  const [page, setPage] = useState(() => readPage(search));
  const [sort, setSort] = useState<DataTableSort>(() => readSort(search));
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [oidcSubject, setOidcSubject] = useState("");
  const [oidcEmail, setOidcEmail] = useState("");
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
  const [pendingRequestDecision, setPendingRequestDecision] = useState<{ request: RegistrationRoleRequest; decision: "approve" | "reject" | "enable-basic" } | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const selectedMember = users.find((user) => user.id === memberId);
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
    // Scoped views follow the shell only after its unsaved-work guard approves Back/Forward.
    if (directoryScope) return;
    const onPopState = () => restore(window.location.search);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [search, directoryScope]);

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
    if (directoryScope) setScopedUsers((current) => current.map((item) => item.id === user.id ? user : item));
    else dispatch({ type: "HYDRATE_USERS", users: state.users.map((current) => current.id === user.id ? user : current) });
  }

  function clearFilters() { setQuery(""); setColumnFilters({}); setPage(1); }

  const filteredUsers = useMemo(
    () => {
      const searched = filterItems(users, query, userAccountSearchProfile);
      return searched.filter((user) => {
        const matchesColumnFilters = (["user", "title", "role", "status", "lastActive"] as UserColumnFilterKey[]).every((key) => {
          const selectedValues = columnFilters[key] ?? [];
          if (key === "role") return selectedValues.length === 0 || selectedValues.some((value) => organizationRoleLabels(user).includes(value));
          return selectedValues.length === 0 || selectedValues.includes(userColumnFilterValue(user, key));
        });

        return matchesColumnFilters;
      });
    },
    [columnFilters, query, users]
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
      values: key === "role" ? [...new Set(users.flatMap(organizationRoleLabels))].sort((a, b) => a.localeCompare(b, "zh-CN")) : uniqueFilterValues(users, (user) => userColumnFilterValue(user, key)),
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

  async function decideRegistrationRoleRequest(request: RegistrationRoleRequest, decision: "approve" | "reject" | "enable-basic") {
    if (decidingRequestId) return;
    setRegistrationRoleRequestError("");
    setDecidingRequestId(request.id);

    try {
      let result: RegistrationRoleRequest | void;
      if (decision === "approve") {
        if (!userGovernanceActions?.approveRegistrationRoleRequest) {
          throw new Error("注册角色申请审批尚未启用。");
        }
        result = await userGovernanceActions.approveRegistrationRoleRequest(request.id);
        if (!directoryScope) {
          dispatch({ type: "ASSIGN_USER_ROLE", userId: request.userId, roleId: request.requestedRoleId });
          dispatch({ type: "TOGGLE_USER_ACTIVE", userId: request.userId, isActive: true });
        }
      } else if (decision === "enable-basic") {
        if (!userGovernanceActions?.enableBasicRegistrationRoleRequest) throw new Error("普通成员启用尚未启用。");
        result = await userGovernanceActions.enableBasicRegistrationRoleRequest(request.id);
        if (!directoryScope) {
          dispatch({ type: "ASSIGN_USER_ROLE", userId: request.userId, roleId: request.currentRoleId });
          dispatch({ type: "TOGGLE_USER_ACTIVE", userId: request.userId, isActive: true });
        }
      } else {
        if (!userGovernanceActions?.rejectRegistrationRoleRequest) {
          throw new Error("注册角色申请拒绝尚未启用。");
        }
        result = await userGovernanceActions.rejectRegistrationRoleRequest(request.id);
      }
      setRegistrationRoleRequests((items) => items.filter((item) => item.id !== request.id));
      setPendingRequestDecision(null);
      const access = result?.decisionCanLogin === undefined || result.decisionCanLogin === null ? ""
        : `；${result.decisionCanLogin ? "可登录" : "不可登录"} · ${result.decisionRoleIds?.map(roleLabelOf).join("、") || "未分配组织角色"}`;
      dispatch({ type: "ADD_NOTIFICATION", message: `${decision === "approve" ? "已批准申请角色并启用：" : decision === "enable-basic" ? "已拒绝提升并按普通成员启用：" : "已拒绝提升，保留账号设置："}${request.userName}${access}` });
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
      const self = pendingGovernance.user.id === state.currentUserId;
      if (pendingGovernance.kind === "active") {
        await userGovernanceActions?.setUserActive(pendingGovernance.user.id, pendingGovernance.nextActive);
        if (self && !pendingGovernance.nextActive && onCurrentAccountChanged) {
          setPendingGovernance(null);
          await onCurrentAccountChanged(true);
          return;
        }
        if (directoryScope) setScopedUsers((users) => users.map((user) => user.id === pendingGovernance.user.id ? { ...user, isActive: pendingGovernance.nextActive } : user));
        else dispatch({
          type: "TOGGLE_USER_ACTIVE",
          userId: pendingGovernance.user.id,
          isActive: pendingGovernance.nextActive
        });
        dispatch({ type: "ADD_NOTIFICATION", message: pendingGovernance.nextActive ? `已启用用户 ${pendingGovernance.user.name}，请重新登录；原会话和设备配对不会恢复` : `已停用用户 ${pendingGovernance.user.name}，个人会话和设备配对已撤销，业务交接可随后完成` });
      } else {
        await userGovernanceActions?.deleteUser(pendingGovernance.user.id);
        if (self && onCurrentAccountChanged) {
          setPendingGovernance(null);
          await onCurrentAccountChanged(true);
          return;
        }
        if (directoryScope) setScopedUsers((users) => users.filter((user) => user.id !== pendingGovernance.user.id));
        else dispatch({ type: "DELETE_USER", userId: pendingGovernance.user.id });
        dispatch({ type: "ADD_NOTIFICATION", message: `已注销用户 ${pendingGovernance.user.name}` });
      }
      setPendingGovernance(null);
    } catch (error) {
      // Server refusals (including last-administrator protection) remain visible.
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

    const oidc = authentication.provider === "oidc";
    if (oidc ? !trimmedName || !oidcSubject.trim() || !authentication.oidcIssuer : !trimmedName || !trimmedUsername || !password) {
      setAddUserError(oidc ? "姓名、配置的 Issuer 和 Subject 不能为空。" : "姓名、用户名和初始密码不能为空。");
      return;
    }

    if (!oidc && password !== confirmPassword) {
      setAddUserError("两次输入的密码不一致。");
      return;
    }

    addUserSubmitting.current = true;
    setAddUserPending(true);
    try {
      const createdUser = await userGovernanceActions?.createUser(oidc ? {
        authentication: "oidc", issuer: authentication.oidcIssuer!, subject: oidcSubject, ...(oidcEmail.trim() ? { email: oidcEmail.trim() } : {}), name: trimmedName, title: trimmedTitle, roleId: initialRoleId
      } : {
        name: trimmedName,
        username: trimmedUsername,
        title: trimmedTitle,
        password,
        roleId: initialRoleId
      });
      if (directoryScope && createdUser) setScopedUsers((users) => [...users.filter((user) => user.id !== createdUser.id), createdUser]);
      else if (oidc && createdUser) dispatch({ type: "HYDRATE_USERS", users: [...state.users.filter((user) => user.id !== createdUser.id), createdUser] });
      else dispatch({
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
    setOidcSubject(""); setOidcEmail("");
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
    setAddUserOpen(false); setName(""); setUsername(""); setTitle(""); setPassword(""); setConfirmPassword(""); setOidcSubject(""); setOidcEmail(""); setAddUserError(""); setInitialRoleId("hardware-user");
  }

  function openResetPassword(user: User) {
    setResetPasswordUser(user);
    setResetPassword("");
    setResetConfirmPassword("");
    setResetPasswordError("");
  }

  function dismissResetPassword() {
    if (resetPasswordPending) return;
    setResetPasswordUser(null); setResetPassword(""); setResetConfirmPassword(""); setResetPasswordError("");
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
          <span className="member-list-meta">{user.oidcTransfer?.status === "pending" ? "OIDC · 等待身份系统同步" : user.oidcIdentity ? "OIDC · 已绑定" : authentication.provider === "oidc" ? "OIDC · 未显式绑定" : user.username ? "本地账号" : "外部身份"}</span>
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
        values={[...new Set(users.flatMap(organizationRoleLabels))].sort((a, b) => a.localeCompare(b, "zh-CN"))}
        selectedValues={columnFilters.role ?? []} onToggle={(value) => toggleColumnFilter("role", value)} onClear={() => clearColumnFilter("role")} />,
      render: (user) => {
        const roles = organizationRoleIds(user);
        return <span className="member-role-label" title={roles.map(roleLabelOf).join("、")}>{roles.length ? roleLabelOf(organizationRoleOf(user)) : "未授予组织级角色"}{roles.length > 1 ? <span className="member-list-meta"> +{roles.length - 1}</span> : null}</span>;
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
          <span title={projectBindings.map((binding) => `${projects.find((project) => project.id === binding.projectId)?.name ?? binding.projectId}：${roleLabelOf(binding.roleId)}`).join("；")}>
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
  if (teamActions) accountColumns.splice(2, 0, { key: "teams", header: "团队", render: (user) => teamError ? "加载失败" : teams ? teamNames(user.id) : "正在加载" });

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
        )} actions={workspace === "accounts" ? <button className="button primary user-permissions-primary-action" type="button" disabled={["pending","unavailable"].includes(authentication.provider)} onClick={() => setAddUserOpen(true)}>
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
          {teamError ? <SectionError message={teamError} onRetry={() => setDirectoryReloadToken((value) => value + 1)} /> : null}
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
                  <span className="member-list-meta" role="status">{filteredUsers.length === users.length ? `共 ${users.length} 位成员` : `找到 ${filteredUsers.length} / ${users.length} 位成员`}</span>
                  {filteredUsers.length > 0 && (query || Object.values(columnFilters).some((values) => values.length)) ? <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>清除筛选条件</Button> : null}
                </div>}
              tableState={userDirectoryStatus === "loading" ? <SectionSkeleton label="正在加载用户名录" />
                : userDirectoryStatus === "error" ? <SectionError message={userDirectoryError || "无法加载用户名录，请稍后重试。"} onRetry={handleUserDirectoryRetry} /> : undefined}
              table={{ ariaLabel: "平台用户", rows: filteredUsers, rowKey: (user) => user.id, columns: accountColumns,
                page, onPageChange: setPage, sort, onSort: (key) => { setSort({ key, direction: sort.key === key && sort.direction === "asc" ? "desc" : "asc" }); setPage(1); } }}
              emptyState={{ message: users.length === 0 ? "还没有任何用户，点击右上角「添加用户」创建第一个账号。" : "没有符合筛选条件的用户，请调整搜索或筛选条件。",
                actionLabel: users.length === 0 ? "添加用户" : "清除筛选条件", onAction: () => {
                  if (users.length === 0) setAddUserOpen(true);
                  else clearFilters();
                } }}
              rowActions={(user) => {
                const locked = isPlatformAdminLocked(state, user);
                const disabledReason = locked ? "只有平台超级管理员可以注销平台超级管理员。" : undefined;
                return {
                  label: `${user.name} 操作`,
                  primaryAction: { id: "details", label: "查看", ariaLabel: `查看 ${user.name} 的成员资料`, onSelect: () => setMemberId(user.id) },
                  items: [
                    ...(accountTransferClient ? [{ id: "transfer", label: "调动组织", ariaLabel: `调动 ${user.name} 到其他组织`, onSelect: () => { setTransferMessage(""); setTransferringUser(user); } }] : []),
                    ...(authentication.provider !== "oidc" && userGovernanceActions?.resetUserPassword ? [{ id: "password", label: "重置密码", ariaLabel: `重置 ${user.name} 的密码`, onSelect: () => openResetPassword(user) }] : []),
                    { id: "active", label: user.isActive ? "停用" : "启用", disabled: locked,
                      description: locked ? "只有平台超级管理员可以停用平台超级管理员。" : undefined,
                      onSelect: () => { setGovernanceError(null); setPendingGovernance({ kind: "active", user, nextActive: !user.isActive }); } },
                    { id: "delete", label: "注销", ariaLabel: `注销 ${user.name}`, destructive: true as const,
                      disabled: Boolean(disabledReason), description: disabledReason, descriptionId: disabledReason ? `delete-user-reason-${user.id}` : undefined,
                      onRequestConfirmation: () => { setGovernanceError(null); setPendingGovernance({ kind: "delete", user }); } }
                  ]
                };
              }} />
            {filteredUsers.filter((user) => isPlatformAdminLocked(state, user)).map((user) =>
              <span key={user.id} id={`delete-user-reason-${user.id}`} className="sr-only">
                只有平台超级管理员可以注销平台超级管理员。
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
              <p className="user-permissions-approval-queue__hint">核对申请人的组织与角色，选择授予申请角色、按普通成员启用或拒绝并保持停用。</p>
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
                    {request.status !== "pending" ? <span>申请角色：</span> : null}
                    <span>{roleLabelOf(request.currentRoleId)}</span>
                    <span aria-hidden="true">→</span>
                    <span>{roleLabelOf(request.requestedRoleId)}</span>
                  </div>
                  <div className="user-permissions-approval-actions">
                    {request.status === "pending" ? <>
                    <button
                      className="button primary"
                      type="button"
                      disabled={Boolean(decidingRequestId) || request.accountChanged}
                      onClick={() => { setRegistrationRoleRequestError(""); setPendingRequestDecision({ request, decision: "approve" }); }}
                    >
                      批准申请角色
                    </button>
                    <button className="button" type="button" disabled={Boolean(decidingRequestId) || request.accountChanged || !userGovernanceActions?.enableBasicRegistrationRoleRequest}
                      onClick={() => { setRegistrationRoleRequestError(""); setPendingRequestDecision({ request, decision: "enable-basic" }); }}>按普通成员启用</button>
                    <button
                      className="button"
                      type="button"
                      disabled={Boolean(decidingRequestId)}
                      onClick={() => { setRegistrationRoleRequestError(""); setPendingRequestDecision({ request, decision: "reject" }); }}
                    >
                      {request.accountChanged ? "关闭申请，保留现状" : "拒绝并保持停用"}
                    </button>
                    {request.accountChanged ? <p className="member-approval-item-meta">账号已有后续管理调整。关闭此申请将保留当前角色与启停状态。</p> : null}
                    </> : <div><Badge variant={request.status === "approved" ? "secondary" : "outline"}>{request.decisionOutcome === "basic-enabled" ? `已按${roleLabelOf(request.currentRoleId)}启用`
                      : request.decisionOutcome === "requested-role-enabled" ? "已批准申请角色并启用"
                      : request.decisionOutcome === "rejected-disabled" ? "已拒绝提升，保持停用"
                      : request.decisionOutcome === "rejected-preserved" ? "已拒绝提升，保留账号设置"
                      : request.status === "approved" ? "已通过" : "已拒绝提升（未记录账号结果）"}</Badge>
                      {request.decisionCanLogin !== undefined && request.decisionCanLogin !== null ? <p className="member-approval-item-meta">决定时：{request.decisionCanLogin ? "可登录" : "不可登录"} · {request.decisionRoleIds?.map(roleLabelOf).join("、") || "未分配组织角色"}</p> : null}
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

      {transferMessage ? <p role="status">{transferMessage}</p> : null}
      {transferringUser && accountTransferClient ? <AccountTransferDialog user={transferringUser} client={accountTransferClient} onClose={() => setTransferringUser(null)} onTransferred={async () => {
        const self = transferringUser.id === state.currentUserId;
        setTransferMessage(`${transferringUser.name} 已调动，源组织业务可在业务交接中继续处理。`); setTransferringUser(null); setDirectoryReloadToken(value => value + 1);
        if (self) await onCurrentAccountChanged?.(true);
      }} /> : null}
      {selectedMember ? <MemberDetailsDialog key={selectedMember.id} user={selectedMember} state={state} actions={userGovernanceActions} projects={projects} reviewRolesClient={reviewRolesClient}
        teamMembership={teamActions ? <section className="member-details__section" aria-label="团队归属"><h3>团队</h3><p>{teamError || (teams ? teamNames(selectedMember.id) : "正在加载团队归属")}</p></section> : undefined}
        oidcIssuer={authentication.provider === "oidc" ? authentication.oidcIssuer : undefined}
        onUpdated={applyUpdatedUser} onClose={() => { setMemberId(null); setDirectoryReloadToken((value) => value + 1); }} roleLabel={roleLabelOf}
        roleEditor={<MemberOrganizationRolesPanel user={selectedMember}
          options={assignableRolesForUser(state, organizationRoleOf(selectedMember)).map((role) => ({ id: role.id, label: roleLabelOf(role.id), description: roleCapabilityDescriptions[role.id] }))}
          isSelf={selectedMember.id === state.currentUserId}
          disabledReason={isPlatformAdminLocked(state, selectedMember) ? "只有平台超级管理员可以调整此账号的角色。" : undefined}
          onSave={async (roles, expectedRoles) => {
            const updated = await userGovernanceActions?.updateOrganizationRoles(selectedMember.id, { roles, expectedRoles }) ?? {
              ...selectedMember, roleId: pickPrimaryPlatformRoleId(roles),
              roles: [...(selectedMember.roles ?? []).filter((role) => role.projectId !== null), ...roles.map((roleId) => ({ projectId: null, roleId }))]
            };
            applyUpdatedUser(updated);
            dispatch({ type: "ADD_NOTIFICATION", message: `已更新 ${selectedMember.name} 的组织角色` });
            return updated;
          }}
          onSaved={async (updated) => { if (updated.id === state.currentUserId) await onCurrentAccountChanged?.(false); }}
          onReload={async () => {
            const updated = userGovernanceActions ? (await userGovernanceActions.listUsers()).find((user) => user.id === selectedMember.id) : selectedMember;
            if (!updated) throw new Error("该成员已不存在，请关闭成员资料并刷新名录。");
            applyUpdatedUser(updated);
            return updated;
          }} />} /> : null}

      <ConfirmDialog open={pendingRequestDecision !== null} title={pendingRequestDecision?.decision === "approve" ? "通过注册申请？" : pendingRequestDecision?.decision === "enable-basic" ? "按普通成员启用？" : "拒绝注册申请？"}
        description={pendingRequestDecision ? <div><p>{pendingRequestDecision.request.userName} · {pendingRequestDecision.request.organizationName ?? pendingRequestDecision.request.organizationId}</p>
          <p>{pendingRequestDecision.decision === "enable-basic" ? "启用角色：" : "申请角色："}{roleLabelOf(pendingRequestDecision.decision === "enable-basic" ? pendingRequestDecision.request.currentRoleId : pendingRequestDecision.request.requestedRoleId)}</p>
          <p>{roleCapabilityDescriptions[pendingRequestDecision.decision === "enable-basic" ? pendingRequestDecision.request.currentRoleId : pendingRequestDecision.request.requestedRoleId]}</p>
          <p>{pendingRequestDecision.decision === "approve" ? "通过后立即启用账号，并授予上述组织角色。" : pendingRequestDecision.decision === "enable-basic" ? `不授予申请角色，按${roleLabelOf(pendingRequestDecision.request.currentRoleId)}启用，账号可登录。` : "拒绝提升，不更改账号当前的角色与启停状态。初始停用状态将保持；如已有后续管理调整，将保留最新设置。"}</p></div> : undefined}
        confirmLabel={pendingRequestDecision?.decision === "approve" ? "通过并启用" : pendingRequestDecision?.decision === "enable-basic" ? "启用普通成员" : "确认拒绝"} tone={pendingRequestDecision?.decision === "reject" ? "danger" : "primary"}
        pending={Boolean(decidingRequestId)} error={registrationRoleRequestError || null}
        onCancel={() => { if (!decidingRequestId) { setPendingRequestDecision(null); setRegistrationRoleRequestError(""); } }}
        onConfirm={() => { if (pendingRequestDecision) void decideRegistrationRoleRequest(pendingRequestDecision.request, pendingRequestDecision.decision); }} />

      <ConfirmDialog
        open={pendingGovernance !== null}
        title={
          pendingGovernance?.kind === "delete"
              ? "确认注销用户"
              : pendingGovernance?.nextActive
                ? "确认启用用户"
                : "确认停用用户"
        }
        description={
          pendingGovernance ? (
            pendingGovernance.kind === "delete" ? (
              <><p>
                将永久删除 <strong>{pendingGovernance.user.name}</strong>（
                {userAccountIdentifier(pendingGovernance.user)}）。账号的角色、凭据、会话和临时数据将一并清除，个人设备配对将撤销；业务与审计历史记录会保留，
                既有历史署名不会改成接任者。此操作不可恢复。
              </p>{pendingGovernance.user.id === state.currentUserId ? <p>操作成功后将退出当前账号。服务端会检查是否保留有效管理员。</p> : null}</>
            ) : pendingGovernance.nextActive ? (
              <p>
                将启用 <strong>{pendingGovernance.user.name}</strong>（
                {userAccountIdentifier(pendingGovernance.user)}），该账号可重新登录。原有会话和设备配对不会恢复，需要重新登录和配对。
              </p>
            ) : (
              <><p>
                将停用 <strong>{pendingGovernance.user.name}</strong>（
                {userAccountIdentifier(pendingGovernance.user)}）。将立即撤销个人会话、访问凭据和设备配对；账号与业务资料保留，交接可随后完成。组织集成凭据不受影响。
              </p>{pendingGovernance.user.id === state.currentUserId ? <p>操作成功后将退出当前账号。服务端会检查是否保留有效管理员。</p> : null}</>
            )
          ) : null
        }
        confirmLabel={
          pendingGovernance?.kind === "delete"
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
              <p className="member-details__hint">{authentication.provider === "oidc" ? "预配本组织的 OIDC 成员并绑定外部 Subject，不创建本地密码。请核对身份提供方中的标识。" : "创建本组织的本地账号，创建后立即启用。职务选填，其余为必填项。"}</p>
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
              {authentication.provider === "oidc" ? <>
                <label className="user-permissions-modal-field"><span>Issuer</span><input className="user-permissions-modal-control" value={authentication.oidcIssuer ?? ""} readOnly /></label>
                <label className="user-permissions-modal-field"><span>Subject</span><input className="user-permissions-modal-control" value={oidcSubject} maxLength={255} onChange={(event) => setOidcSubject(event.target.value)} required /></label>
                <label className="user-permissions-modal-field"><span>身份提供方邮箱（选填）</span><input className="user-permissions-modal-control" type="email" value={oidcEmail} onChange={(event) => setOidcEmail(event.target.value)} /></label>
              </> : <label className="user-permissions-modal-field">
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
              </label>}
              <label className="user-permissions-modal-field">
                <span>职务</span>
                <input className="user-permissions-modal-control" value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              {authentication.provider !== "oidc" ? <><label className="user-permissions-modal-field">
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
              </label></> : null}
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
          onDismiss={resetPasswordPending ? undefined : dismissResetPassword}
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
                  onClick={dismissResetPassword}
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
      <SettingsLeaveGuard dirty={Boolean((addUserOpen && (name || username || title || password || confirmPassword || oidcSubject || oidcEmail || initialRoleId !== "hardware-user")) ||
        (resetPasswordUser && (resetPassword || resetConfirmPassword)))} saving={addUserPending || resetPasswordPending} />
    </section>
  );
}
