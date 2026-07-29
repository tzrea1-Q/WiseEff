export type BackendRoleId =
  | "guest"
  | "hardware-user"
  | "software-user"
  | "hardware-committer"
  | "software-committer"
  | "admin"
  | "platform-admin";

export type BackendPermission =
  | "parameter:view"
  | "parameter:edit"
  | "parameter:edit-critical"
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
  | "users:manage"
  | "platform:access"
  | "platform:schema-promote";

export type AuthenticatedUser = {
  id: string;
  organizationId: string;
  name: string;
  email?: string;
  emailVerified?: boolean;
  username?: string;
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
