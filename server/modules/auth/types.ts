export type BackendRoleId =
  | "guest"
  | "hardware-user"
  | "software-user"
  | "hardware-committer"
  | "software-committer"
  | "admin";

export type BackendPermission =
  | "parameter:view"
  | "parameter:edit"
  | "debugging:use"
  | "debugging:view"
  | "debugging:read"
  | "debugging:write"
  | "debugging:rollback"
  | "debugging:admin"
  | "logs:view"
  | "logs:upload"
  | "logs:analyze"
  | "logs:archive"
  | "logs:feedback"
  | "parameter:review"
  | "admin:access"
  | "users:manage";

export type AuthenticatedUser = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  title: string;
  isActive: boolean;
};

export type RoleBinding = {
  projectId: string | null;
  roleId: BackendRoleId;
};

export type AuthContext = {
  user: AuthenticatedUser;
  organization: {
    id: string;
    name: string;
  };
  roles: RoleBinding[];
  permissions: BackendPermission[];
};
