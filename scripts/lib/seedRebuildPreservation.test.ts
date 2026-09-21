import { describe, expect, it } from "vitest";

import type { ObjectStore } from "../../server/modules/logs/objectStore";
import type { Queryable } from "../../server/shared/database/client";
import { captureSeedPreservation, verifySeedPreservation } from "./seedRebuildPreservation";

type InventoryRow = {
  schema_name: string;
  table_name: string;
  relkind: string;
  columns: string[];
  primary_key_columns: string[];
};

const inventory = (): InventoryRow[] => [
  {
    schema_name: "public",
    table_name: "users",
    relkind: "r",
    columns: ["id", "organization_id", "email"],
    primary_key_columns: ["id"],
  },
  {
    schema_name: "public",
    table_name: "project_parameter_bindings",
    relkind: "r",
    columns: ["id", "organization_id", "project_id"],
    primary_key_columns: ["id"],
  },
  {
    schema_name: "public",
    table_name: "dts_properties",
    relkind: "r",
    columns: ["id", "node_id", "name"],
    primary_key_columns: ["id"],
  },
  {
    schema_name: "public",
    table_name: "dts_reload_run_targets",
    relkind: "r",
    columns: ["id", "reload_run_id", "binding_id", "disposed_binding_id"],
    primary_key_columns: ["id"],
  },
  {
    schema_name: "public",
    table_name: "audit_subject_links",
    relkind: "r",
    columns: ["audit_event_id", "subject_kind", "semantic_id"],
    primary_key_columns: ["audit_event_id", "subject_kind", "semantic_id"],
  },
  {
    schema_name: "public",
    table_name: "attribution_subjects",
    relkind: "r",
    columns: ["id", "organization_id", "source_key"],
    primary_key_columns: ["id"],
  },
  {
    schema_name: "public",
    table_name: "seed_initialization_runs",
    relkind: "r",
    columns: ["organization_id", "seed_digest", "status"],
    primary_key_columns: ["organization_id", "seed_digest"],
  },
  {
    schema_name: "parameter_catalog",
    table_name: "organization_subject_registrations",
    relkind: "r",
    columns: ["id", "organization_id", "subject_id"],
    primary_key_columns: ["id"],
  },
  {
    schema_name: "parameter_catalog",
    table_name: "catalog_releases",
    relkind: "r",
    columns: ["id", "release_digest"],
    primary_key_columns: ["id"],
  },
  {
    schema_name: "parameter_catalog",
    table_name: "catalog_state",
    relkind: "r",
    columns: ["singleton", "current_catalog_release_id"],
    primary_key_columns: ["singleton"],
  },
];

class FakeDb implements Queryable {
  readonly calls: Array<{ sql: string; values: unknown[] | undefined }> = [];

  constructor(private readonly rows: InventoryRow[], private readonly driftRelations = new Set<string>()) {}

  async query<Row>(sql: string, values?: unknown[]) {
    this.calls.push({ sql, values });
    if (sql.includes("from pg_class relation")) return { rows: this.rows as Row[], rowCount: this.rows.length };
    if (sql.includes("select jsonb_build_array")) return { rows: [] as Row[], rowCount: 0 };
    if (sql.includes("select encode(sha256")) {
      const drifted = [...this.driftRelations].some((relation) => sql.includes(`"${relation.replace(".", '"."')}"`));
      return { rows: (drifted ? [{ hash: "different" }] : []) as Row[], rowCount: drifted ? 1 : 0 };
    }
    if (sql.includes("select distinct storage_key")) return { rows: [] as Row[], rowCount: 0 };
    throw new Error(`unexpected SQL: ${sql}`);
  }
}

const store: ObjectStore = {
  async get() { throw new Error("unexpected unbounded object read"); },
  async getBounded() { throw new Error("unexpected object read"); },
};

