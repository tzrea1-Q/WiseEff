import type { Queryable } from "../shared/database/client";

export type OrganizationFixture = {
  id: string;
  name?: string;
};

export type UserFixture = {
  id: string;
  organizationId: string;
  name?: string;
  email?: string;
  title?: string;
  isActive?: boolean;
};

export type ProjectFixture = {
  id: string;
  organizationId: string;
  name?: string;
  code?: string;
  status?: string;
};

export async function seedOrganization(db: Queryable, fixture: OrganizationFixture): Promise<void> {
  await db.query(
    `insert into organizations (id, name)
     values ($1, $2)
     on conflict (id) do update set name = excluded.name`,
    [fixture.id, fixture.name ?? `Org ${fixture.id}`]
  );
}

export async function seedUser(db: Queryable, fixture: UserFixture): Promise<void> {
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do update set
       organization_id = excluded.organization_id,
       name = excluded.name,
       email = excluded.email,
       title = excluded.title,
       is_active = excluded.is_active`,
    [
      fixture.id,
      fixture.organizationId,
      fixture.name ?? `User ${fixture.id}`,
      fixture.email ?? `${fixture.id}@example.com`,
      fixture.title ?? "Admin",
      fixture.isActive ?? true
    ]
  );
}

export async function seedProject(db: Queryable, fixture: ProjectFixture): Promise<void> {
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, $3, $4, $5)
     on conflict (id) do update set
       organization_id = excluded.organization_id,
       name = excluded.name,
       code = excluded.code,
       status = excluded.status`,
    [
      fixture.id,
      fixture.organizationId,
      fixture.name ?? `Project ${fixture.id}`,
      fixture.code ?? fixture.id.slice(0, 8).toUpperCase(),
      fixture.status ?? "initialized"
    ]
  );
}

export type CoreGraphFixture = {
  organization: OrganizationFixture;
  users?: Omit<UserFixture, "organizationId">[];
  projects?: Omit<ProjectFixture, "organizationId">[];
};

/**
 * Seed the organization → users → projects spine that almost every PG-backed suite needs.
 * Domain-specific rows (config sets, parameter definitions, bindings) stay in the suite,
 * closest to the behavior they exercise.
 */
export async function seedCoreGraph(db: Queryable, fixture: CoreGraphFixture): Promise<void> {
  await seedOrganization(db, fixture.organization);
  for (const user of fixture.users ?? []) {
    await seedUser(db, { ...user, organizationId: fixture.organization.id });
  }
  for (const project of fixture.projects ?? []) {
    await seedProject(db, { ...project, organizationId: fixture.organization.id });
  }
}

export type ParameterSpecFixture = {
  id: string;
  specificationKey: string;
  sourceKind?: "dts" | "json" | "manual";
  versions?: {
    id: string;
    version?: number;
    displayName: string;
    description?: string;
    valueShape?: unknown;
    lifecycle?: string;
  }[];
  /** dts_property_specs is unique per spec, so at most one property spec per spec. */
  propertySpec?: {
    id: string;
    propertyKey: string;
    schemaNamespace?: string;
  };
};

export type ParameterModuleFixture = {
  id: string;
  name: string;
  path?: string;
  depth?: number;
};

export type ConfigSetFixture = {
  id: string;
  projectId: string;
  name?: string;
  revisions?: {
    id: string;
    revisionNumber?: number;
    status?: string;
  }[];
  logicalNodes?: {
    id: string;
    revisions?: {
      id: string;
      configRevisionId: string;
      nodeLocator: string;
      name: string;
      compatible?: string;
    }[];
  }[];
};

export type ProjectParameterBindingFixture = {
  id: string;
  projectId: string;
  parameterSpecId: string;
  moduleId: string;
  logicalNodeId?: string;
  revisions?: {
    id: string;
    configRevisionId: string;
    parameterSpecVersionId: string;
    /** Defaults to `rawValue` serialized as a JSON string. */
    typedValue?: unknown;
    rawValue?: string;
  }[];
};

