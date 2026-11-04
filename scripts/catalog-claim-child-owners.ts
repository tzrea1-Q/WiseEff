import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";
import { createSystemInvocation } from "../server/modules/auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx } from "../server/modules/audit/auditedWrite";
import { CatalogPageLimit } from "../server/modules/parameter-catalog-contract";
import { DriverCompatible, type CatalogSnapshot } from "../server/modules/catalog-kernel/interface";
import { loadProjection } from "../server/modules/catalog-kernel/runtime/currentSnapshot";
import type { CatalogSnapshotClient } from "../server/modules/catalog-kernel/runtime/readTransaction";
import { asValueClient, parseCompatibles } from "../server/modules/parameter-bindings/catalogProjectValueSync";
import { inventoryVendorCatalog, parseVendorYamlFile } from "../server/modules/catalog-publication/import/vendorYaml";
import { loadOrganizationCatalogSnapshot, lockOrganizationModuleRecognition } from "../server/modules/parameter-modules/recognitionSettings";

type Declaration = { name: string; compatibles: readonly string[]; conflict?: string };
type Evidence = {
  kind: string; id: string; organizationId: string; subjectId: string; ancestorCompatible: string | null;
  sourceNodeFound: boolean; historicalExclusionRequestId: string | null;
};
type HistoricalEvidence = { bindingId: string; organizationId: string; requestId: string; reason: "approved-source-exclusion" };

/** Read the reviewed repository inventory; ambiguous names are reported, never guessed. */
export function childOwnerDeclarations(schemasRoot: string): Declaration[] {
  const inventory = inventoryVendorCatalog(schemasRoot);
  if (!inventory.ok) throw new Error(`catalog-owner-inventory:${inventory.error.kind}`);
  const documents = inventory.value.files.filter((file) => file.disposition === "input").map((file) => {
    const document = parseVendorYamlFile(path.join(schemasRoot, file.relativePath));
    if ("error" in document) throw new Error(`catalog-owner-schema:${file.relativePath}`);
    return document;
  });
  const declarations = new Map<string, string[][]>();
  for (const document of documents) {
    if (document.lifecycle && document.lifecycle !== "active") continue;
    if (document.childNodes === undefined) continue;
    if (!Array.isArray(document.childNodes) || !document.compatible?.length
      || document.childNodes.some((child) => typeof child !== "string")) throw new Error("catalog-owner-invalid-child-declaration");
    for (const child of document.childNodes as string[]) {
      const owners = declarations.get(child) ?? [];
      owners.push([...document.compatible]);
      declarations.set(child, owners);
    }
  }
  return [...declarations].sort(([a], [b]) => a.localeCompare(b)).map(([name, owners]) => {
    const schemas = documents.filter((document) => (!document.lifecycle || document.lifecycle === "active") && document.nodename?.includes(name));
    return { name, compatibles: owners[0]!, ...(owners.length !== 1 || schemas.length !== 1
      ? { conflict: "子节点声明或 nodename 规范不是唯一的。" } : {}) };
  });
}

