export type RoleCapability = "view" | "edit" | "publish" | "manage-permissions";

export type Role = {
  id: string;
  name: string;
  capabilities: RoleCapability[];
  description: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  roleId: string;
  isActive: boolean;
  createdAt: string;
};
