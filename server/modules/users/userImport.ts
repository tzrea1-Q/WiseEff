import { createHash } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { getAuthContext } from "../auth/repository";
import { canOperateInOrganization } from "../auth/policy";
import { requireActiveOrganization } from "../auth/organizationLifecycle";
import type { UserInvocationContext } from "../auth/trustedInvocation";
import { userImportPreviewBodySchema } from "../contracts/dtoSchemas/userImport";
import { userImportCreateBodySchema } from "../contracts/dtoSchemas/userImport";
import { z } from "zod";
import { hashLocalAccountPassword, validateLocalAccountPassword, validateLocalAccountUsername } from "../auth/localAccountCredentials";
import { requireUserInitiatedInvocation } from "../auth/trustedInvocationPolicy";
import { resolveOperatingContext } from "../auth/operatingContext";
import { lockAdministratorMutation } from "./administratorContinuity";
import { assertPlatformAdminGrantAllowed, writePreparedLocalUser } from "./service";

const roleLabels = {
  "访客": "guest", "硬件开发": "hardware-user", "软件开发": "software-user",
  "硬件MDE": "hardware-committer", "软件MDE": "software-committer",
  "管理员": "admin", "平台超级管理员": "platform-admin"
} as const;
export async function previewUserImport(db: Database, invocation: UserInvocationContext, body: unknown) {
  const parsed = userImportPreviewBodySchema.safeParse(body);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "导入数据格式无效，请重新选择工作簿。");
  const { auth, organizationId } = await importAuthority(db, invocation);
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
    try { validateLocalAccountUsername(username); } catch { add(input.row, "username", "用户名须为 3–64 个字母、数字、点、下划线或连字符。"); }
    try { validateLocalAccountPassword(input.password); } catch { add(input.row, "password", "密码须为 8–1024 个字符。"); }
    if (input.password.length > 1024) add(input.row, "password", "密码须为 8–1024 个字符。");
    if (title.length > 100) add(input.row, "title", "职务最多 100 个字符。");
    const labels = input.roles.split("；").map((label) => label.trim());
    const roles = [...new Set(labels.filter((label) => Object.hasOwn(roleLabels, label)).map((label) => roleLabels[label as keyof typeof roleLabels]))];
    if (labels.some((label) => !Object.hasOwn(roleLabels, label))) add(input.row, "roles", "请选择现有组织角色，多个角色用中文分号分隔。");
    try { assertPlatformAdminGrantAllowed(auth, [], roles.map(roleId => ({ roleId, projectId: null }))); }
    catch { add(input.row, "roles", "只有平台超级管理员可以授予平台超级管理员角色。"); }
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

const replayBodySchema = userImportCreateBodySchema.extend({ previewToken: z.unknown(), rows: z.array(z.object({
  row: z.number().int().min(2).max(5000), name: z.string(), username: z.string(), password: z.unknown(), title: z.string(), roles: z.string()
}).strict()).min(1).max(500) });

function intentDigest(actorId: string, organizationId: string, rows: z.infer<typeof replayBodySchema>["rows"]) {
  const projection = rows.map(row => ({ row: row.row, name: row.name.trim(), username: row.username.trim().toLowerCase(),
    title: row.title.trim() || "User", roles: [...new Set(row.roles.split("；").map(role => role.trim()))].sort() }));
  return createHash("sha256").update(JSON.stringify({ actorId, organizationId, rows: projection })).digest("hex");
}

async function importAuthority(db: Database, invocation: UserInvocationContext, expectedOrganizationId?: string) {
  requireUserInitiatedInvocation(invocation);
  const auth = await getAuthContext(db, invocation.principal.user.id);
  const organizationId = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  if (auth.user.organizationId !== invocation.principal.user.organizationId || (expectedOrganizationId !== undefined && organizationId !== expectedOrganizationId)) {
    throw new ApiError("FORBIDDEN", "操作账号的所属组织或操作范围已变化，请重新开始。");
  }
  const platform = auth.roles.some(role => role.projectId === null && role.roleId === "platform-admin");
  if (!auth.user.isActive || !auth.permissions.includes("users:manage") || !auth.roles.some(role => role.projectId === null && (role.roleId === "admin" || role.roleId === "platform-admin")) || !canOperateInOrganization(auth, organizationId)) throw new ApiError("FORBIDDEN", "需要组织管理员权限。");
  if (platform && !invocation.operatingOrganization) throw new ApiError("VALIDATION_FAILED", "请选择操作组织。");
  return { auth, organizationId };
}

type Receipt = { id: string; organization_id: string; actor_user_id: string | null; item_count: number; intent_digest: string; results: Array<{ row: number; userId: string }> };
async function receipt(db: Database, id: string, actorId: string, organizationId: string, digest?: string) {
  const found = (await db.query<Receipt>("select id,organization_id,actor_user_id,item_count,intent_digest,results from user_import_receipts where id=$1 and actor_user_id=$2 and organization_id=$3", [id, actorId, organizationId])).rows[0];
  if (!found) return null;
  if (digest !== undefined && found.intent_digest !== digest) throw new ApiError("CONFLICT", "批次内容与已提交的意图不一致。", { code: "import-intent-mismatch" });
  const users = await db.query<{ id: string; name: string; username: string | null }>("select u.id,u.name,c.username from users u left join user_password_credentials c on c.user_id=u.id where u.organization_id=$1 and u.id=any($2::text[])", [organizationId, found.results.map(row => row.userId)]);
  const usersById = new Map(users.rows.map(user => [user.id, user]));
  return { importId: found.id, organizationId, count: found.item_count, rows: found.results.map(row => { const user = usersById.get(row.userId); return { ...row, ...(user ? { name: user.name, username: user.username } : {}) }; }) };
}