describe("seed rebuild preservation", () => {
  it("regenerates safe scopes, allows only explicit append/publication windows, and records no predicates", async () => {
    const db = new FakeDb(inventory());
    const baseline = await captureSeedPreservation(db, store, "org-acme");

    expect(baseline.tables.find((table) => table.relation === "public.project_parameter_bindings")?.mode)
      .toBe("parameter-plane");
    expect(baseline.tables.find((table) => table.relation === "public.dts_properties")?.mode)
      .toBe("target-scoped");
    expect(baseline.tables.find((table) => table.relation === "parameter_catalog.organization_subject_registrations")?.mode)
      .toBe("append-only");
    expect(baseline.tables.find((table) => table.relation === "parameter_catalog.catalog_releases")?.mode)
      .toBe("publication-append");
    expect(baseline.tables.find((table) => table.relation === "parameter_catalog.catalog_state")?.mode)
      .toBe("publication-window");
    expect(baseline.tables.find((table) => table.relation === "public.attribution_subjects")?.mode)
      .toBe("append-only");
    expect(baseline.tables.every((table) => !Object.prototype.hasOwnProperty.call(table, "predicate"))).toBe(true);

    const targetCall = db.calls.find((call) => call.sql.includes('"project_parameter_bindings"'));
    expect(targetCall?.sql).toContain("project_id = $2");
    expect(targetCall?.values).toEqual(["org-acme", "atlas", "aurora", "nebula"]);

    const reloadCall = db.calls.find((call) => call.sql.includes('"dts_reload_run_targets"') && call.sql.includes("where"));
    expect(reloadCall?.sql).toContain("reload_run_id in");
    expect(reloadCall?.sql).toContain('from public.dts_reload_runs run');

    const appendCall = db.calls.find((call) => call.sql.includes('"organization_subject_registrations"') && call.sql.includes("where"));
    expect(appendCall?.sql).toContain("jsonb_build_array");
    expect(appendCall?.sql).not.toContain("organization_id = $1");

    await expect(verifySeedPreservation(db, store, "org-acme", baseline)).resolves.toBeUndefined();
  });

  it("supports composite append-only keys without broad organization exclusion", async () => {
    const db = new FakeDb(inventory());
    const baseline = await captureSeedPreservation(db, store, "org-acme");
    const links = baseline.tables.find((table) => table.relation === "public.audit_subject_links");
    expect(links?.mode).toBe("append-only");
    expect(links?.keyColumns).toEqual(["audit_event_id", "subject_kind", "semantic_id"]);
    expect(links?.ids).toEqual([]);
  });

  it("fails before row reads when the table inventory changes", async () => {
    const baselineDb = new FakeDb(inventory());
    const baseline = await captureSeedPreservation(baselineDb, store, "org-acme");
    const changed = inventory().concat({
      schema_name: "public",
      table_name: "new_runtime_table",
      relkind: "r",
      columns: ["id"],
      primary_key_columns: ["id"],
    });
    const verifyDb = new FakeDb(changed);
    await expect(verifySeedPreservation(verifyDb, store, "org-acme", baseline))
      .rejects.toThrow("seed-rebuild-preservation-schema-drift");
    expect(verifyDb.calls).toHaveLength(1);
  });

  it("rejects a tampered scope classification without executing saved SQL", async () => {
    const db = new FakeDb(inventory());
    const baseline = await captureSeedPreservation(db, store, "org-acme");
    const target = baseline.tables.find((table) => table.relation === "public.dts_properties")!;
    (target as unknown as { mode: string }).mode = "exact; drop table users";
    await expect(verifySeedPreservation(db, store, "org-acme", baseline))
      .rejects.toThrow("seed-rebuild-preservation-scope-drift");
  });

  it("reports bounded table drift before attempting protected object reads", async () => {
    const baselineDb = new FakeDb(inventory());
    const baseline = await captureSeedPreservation(baselineDb, store, "org-acme");
    const verifyDb = new FakeDb(
      inventory(),
      new Set(["public.users", "public.attribution_subjects"]),
    );
    const protectedStore: ObjectStore = {
      async get() { throw new Error("unexpected unbounded object read"); },
      async getBounded() { throw new Error("objects must wait for table preservation"); },
    };
    await expect(verifySeedPreservation(verifyDb, protectedStore, "org-acme", baseline))
      .rejects.toThrow(/public\.users,public\.attribution_subjects/);
    expect(verifyDb.calls.some((call) => call.sql.includes("select distinct storage_key"))).toBe(false);
  });
});