export type SpecBindingGraphFixture = {
  organizationId: string;
  specs?: ParameterSpecFixture[];
  modules?: ParameterModuleFixture[];
  configSets?: ConfigSetFixture[];
  bindings?: ProjectParameterBindingFixture[];
};

/**
 * Seed the semantic parameter-identity graph — parameter_specs → parameter_spec_versions →
 * dts_property_specs, parameter_modules, dts_config_set → dts_config_revisions →
 * dts_logical_nodes (+revisions), and project_parameter_bindings (+binding revisions) —
 * that binding-identified suites hang their rows off. The organization, users, and
 * projects must already exist (seedCoreGraph). Occurrence rows (dts_node_occurrences,
 * dts_property_occurrences, dts_occurrence_effects) stay in the suite: they encode
 * test-specific source positions, not shared identity.
 */
export async function seedSpecBindingGraph(db: Queryable, fixture: SpecBindingGraphFixture): Promise<void> {
  const organizationId = fixture.organizationId;

  for (const spec of fixture.specs ?? []) {
    await db.query(
      `insert into parameter_specs (id, organization_id, source_kind, specification_key)
       values ($1, $2, $3, $4)`,
      [spec.id, organizationId, spec.sourceKind ?? "dts", spec.specificationKey]
    );
    for (const version of spec.versions ?? []) {
      await db.query(
        `insert into parameter_spec_versions (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          version.id,
          spec.id,
          version.version ?? 1,
          version.displayName,
          version.description ?? "",
          JSON.stringify(version.valueShape ?? {}),
          version.lifecycle ?? "active"
        ]
      );
    }
    if (spec.propertySpec) {
      await db.query(
        `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace)
         values ($1, $2, $3, $4)`,
        [spec.propertySpec.id, spec.id, spec.propertySpec.propertyKey, spec.propertySpec.schemaNamespace ?? "wiseeff"]
      );
    }
  }

  for (const module of fixture.modules ?? []) {
    await db.query(
      `insert into parameter_modules (id, organization_id, name, path, depth)
       values ($1, $2, $3, $4, $5)`,
      [module.id, organizationId, module.name, module.path ?? module.id, module.depth ?? 1]
    );
  }

  for (const configSet of fixture.configSets ?? []) {
    await db.query(
      `insert into dts_config_set (id, organization_id, project_id, name)
       values ($1, $2, $3, $4)`,
      [configSet.id, organizationId, configSet.projectId, configSet.name ?? "main"]
    );
    for (const [index, revision] of (configSet.revisions ?? []).entries()) {
      await db.query(
        `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          revision.id,
          organizationId,
          configSet.projectId,
          configSet.id,
          revision.revisionNumber ?? index + 1,
          revision.status ?? "resolved"
        ]
      );
    }
    for (const logicalNode of configSet.logicalNodes ?? []) {
      await db.query(
        `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
         values ($1, $2, $3, $4)`,
        [logicalNode.id, organizationId, configSet.projectId, configSet.id]
      );
      for (const nodeRevision of logicalNode.revisions ?? []) {
        await db.query(
          `insert into dts_logical_node_revisions (id, logical_node_id, config_revision_id, node_locator, name, compatible)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            nodeRevision.id,
            logicalNode.id,
            nodeRevision.configRevisionId,
            nodeRevision.nodeLocator,
            nodeRevision.name,
            nodeRevision.compatible ?? null
          ]
        );
      }
    }
  }

  for (const binding of fixture.bindings ?? []) {
    await db.query(
      `insert into project_parameter_bindings (id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [binding.id, organizationId, binding.projectId, binding.logicalNodeId ?? null, binding.parameterSpecId, binding.moduleId]
    );
    for (const revision of binding.revisions ?? []) {
      await db.query(
        `insert into project_parameter_binding_revisions (id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value)
         values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          revision.id,
          binding.id,
          revision.configRevisionId,
          revision.parameterSpecVersionId,
          JSON.stringify(revision.typedValue ?? revision.rawValue ?? null),
          revision.rawValue ?? null
        ]
      );
    }
  }
}