async function lockedReceipt(db: Database, invocation: UserInvocationContext, id: string, organizationId: string, digest?: string) {
  return db.transaction(async tx => {
    await lockAdministratorMutation(tx);
    await tx.query("select id from organizations where id=$1 for share", [organizationId]);
    await tx.query("select id from users where id=$1 for update", [invocation.principal.user.id]);
    const current = await importAuthority(tx, invocation, organizationId);
    return receipt(tx, id, current.auth.user.id, organizationId, digest);
  });
}

export async function readUserImport(db: Database, invocation: UserInvocationContext, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError("VALIDATION_FAILED", "批次编号无效。");
  const { organizationId } = await importAuthority(db, invocation);
  const result = await lockedReceipt(db, invocation, id, organizationId);
  if (!result) throw new ApiError("NOT_FOUND", "尚未确认该批次结果。", { code: "import-not-confirmed" });
  return result;
}

export async function createUserImport(db: Database, invocation: UserInvocationContext, body: unknown, requestId: string) {
  const envelope = replayBodySchema.safeParse(body);
  if (!envelope.success) throw new ApiError("VALIDATION_FAILED", "导入数据格式无效。");
  const { auth, organizationId } = await importAuthority(db, invocation);
  const digest = intentDigest(auth.user.id, organizationId, envelope.data.rows);
  const existing = await receipt(db, envelope.data.importId, auth.user.id, organizationId);
  if (existing) {
    const committed = await lockedReceipt(db, invocation, envelope.data.importId, organizationId, digest);
    if (committed) return committed;
  }
  const parsed = userImportCreateBodySchema.safeParse(body);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "导入数据格式无效。");
  let initial: Awaited<ReturnType<typeof previewUserImport>>;
  try { initial = await previewUserImport(db, invocation, { rows: parsed.data.rows }); }
  catch (error) {
    const committed = await lockedReceipt(db, invocation, parsed.data.importId, organizationId, digest);
    if (committed) return committed;
    throw error;
  }
  if (initial.errors.length || initial.token !== parsed.data.previewToken) {
    const committed = await lockedReceipt(db, invocation, parsed.data.importId, organizationId, digest);
    if (committed) return committed;
    throw new ApiError("CONFLICT", "预检已失效或存在问题，请重新预检。", { code: "import-preview-stale", errors: initial.errors });
  }
  const hashes = new Array<string>(parsed.data.rows.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, hashes.length) }, async () => {
    while (next < hashes.length) { const index = next++; hashes[index] = await hashLocalAccountPassword(parsed.data.rows[index].password); }
  }));
  let rolledBack = false;
  try {
    return await db.transaction(async tx => {
      await lockAdministratorMutation(tx);
      await tx.query("select id from organizations where id=$1 for share", [organizationId]);
      await tx.query("select id from users where id=$1 for update", [auth.user.id]);
      const current = await importAuthority(tx, invocation, organizationId);
      const scoped = await resolveOperatingContext(tx, invocation, organizationId);
      await tx.query("select pg_advisory_xact_lock(hashtextextended('user-import:'||$1,0))", [parsed.data.importId]);
      const committed = await receipt(tx, parsed.data.importId, current.auth.user.id, organizationId, digest);
      if (committed) return committed;
      await requireActiveOrganization(tx, organizationId);
      const fresh = await previewUserImport(tx, scoped, { rows: parsed.data.rows });
      if (fresh.errors.length || fresh.token !== parsed.data.previewToken) throw new ApiError("CONFLICT", "预检已失效或存在问题，请重新预检。", { code: "import-preview-stale", errors: fresh.errors });
      const results = [];
      for (const [index, row] of fresh.rows.entries()) {
        const user = await writePreparedLocalUser(tx, scoped, { ...row, organizationId, passwordHash: hashes[index] }, { requestId });
        results.push({ row: row.row, userId: user.id });
      }
      await tx.query("insert into user_import_receipts(id,organization_id,actor_user_id,actor_id_snapshot,item_count,intent_digest,results) values($1,$2,$3,$3,$4,$5,$6)", [parsed.data.importId, organizationId, auth.user.id, results.length, digest, JSON.stringify(results)]);
      return (await receipt(tx, parsed.data.importId, auth.user.id, organizationId, digest))!;
    }, { onConfirmedRollback: () => { rolledBack = true; } });
  } catch (error) {
    if (rolledBack && error instanceof ApiError) throw error;
    if (rolledBack && (error as { code?: string; constraint?: string })?.code === "23505" && (error as { constraint?: string }).constraint === "user_password_credentials_username_unique_idx") throw new ApiError("CONFLICT", "用户名已被使用，请重新预检。", { code: "import-username-conflict" });
    throw new ApiError("INTERNAL_ERROR", rolledBack ? "创建未完成，已确认没有创建账号。" : "结果尚未确认，请使用原批次查询或重试。", { code: rolledBack ? "import-rolled-back" : "import-not-confirmed" });
  }
}
