import { createHash } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { getAuthContext } from "../auth/repository";
import { canOperateInOrganization } from "../auth/policy";
import { requireActiveOrganization } from "../auth/organizationLifecycle";
import type { UserInvocationContext } from "../auth/trustedInvocation";
import { userImportPreviewBodySchema } from "../contracts/dtoSchemas/userImport";

const roleLabels = {
  "访客": "guest", "硬件开发": "hardware-user", "软件开发": "software-user",
  "硬件MDE": "hardware-committer", "软件MDE": "software-committer",
  "管理员": "admin", "平台超级管理员": "platform-admin"
} as const;
export async function previewUserImport(db: Database, invocation: UserInvocationContext, body: unknown) {
  const parsed = userImportPreviewBodySchema.safeParse(body);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "导入数据格式无效，请重新选择工作簿。");
  const auth = await getAuthContext(db, invocation.principal.user.id);
  const organizationId = invocation.operatingOrganization?.id ?? auth.organization.id;
  const platform = auth.roles.some((role) => role.projectId === null && role.roleId === "platform-admin");
  if (!auth.user.isActive || !auth.permissions.includes("users:manage") || !auth.roles.some((role) => role.projectId === null && (role.roleId === "admin" || role.roleId === "platform-admin")) || !canOperateInOrganization(auth, organizationId)) {
    throw new ApiError("FORBIDDEN", "需要组织管理员权限。");
  }
  if (platform && !invocation.operatingOrganization) throw new ApiError("VALIDATION_FAILED", "请选择操作组织。");
  const organization = await requireActiveOrganization(db, organizationId);
  const version = (await db.query<{ lifecycle_version: number }>("select lifecycle_version from organizations where id=$1", [organizationId])).rows[0].lifecycle_version;
  const errors: Array<{ row: number; field: string; message: string }> = [];
  const add = (row: number, field: string, message: string) => errors.push({ row, field, message });
  const seenRows = new Set<number>();
  const rows = parsed.data.rows.map((input) => {
    if (seenRows.has(input.row)) throw new ApiError("VALIDATION_FAILED", "导入行号重复。");
    seenRows.add(input.row);
    const name = input.name.trim(), username = input.username.trim().toLowerCase(), title = input.title.trim();
    if (!name || name.length > 100) add(input.row, "name", "姓名须为 1–100 个字符。");
    if (username.length < 3 || username.length > 64 || !/^[a-z0-9._-]+$/.test(username)) add(input.row, "username", "用户名须为 3–64 个字母、数字、点、下划线或连字符。");
    if (input.password.length < 8 || input.password.length > 1024) add(input.row, "password", "密码须为 8–1024 个字符。");
    if (title.length > 100) add(input.row, "title", "职务最多 100 个字符。");
    const labels = input.roles.split("；").map((label) => label.trim());
    const roles = [...new Set(labels.filter((label) => Object.hasOwn(roleLabels, label)).map((label) => roleLabels[label as keyof typeof roleLabels]))];
    if (labels.some((label) => !Object.hasOwn(roleLabels, label))) add(input.row, "roles", "请选择现有组织角色，多个角色用中文分号分隔。");
    if (roles.includes("platform-admin") && !platform) add(input.row, "roles", "只有平台超级管理员可以授予平台超级管理员角色。");
    return { row: input.row, name, username, title: title || "User", roles };
  });
  const usernames = rows.map((row) => row.username).filter(Boolean);
  const occupied = new Set((await db.query<{ username: string }>("select lower(username) as username from user_password_credentials where lower(username)=any($1::text[])", [usernames])).rows.map((row) => row.username));
  const counts = new Map<string, number>();
  for (const username of usernames) counts.set(username, (counts.get(username) ?? 0) + 1);
  for (const row of rows) {
    if ((counts.get(row.username) ?? 0) > 1) add(row.row, "username", "用户名在表内重复。");
    if (occupied.has(row.username)) add(row.row, "username", "用户名已被使用。");
  }
  const projection = { operatorId: auth.user.id, organizationId, lifecycleVersion: version, rows };
  return { organization, rows, errors, total: rows.length, privilegedCount: rows.filter((row) => row.roles.includes("admin") || row.roles.includes("platform-admin")).length,
    token: errors.length ? null : createHash("sha256").update(JSON.stringify(projection)).digest("hex") };
}
