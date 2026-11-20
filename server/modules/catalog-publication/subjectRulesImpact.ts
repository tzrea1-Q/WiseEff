import type { Queryable } from "../../shared/database/client";
import type { CatalogReleaseDocument, CatalogReleaseSubjectDocument } from "../catalog-kernel/compiler/types";
import type { SubjectRulesImpact } from "../contracts/dtoSchemas/catalogSubjectIdentity";
import { listModuleRecognitionInstances } from "../parameter-modules/recognitionInstances";
import { sha256Digest } from "./builder/bundleCodec";

type Subject = CatalogReleaseSubjectDocument["content"];
type ProjectScope = { kind: "all" } | { kind: "only"; ids: readonly string[] };
type Registration = {
  id: string; organizationId: string; subjectId: string; status: "active" | "retired";
  cascadeRetired: boolean; ownerOverride: string | null; cardinalityOverride: "multiple" | "singleton-per-project" | null;
  compatibles: string[] | null; nodeName: string | null;
};
type Conflict = SubjectRulesImpact["conflicts"][number] & { organizationId: string };

export async function inspectSubjectRulesImpact(db: Queryable, input: {
  subjectId: string; before: readonly CatalogReleaseDocument[]; after: readonly CatalogReleaseDocument[];
  organizationId: string; projectScope?: ProjectScope;
}): Promise<{ impact: SubjectRulesImpact; fingerprint: string }> {
  const subjects = (documents: readonly CatalogReleaseDocument[]) => new Map(documents.flatMap(document =>
    document.kind === "subject" ? [[document.content.id, document.content] as const] : []));
  const before = subjects(input.before);
  const after = subjects(input.after);
  const previous = before.get(input.subjectId);
  const current = after.get(input.subjectId);
  if (!previous || !current) throw new Error("Subject rules review is missing its subject");
  const successor = current.tombstone?.successorId ? after.get(current.tombstone.successorId) : undefined;
  const selectors = new Map<string, string[]>();
  for (const document of input.after) {
    if (document.kind !== "alias" || document.content.lifecycle !== "active") continue;
    const aliases = selectors.get(document.content.subjectId) ?? [];
    aliases.push(document.content.normalizedSelector);
    selectors.set(document.content.subjectId, aliases);
  }
  const names = (subject: Subject) => [subject.selector.value, ...(selectors.get(subject.id) ?? [])];
  const children = [...before.values()].filter(subject => subject.ownerSubjectId === previous.id)
    .map(child => ({ id: child.id, selector: child.selector.value, inherited: child.ownerSubjectId !== after.get(child.id)?.ownerSubjectId }));
  const sourceIds = [previous.id, ...children.map(child => child.id)];
  const referenceIds = successor ? [...sourceIds, successor.id] : sourceIds;
  const refs = new Set(referenceIds);
  const source = new Set(sourceIds);
  const changingOwner = sourceIds.filter(id => before.get(id)?.ownerSubjectId !== after.get(id)?.ownerSubjectId);
  const relatedDrivers = sourceIds.flatMap(id => [before.get(id)?.ownerSubjectId, after.get(id)?.ownerSubjectId]).filter(Boolean);
  // A local owner override can put any registered node into the reviewed driver scope.
  const registrations = (await db.query<Registration>(`select registration.id,
      registration.organization_id as "organizationId", registration.subject_id as "subjectId",
      registration.status, registration.cascade_retired as "cascadeRetired", registration.owner_subject_id as "ownerOverride",
      rule.instance_cardinality as "cardinalityOverride", rule.compatibles, rule.node_type_name as "nodeName"
    from parameter_catalog.organization_subject_registrations registration
    left join public.registration_recognition_rules rule
      on rule.organization_id=registration.organization_id and rule.registration_id=registration.id
    where registration.subject_id=any($1::text[]) or registration.owner_subject_id=any($1::text[])
      or ($2::boolean and registration.organization_id in (
        select organization_id from parameter_catalog.organization_subject_registrations where subject_id=any($1::text[])))
    order by registration.organization_id, registration.subject_id, registration.id`,
  [[...referenceIds, ...relatedDrivers], changingOwner.length > 0])).rows;
  const affected = registrations.filter(row => refs.has(row.subjectId) || (row.ownerOverride !== null && source.has(row.ownerOverride)));
  const byOrganization = new Map<string, Map<string, Registration>>();
  for (const row of registrations) {
    const org = byOrganization.get(row.organizationId) ?? new Map();
    org.set(row.subjectId, row);
    byOrganization.set(row.organizationId, org);
  }

  const conflicts: Conflict[] = [];
  for (const subjectId of changingOwner) {
    const next = after.get(subjectId)!;
    for (const [organizationId, org] of byOrganization) {
      const row = org.get(subjectId);
      if (row?.ownerOverride) continue;
      if (next.ownerSubjectId && row?.status === "active") {
        if (org.get(next.ownerSubjectId)?.status !== "active") {
          conflicts.push({ organizationId, subjectId, reason: "owner-registration-required" });
        }
      }
      if (next.ownerSubjectId && row && row.cardinalityOverride !== null) {
        conflicts.push({ organizationId, subjectId, reason: "organization-driver-override" });
      }
      const occupied = new Set(row?.nodeName ? [row.nodeName] : names(next));
      if ([...after.values()].some(other => {
        const registration = org.get(other.id);
        return other.id !== next.id && other.kind === "node-type" &&
          (registration?.ownerOverride ?? other.ownerSubjectId) === next.ownerSubjectId &&
          (registration?.nodeName ? [registration.nodeName] : names(other)).some(name => occupied.has(name));
      })) conflicts.push({ organizationId, subjectId, reason: "organization-selector-collision" });
    }
  }

  const inReview = new Set([...referenceIds, ...affected.map(row => row.subjectId)]);
  const bindings = (await db.query<{ organizationId: string; projectId: string; nodeId: string; subjectId: string; count: number }>(
    `select organization_id as "organizationId", project_id as "projectId", subject_id as "subjectId",
       coalesce(logical_node_id,source_occurrence_id,id) as "nodeId", count(*)::int as count
     from parameter_catalog.current_project_parameter_bindings where subject_id=any($1::text[])
     group by organization_id, project_id, subject_id, coalesce(logical_node_id,source_occurrence_id,id)
     order by organization_id, project_id, subject_id, "nodeId"`, [[...inReview]],
  )).rows;
  const projects = new Map<string, { organizationId: string; id: string; bindingCount: number; nodes: Set<string> }>();
  const project = (organizationId: string, id: string) => {
    const key = JSON.stringify([organizationId, id]);
    const entry = projects.get(key) ?? { organizationId, id, bindingCount: 0, nodes: new Set<string>() };
    projects.set(key, entry);
    return entry;
  };
  for (const row of bindings) {
    const entry = project(row.organizationId, row.projectId);
    entry.bindingCount += row.count;
    entry.nodes.add(row.nodeId);
  }

  const singleton = [current, successor].filter((subject): subject is Subject => Boolean(subject?.lifecycle === "active" &&
    "cardinality" in subject.subtype && subject.subtype.cardinality.kind === "singleton-per-project" &&
    (subject.id !== previous.id || !("cardinality" in previous.subtype) ||
      previous.subtype.cardinality.kind !== "singleton-per-project" || previous.lifecycle === "retired")));
  if (singleton.length) {
    const organizations = (await db.query<{ id: string }>(`select organization_id as id
      from public.dts_config_set union select id from public.organizations where id=any($1::text[]) order by id`,
    [[...new Set(bindings.map(row => row.organizationId))]])).rows;
    for (const driver of singleton) {
      for (const { id: organizationId } of organizations) {
        const override = byOrganization.get(organizationId)?.get(driver.id);
        const nodesByProject = new Map<string, Set<string>>();
        const add = (projectId: string, nodeId: string) => {
          const nodes = nodesByProject.get(projectId) ?? new Set<string>();
          nodes.add(nodeId);
          nodesByProject.set(projectId, nodes);
          project(organizationId, projectId).nodes.add(nodeId);
        };
        for (const row of bindings) {
          if (row.organizationId === organizationId && row.subjectId === driver.id) add(row.projectId, row.nodeId);
        }
        for (const row of await listModuleRecognitionInstances(db, organizationId, {
          compatibles: override?.compatibles ?? names(driver), nodeTypeName: null,
        })) add(row.projectId, row.logicalNodeId);
        if (override?.cardinalityOverride === "multiple") continue;
        for (const [projectId, nodes] of nodesByProject) if (nodes.size > 1) {
          conflicts.push({ organizationId, projectId, subjectId: driver.id, reason: "singleton-project", instanceCount: nodes.size });
        }
      }
    }
  }

  const state = (subject: Subject) => ({
    kind: subject.kind, selector: subject.selector.value, lifecycle: subject.lifecycle, ownerSubjectId: subject.ownerSubjectId ?? null,
    ...("nature" in subject.subtype ? { defaults: { nature: subject.subtype.nature, cardinality: subject.subtype.cardinality.kind } } : {}),
  });
  const scoped = (organizationId: string) => organizationId === input.organizationId;
  const visibleProject = (id: string) => input.projectScope?.kind === "all" ||
    (input.projectScope?.kind === "only" && input.projectScope.ids.includes(id));
  const totals = new Map<Conflict["reason"], number>();
  for (const conflict of conflicts) totals.set(conflict.reason, (totals.get(conflict.reason) ?? 0) + 1);
  const projectsWithCounts = [...projects.values()].map(({ nodes, ...entry }) => ({ ...entry, instanceCount: nodes.size }));
  const impact: SubjectRulesImpact = {
    before: state(previous), after: state(current), ...(successor ? { successor: { id: successor.id, ...state(successor) } } : {}),
    children,
    definitions: input.before.flatMap(document => document.kind === "definition" && inReview.has(document.content.subjectId) &&
      document.content.revision.lifecycle === "active"
      ? [{ id: document.content.id, propertyKey: document.content.propertyKey, subjectId: document.content.subjectId }] : []),
    registrationCounts: {
      active: affected.filter(row => row.status === "active").length,
      independentlyRetired: affected.filter(row => row.status === "retired" && !row.cascadeRetired).length,
      cascadeRetired: affected.filter(row => row.status === "retired" && row.cascadeRetired).length,
      ownerOverrides: affected.filter(row => row.ownerOverride !== null).length,
      recognitionOverrides: affected.filter(row => row.compatibles !== null).length,
      sharedSuspended: affected.filter(row => row.status === "active" && (after.get(row.subjectId)?.lifecycle === "retired" ||
        after.get(row.ownerOverride ?? after.get(row.subjectId)?.ownerSubjectId ?? "")?.lifecycle === "retired")).length,
    },
    registrations: affected.filter(row => scoped(row.organizationId)).map(({ organizationId: _org, compatibles: _compatibles, nodeName: _nodeName, ...row }) => row),
    projectCount: projects.size,
    bindingCount: bindings.reduce((count, row) => count + row.count, 0),
    projects: projectsWithCounts.filter(row => scoped(row.organizationId) && visibleProject(row.id))
      .map(({ organizationId: _org, ...project }) => project),
    conflictCounts: [...totals].map(([reason, count]) => ({ reason, count })),
    conflicts: conflicts.filter(row => scoped(row.organizationId) && (!row.projectId || visibleProject(row.projectId)))
      .map(({ organizationId: _org, ...conflict }) => conflict),
  };
  return { impact, fingerprint: sha256Digest(JSON.stringify({
    affected, conflicts, bindings, projects: [...projects.values()].map(({ nodes, ...project }) => ({
      ...project, nodes: [...nodes].sort(),
    })),
  })) };
}
