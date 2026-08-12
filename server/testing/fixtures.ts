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