export async function claimCatalogChildOwners(
  db: Database, schemasRoot: string, apply = false,
  options: { requireEmptyDemo?: boolean; expectedReleaseId?: string } = {},
) {
  const declarations = childOwnerDeclarations(schemasRoot);
  return db.transaction(async (tx) => {
    await tx.query(apply ? "set transaction isolation level read committed" : "set transaction isolation level repeatable read, read only");
    let lockedOrganizations: Set<string> | undefined;
    if (apply) {
      await tx.query("set local lock_timeout = '5s'");
      await tx.query("select parameter_catalog.acquire_current_pointer_lock_exclusive()");
      const organizations = (await tx.query<{ id: string }>(`select id from public.organizations order by id`)).rows;
      lockedOrganizations = new Set(organizations.map((organization) => organization.id));
      for (const organization of organizations) await lockOrganizationModuleRecognition(tx, organization.id);
      await tx.query(`lock table public.module_recognition_rules, parameter_catalog.organization_subject_registrations,
        parameter_catalog.subject_placements in share mode`);
      await tx.query(`lock table parameter_catalog.catalog_subjects, parameter_catalog.catalog_subject_aliases in share row exclusive mode`);
      // ponytail: instance-wide maintenance locks block concurrent source writes; use a coordinated per-subject fence if this becomes a regular operation.
      await tx.query(`lock table parameter_catalog.project_parameter_bindings, parameter_catalog.project_parameter_values,
        parameter_catalog.project_value_source_pins, parameter_catalog.parameter_observations,
        parameter_catalog.parameter_observation_matches, parameter_catalog.project_parameter_source_occurrences,
        parameter_catalog.project_source_member_tombstones, parameter_catalog.definition_replacement_projects,
        parameter_catalog.definition_erasures, public.project_parameter_value_change_requests,
        parameter_catalog.source_binding_suspension_receipts, public.audit_events,
        public.dts_config_revisions, public.dts_config_revision_members, public.dts_logical_node_revisions in share mode`);
    }
    // Recheck under the maintenance locks: a racing registration/adoption must
    // never turn fresh-demo initialization into a populated-data migration.
    if (options.requireEmptyDemo) {
      const populated = await tx.query<{ populated: boolean }>(`select
        exists(select 1 from parameter_catalog.catalog_activation_receipts)
        or exists(select 1 from parameter_catalog.organization_subject_registrations)
        or exists(select 1 from parameter_catalog.project_parameter_bindings)
        or exists(select 1 from parameter_catalog.parameter_observations) as populated`);
      if (populated.rows[0]?.populated) throw new Error("catalog-owned-seed-requires-empty-database");
    }
    const current = (await tx.query<{ id: string }>(`select current_catalog_release_id as id from parameter_catalog.catalog_state where singleton`)).rows[0];
    if (!current) throw new Error("catalog-owner-current-release-missing");
    if (options.expectedReleaseId && current.id !== options.expectedReleaseId) throw new Error("catalog-owner-current-release-changed");
    const loaded = await loadProjection(asValueClient(tx) as unknown as CatalogSnapshotClient, current.id, "current");
    if (!loaded) throw new Error("catalog-owner-current-release-unavailable");
    const snapshot = loaded.snapshot;
    const listed = snapshot.listSubjects({ selection: { kind: "all" }, kinds: ["node-type"], lifecycles: [],
      search: { kind: "absent" }, page: { limit: CatalogPageLimit(Number.MAX_SAFE_INTEGER), after: { kind: "absent" } } });
    if (listed.status !== "found") throw new Error("catalog-owner-subject-list-unavailable");
    const evidence = (await tx.query<Evidence>(`
      with recursive evidence as (
        select 'binding'::text as kind, b.id, b.organization_id, b.project_id, b.subject_id, occurrence.logical_node_id, pin.config_revision_id,
          suspension.request_id as historical_exclusion_request_id
        from parameter_catalog.project_parameter_bindings b
        left join parameter_catalog.project_parameter_source_occurrences occurrence on occurrence.id=b.source_occurrence_id
          and occurrence.organization_id=b.organization_id and occurrence.project_id=b.project_id and occurrence.logical_node_id=b.logical_node_id
        left join parameter_catalog.project_value_source_pins pin on pin.binding_id=b.id and pin.project_value_id=b.current_value_id
          and pin.source_occurrence_id=occurrence.id
        left join parameter_catalog.organization_subject_registrations registration on registration.id=b.registration_id
          and registration.organization_id=b.organization_id and registration.subject_id=b.subject_id
        left join lateral (
          -- Support both original approved requests and independently retained receipts.
          -- The existing SQL verifier checks the exact value, pin, scope and applied audit.
          select exclusion.request_id from (
            select request.id as request_id, request.applied_source_result->>'configRevisionId' as applied_revision_id
            from public.project_parameter_value_change_requests request
            where request.organization_id=b.organization_id and request.project_id=b.project_id
              and request.source_revision_config_set_id=occurrence.config_set_id
              and request.request_kind='source_revision' and request.status='approved' and request.apply_outcome='committed'
              and request.source_revision_context->'excludedBindings' @> jsonb_build_array(jsonb_build_object('bindingId',b.id))
            union
            select receipt.request_id, receipt.applied_config_revision_id
            from parameter_catalog.source_binding_suspension_receipts receipt
            where receipt.organization_id=b.organization_id and receipt.project_id=b.project_id
              and receipt.config_set_id=occurrence.config_set_id and receipt.binding_id=b.id
              and receipt.old_value_id=b.current_value_id and receipt.source_pin_id=pin.id
          ) exclusion
          where registration.status='retired'
            and parameter_catalog.source_revision_exclusion_matches(
              exclusion.request_id,b.id,b.current_value_id,pin.id,exclusion.applied_revision_id)
          order by exclusion.request_id limit 1
        ) suspension on true
        where b.subject_id = any($1::text[])
        union all
        select 'observation', m.id, m.organization_id, m.project_id, m.subject_id, o.logical_node_id, o.config_revision_id, null::text
        from parameter_catalog.parameter_observation_matches m
        join parameter_catalog.parameter_observations o on o.id=m.observation_id and o.organization_id=m.organization_id
        where m.subject_id = any($1::text[])
      )
      select evidence.kind, evidence.id, evidence.organization_id as "organizationId", evidence.subject_id as "subjectId",
        ancestor.compatible as "ancestorCompatible", node.id is not null as "sourceNodeFound",
        evidence.historical_exclusion_request_id as "historicalExclusionRequestId"
      from evidence
      left join public.dts_config_revisions revision on revision.id=evidence.config_revision_id
        and revision.organization_id=evidence.organization_id and revision.project_id=evidence.project_id
      left join public.dts_logical_node_revisions node on node.logical_node_id=evidence.logical_node_id
        and node.config_revision_id=revision.id
      left join lateral (
        with recursive parents as (
          select p.logical_node_id,p.parent_logical_node_id,p.compatible,1 as depth,array[node.logical_node_id,p.logical_node_id] as visited
          from public.dts_logical_node_revisions p
          where p.config_revision_id=node.config_revision_id and p.logical_node_id=node.parent_logical_node_id
          union all
          select p.logical_node_id,p.parent_logical_node_id,p.compatible,parents.depth+1,parents.visited||p.logical_node_id
          from parents join public.dts_logical_node_revisions p on p.config_revision_id=node.config_revision_id
            and p.logical_node_id=parents.parent_logical_node_id
          where not p.logical_node_id=any(parents.visited)
        ) select compatible from parents where compatible is not null order by depth limit 1
      ) ancestor on true
      order by evidence.subject_id,evidence.organization_id,evidence.kind,evidence.id`,
    [listed.page.items.map((item) => item.id)])).rows;
    if (lockedOrganizations && evidence.some((item) => !lockedOrganizations!.has(item.organizationId))) {
      throw new Error("catalog-owner-organizations-changed-retry");
    }
    const effectiveSnapshots = new Map<string, CatalogSnapshot>();
    for (const organizationId of new Set(evidence.map((item) => item.organizationId))) {
      effectiveSnapshots.set(organizationId, await loadOrganizationCatalogSnapshot(tx, organizationId, snapshot));
    }
    const report: { name: string; subjectId?: string; ownerSubjectId?: string; status: "ready" | "conflict" | "missing" | "already-claimed" | "claimed"; conflicts: string[]; historicalEvidence?: HistoricalEvidence[] }[] = [];
    for (const declaration of declarations) {
      const driver = snapshot.resolveSubject({ driverCompatibles: declaration.compatibles.map(DriverCompatible), nodeTypeFallback: { kind: "absent" } });
      const subjects = listed.page.items.filter((item) => item.membership.selector.kind === "node-type-name"
        && item.membership.selector.value === declaration.name).map((item) => snapshot.getSubject(item.id))
        .flatMap((result) => result.status === "found" || result.status === "retired" ? [result.subject] : []);
      const ownerId = driver.status === "matched" && driver.subject.kind === "driver" ? driver.subject.id : undefined;
      const unowned = subjects.filter((subject) => !subject.owner);
      const existing = ownerId && subjects.find((subject) => subject.owner === ownerId);
      const subject = unowned.length === 1 ? unowned[0] : existing;
      const conflicts = declaration.conflict ? [declaration.conflict] : [];
      const historicalEvidence: HistoricalEvidence[] = [];
      if (!ownerId) conflicts.push("声明的驱动无法在当前目录中唯一解析。");
      if (unowned.length > 1 || (unowned.length && existing)) conflicts.push("节点主体身份不唯一。");
      if (!subject) {
        report.push({ name: declaration.name, ...(ownerId ? { ownerSubjectId: ownerId } : {}), status: conflicts.length || subjects.length ? "conflict" : "missing", conflicts });
        continue;
      }
      if (!subject.owner) {
        const inactiveOwner = await tx.query<{ organization_id: string }>(`
          select child.organization_id from parameter_catalog.organization_subject_registrations child
          left join parameter_catalog.organization_subject_registrations owner
            on owner.organization_id=child.organization_id and owner.subject_id=$2 and owner.status='active'
          where child.subject_id=$1 and child.status='active' and owner.id is null`, [subject.id, ownerId ?? ""]);
        for (const row of inactiveOwner.rows) conflicts.push(`组织 ${row.organization_id} 的所属驱动尚未登记或已停用。`);
        for (const item of evidence.filter((row) => row.subjectId === subject.id)) {
          // A verified exclusion preserves history; it is not positive ancestor
          // evidence and never overrides a known incompatible ancestor. The unique
          // reviewed vendor declaration above supplies the proposed Catalog owner.
          if (item.kind === "binding" && item.sourceNodeFound && item.ancestorCompatible === null
            && item.historicalExclusionRequestId) {
            historicalEvidence.push({ bindingId: item.id, organizationId: item.organizationId,
              requestId: item.historicalExclusionRequestId, reason: "approved-source-exclusion" });
            continue;
          }
          const match = effectiveSnapshots.get(item.organizationId)!.resolveSubject({ driverCompatibles: parseCompatibles(item.ancestorCompatible).map(DriverCompatible), nodeTypeFallback: { kind: "absent" } });
          if (!item.ancestorCompatible || match.status !== "matched" || match.subject.id !== ownerId) {
            conflicts.push(`${item.kind}:${item.id}（组织 ${item.organizationId}）缺少一致的最近祖先驱动。`);
          }
        }
        const collision = await tx.query<{ collision: boolean }>(`
          select exists (
            select 1 from (
              select canonical_key as selector from parameter_catalog.catalog_subjects where id=$1
              union all select normalized_selector from parameter_catalog.catalog_subject_aliases where subject_id=$1
            ) source
            join (
              select id as subject_id, canonical_key as selector from parameter_catalog.catalog_subjects where kind='node-type' and owner_subject_id=$2
              union all select subject_id,normalized_selector from parameter_catalog.catalog_subject_aliases
                where selector_kind='node-type-name' and owner_subject_id=$2
            ) target on target.selector=source.selector and target.subject_id<>$1
          ) as collision`, [subject.id, ownerId ?? ""]);
        if (collision.rows[0]?.collision) conflicts.push("目标驱动下已存在相同主体或别名。");
      }
      const status = conflicts.length ? "conflict" : subject.owner ? "already-claimed" : "ready";
      report.push({ name: declaration.name, subjectId: subject.id, ...(ownerId ? { ownerSubjectId: ownerId } : {}), status, conflicts,
        ...(historicalEvidence.length ? { historicalEvidence } : {}) });
    }
    if (apply) {
      if (options.requireEmptyDemo && report.some((item) => item.status !== "ready" && item.status !== "already-claimed")) {
        throw new Error("catalog-owned-seed-claim-conflict");
      }
      const ready = report.filter((item) => item.status === "ready");
      for (const item of ready) {
        await tx.query(`select parameter_catalog.claim_catalog_subject_owner($1,$2)`, [item.subjectId, item.ownerSubjectId]);
        item.status = "claimed";
      }
      if (ready.length) await writeTrustedAuditEventInTx(asAuditTx(tx), {
        invocation: createSystemInvocation({ kind: "job", name: "catalog-claim-child-owners" }), projectId: null,
        app: "parameters", kind: "catalog-child-owners-claimed", action: "claim", severity: "High",
        targetType: "catalog-release", targetId: current.id, metadata: { claims: ready.map(({ subjectId, ownerSubjectId, historicalEvidence }) => ({ subjectId, ownerSubjectId,
          ...(historicalEvidence ? { historicalEvidence } : {}) })) },
        traceId: randomUUID(),
      });
    }
    return { releaseId: current.id, mode: apply ? "apply" : "preflight", candidates: report };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (!process.env.DATABASE_URL || args.length > 1 || (args[0] !== undefined && args[0] !== "--preflight" && args[0] !== "--apply")) {
    console.error("Usage: DATABASE_URL=... npx tsx scripts/catalog-claim-child-owners.ts [--preflight|--apply]");
    process.exitCode = 2;
  } else {
    const db = createPostgresDatabase(process.env.DATABASE_URL);
    try { console.log(JSON.stringify(await claimCatalogChildOwners(db, path.resolve("schemas/dts"), args[0] === "--apply"), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : "catalog-owner-claim-failed"); process.exitCode = 1; }
    finally { await db.close(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
