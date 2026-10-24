import { createHash } from "node:crypto";
import type { Database } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import { agentOrganizationId, type AgentAccessContext } from "../scope";
import type { XiaozeCheckpointer } from "./checkpointer";

type Ownership = { store_id: string; store_kind: string; checkpoint_thread_id: string; organization_id: string; actor_user_id: string; logical_thread_id: string };
export type CheckpointPreviewRow = { key: string; category: string; item_count: string; state_digest: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Called inside the saver's existing namespace lease, before any graph/auxiliary write. */
export async function registerAgentCheckpointNamespace(db: Database, checkpointer: XiaozeCheckpointer,
  auth: AgentAccessContext, logicalThreadId: string, checkpointThreadId: string) {
  const store = await checkpointer.inspectStore(checkpointThreadId);
  await db.query("select parameter_catalog.register_agent_checkpoint_namespace($1,$2,$3,$4,$5,$6,$7)", [
    agentOrganizationId(auth), auth.user.id, logicalThreadId, store.id, store.kind, checkpointThreadId, store.entries.length > 0,
  ]).catch(error => {
    if (error?.code === "23505") throw new ApiError("CONFLICT", "Agent 检查点归属冲突，请联系平台管理员核实。", { reason: "checkpoint-ownership-conflict" });
    if (error?.code === "55000") throw new ApiError("FORBIDDEN", "组织当前不能开始或继续 Agent 会话。", { reason: "organization-unavailable" });
    throw error;
  });
}

/** Counts use the actual owned store. Missing proof never becomes an empty result. */
export async function inspectOrganizationCheckpoints(db: Database, organizationId: string, checkpointer?: XiaozeCheckpointer): Promise<CheckpointPreviewRow[]> {
  const unavailable = (reason: string): CheckpointPreviewRow[] => [{ key: "agent.checkpoint-runtime", category: "unclassified", item_count: "1", state_digest: reason }];
  if (!checkpointer) return unavailable("runtime-inspection-required");
  let store: Awaited<ReturnType<XiaozeCheckpointer["inspectStore"]>>;
  try { store = await checkpointer.inspectStore(); }
  catch { return unavailable("configured-checkpoint-store-unavailable"); }
  const registered = (await db.query<Ownership>("select store_id,store_kind,checkpoint_thread_id,organization_id,actor_user_id,logical_thread_id from public.agent_checkpoint_namespaces order by store_id,checkpoint_thread_id")).rows;
  const sessions = (await db.query<{ id: string; organization_id: string; actor_user_id: string | null; historical_actor_id: string | null }>(
    "select id,organization_id,actor_user_id,historical_attribution#>>'{actors,actor_user_id,id}' historical_actor_id from public.agent_sessions order by id")).rows;
  const candidates = new Map<string, Array<{ organizationId: string; actorId: string; logicalId: string }>>();
  for (const session of sessions) {
    const actorId = session.historical_actor_id ?? session.actor_user_id;
    if (!actorId) continue;
    const key = `${session.organization_id}:${actorId}:${session.id}`;
    const values = candidates.get(key) ?? [];
    values.push({ organizationId: session.organization_id, actorId, logicalId: session.id });
    candidates.set(key, values);
  }
  const rows = new Map<string, { count: number; proofs: unknown[] }>();
  const unknown: unknown[] = [];
  const local = (await db.query<{ identity: string; has_tables: boolean }>("select jsonb_build_array(inet_server_addr()::text,inet_server_port(),current_database())::text identity,(to_regclass('public.checkpoints') is not null or to_regclass('public.checkpoint_blobs') is not null or to_regclass('public.checkpoint_writes') is not null) has_tables")).rows[0];
  if (local?.has_tables && (store.kind !== "postgres" || store.id !== createHash("sha256").update(local.identity).digest("hex"))) unknown.push({ reason: "uninspected-application-database-checkpoints" });
  const ownedByKey = new Map(registered.filter(row => row.store_id === store.id).map(row => [row.checkpoint_thread_id, row]));
  for (const entry of store.entries) {
    const owned = ownedByKey.get(entry.threadId);
    const legacy = candidates.get(entry.threadId) ?? [];
    const conflicting = legacy.length > 1 || legacy.some(value => owned &&
      (value.organizationId !== owned.organization_id || value.actorId !== owned.actor_user_id || value.logicalId !== owned.logical_thread_id));
    const owner = !conflicting ? owned?.organization_id ?? (legacy.length === 1 ? legacy[0].organizationId : undefined) : undefined;
    if (!owner) { unknown.push(entry); continue; }
    if (owner !== organizationId) continue;
    const row = rows.get(entry.relation) ?? { count: 0, proofs: [] };
    row.count += entry.count; row.proofs.push(entry); rows.set(entry.relation, row);
  }
  for (const owned of registered) {
    if (owned.organization_id === organizationId && (owned.store_id !== store.id || owned.store_kind !== store.kind)) unknown.push(owned);
  }
  const result = [...rows].map(([key, row]) => ({ key, category: "agent", item_count: String(row.count), state_digest: digest(row.proofs) }));
  if (unknown.length) result.push({ key: "agent.checkpoint-unclassified", category: "unclassified", item_count: String(unknown.length), state_digest: digest(unknown) });
  // An empty actual store has a stable digest; fresh memory handles cannot make a readonly preview stale.
  if (!result.length) result.push({ key: "agent.checkpoint-runtime", category: "agent", item_count: "0", state_digest: "verified-empty" });
  return result;
}
