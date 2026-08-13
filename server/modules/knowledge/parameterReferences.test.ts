import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import {
  addKnowledgeParameterReference,
  archiveKnowledgeEntry,
  createKnowledgeEntry,
  findRelatedKnowledgeForSpec,
  getKnowledgeEntry,
  hardDeleteKnowledgeEntry,
  publishKnowledgeEntry,
  removeKnowledgeParameterReference
} from "./service";
import { createDefaultKnowledgeTextExtractor } from "./extraction";
import type { ObjectStore } from "../logs/objectStore";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-kb-xref";
const OTHER_ORG_ID = "org-kb-xref-other";
const EDITOR_A = "user-xref-editor-a";
const EDITOR_B = "user-xref-editor-b";
const VIEWER = "user-xref-viewer";
const MANAGER = "user-xref-manager";
const OTHER_ORG_EDITOR = "user-xref-foreign";

const SPEC_ORG = "pspec:xref-org-spec";
const SPEC_GLOBAL = "pspec:xref-global-spec";
const SPEC_FOREIGN = "pspec:xref-foreign-spec";

const viewEdit: BackendPermission[] = ["knowledge:view", "knowledge:edit"];
const viewOnly: BackendPermission[] = ["knowledge:view"];
const manageAll: BackendPermission[] = ["knowledge:view", "knowledge:edit", "knowledge:manage"];

function makeAuth(userId: string, permissions: BackendPermission[], organizationId = ORG_ID): AuthContext {
  return {
    user: { id: userId, organizationId, name: userId, title: "Engineer", isActive: true },
    organization: { id: organizationId, name: organizationId },
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions
  };
}

const extractor = createDefaultKnowledgeTextExtractor();

const unusedObjectStore: ObjectStore = {
  async put() {
    throw new Error("not used");
  },
  async get() {
    throw new Error("not used");
  }
};

async function seedOrganizationsAndUsers(db: InMemoryTestDatabase) {
  for (const [orgId, name] of [
    [ORG_ID, "KB Xref Org"],
    [OTHER_ORG_ID, "KB Xref Other Org"]
  ] as const) {
    await db.query(`insert into organizations (id, name) values ($1, $2) on conflict (id) do update set name = excluded.name`, [
      orgId,
      name
    ]);
  }
  for (const [userId, orgId] of [
    [EDITOR_A, ORG_ID],
    [EDITOR_B, ORG_ID],
    [VIEWER, ORG_ID],
    [MANAGER, ORG_ID],
    [OTHER_ORG_EDITOR, OTHER_ORG_ID]
  ] as const) {
    await db.query(
      `
      insert into users (id, organization_id, name, title, is_active)
      values ($1, $2, $1, 'Engineer', true)
      on conflict (id) do update set organization_id = excluded.organization_id
      `,
      [userId, orgId]
    );
  }
}

/**
 * Seeds a definition the way the catalog stores it: a parameter_specs row plus
 * an attribution subject (module label) and an active version (display name).
 */
async function seedSpec(
  db: InMemoryTestDatabase,
  input: {
    specId: string;
    organizationId: string | null;
    propertyKey: string;
    displayName?: string;
    subjectName?: string;
    lifecycle?: "draft" | "active" | "deprecated";
  }
) {
  const subjectId = `asub:${input.specId}`;
  await db.query(
    `
    insert into attribution_subjects (id, organization_id, subject_kind, display_name, source_key)
    values ($1, $2, 'driver-registration', $3, $1)
    on conflict (id) do nothing
    `,
    [subjectId, input.organizationId, input.subjectName ?? "Charge Pump Driver"]
  );
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key, property_key, attribution_subject_id, definition_lifecycle)
    values ($1, $2, 'manual', $3, $4, $5, $6)
    `,
    [
      input.specId,
      input.organizationId,
      `manual/${input.specId}/${input.propertyKey}`,
      input.propertyKey,
      subjectId,
      input.lifecycle ?? "active"
    ]
  );
  await db.query(
    `
    insert into parameter_spec_versions (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status)
    values ($1, $2, 1, $3, '', '{"kind":"int32"}'::jsonb, $4, 'active')
    `,
    [`${input.specId}:v1`, input.specId, input.displayName ?? input.propertyKey, input.lifecycle ?? "active"]
  );
}

async function createMarkdownEntry(db: InMemoryTestDatabase, auth: AuthContext, title: string) {
  return createKnowledgeEntry(
    db,
    unusedObjectStore,
    extractor,
    auth,
    { contentForm: "markdown", title, tags: ["xref"], contentMarkdown: "body" },
    { requestId: `req-${randomUUID().slice(0, 8)}` }
  );
}

async function listReferenceAudits(db: InMemoryTestDatabase, entryId: string) {
  const result = await db.query<{ kind: string; action: string; metadata: Record<string, unknown> }>(
    `
    select kind, action, metadata
    from audit_events
    where organization_id = $1 and target_id = $2 and kind like 'knowledge-parameter-reference%'
    order by created_at asc
    `,
    [ORG_ID, entryId]
  );
  return result.rows;
}

describe.skipIf(!databaseAvailable)("knowledge parameter references", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedOrganizationsAndUsers(db);
    await seedSpec(db, {
      specId: SPEC_ORG,
      organizationId: ORG_ID,
      propertyKey: "charge_pump_ratio",
      displayName: "充电泵比率",
      subjectName: "SC8562"
    });
    await seedSpec(db, {
      specId: SPEC_GLOBAL,
      organizationId: null,
      propertyKey: "global_current_limit",
      displayName: "全局限流"
    });
    await seedSpec(db, {
      specId: SPEC_FOREIGN,
      organizationId: OTHER_ORG_ID,
      propertyKey: "foreign_only_key"
    });
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("adds a reference with chip fields, audit evidence, and idempotent re-add", async () => {
    const auth = makeAuth(EDITOR_A, viewEdit);
    const entry = await createMarkdownEntry(db, auth, "Tuning notes");

    const withReference = await addKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_ORG });
    expect(withReference.parameterReferences).toHaveLength(1);
    expect(withReference.parameterReferences[0]).toMatchObject({
      specId: SPEC_ORG,
      propertyKey: "charge_pump_ratio",
      displayName: "充电泵比率",
      driverModule: "SC8562",
      lifecycle: "active",
      createdByUserId: EDITOR_A
    });

    // Idempotent: the second PUT changes nothing and writes no second audit.
    const again = await addKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_ORG });
    expect(again.parameterReferences).toHaveLength(1);

    const audits = await listReferenceAudits(db, entry.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ kind: "knowledge-parameter-reference-add", action: "parameter-reference-add" });
    expect(audits[0].metadata).toMatchObject({ specId: SPEC_ORG, propertyKey: "charge_pump_ratio" });
  });

  it("references platform-global definitions and removes references with audit evidence", async () => {
    const auth = makeAuth(EDITOR_A, viewEdit);
    const entry = await createMarkdownEntry(db, auth, "Global spec notes");

    const withReference = await addKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_GLOBAL });
    expect(withReference.parameterReferences.map((reference) => reference.specId)).toEqual([SPEC_GLOBAL]);

    const removed = await removeKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_GLOBAL });
    expect(removed.parameterReferences).toHaveLength(0);

    const audits = await listReferenceAudits(db, entry.id);
    expect(audits.map((audit) => audit.kind)).toEqual([
      "knowledge-parameter-reference-add",
      "knowledge-parameter-reference-remove"
    ]);
  });

  it("refuses references to another tenant's spec and to unknown specs with 404", async () => {
    const auth = makeAuth(EDITOR_A, viewEdit);
    const entry = await createMarkdownEntry(db, auth, "Scope test");

    await expect(
      addKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_FOREIGN })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      addKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: "pspec:does-not-exist" })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("enforces publisher accountability: non-owner edit is 403, manager may govern, viewer may not", async () => {
    const owner = makeAuth(EDITOR_A, viewEdit);
    const entry = await createMarkdownEntry(db, owner, "Ownership test");
    await publishKnowledgeEntry(db, owner, entry.id);

    await expect(
      addKnowledgeParameterReference(db, makeAuth(EDITOR_B, viewEdit), { entryId: entry.id, specId: SPEC_ORG })
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      addKnowledgeParameterReference(db, makeAuth(VIEWER, viewOnly), { entryId: entry.id, specId: SPEC_ORG })
    ).rejects.toMatchObject({ status: 403 });

    const managed = await addKnowledgeParameterReference(db, makeAuth(MANAGER, manageAll), {
      entryId: entry.id,
      specId: SPEC_ORG
    });
    expect(managed.parameterReferences).toHaveLength(1);

    await expect(
      removeKnowledgeParameterReference(db, makeAuth(EDITOR_B, viewEdit), { entryId: entry.id, specId: SPEC_ORG })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("keeps other organizations' entries invisible to reference edits", async () => {
    const owner = makeAuth(EDITOR_A, viewEdit);
    const entry = await createMarkdownEntry(db, owner, "Org isolation");

    const foreign = makeAuth(OTHER_ORG_EDITOR, manageAll, OTHER_ORG_ID);
    await expect(
      addKnowledgeParameterReference(db, foreign, { entryId: entry.id, specId: SPEC_FOREIGN })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses reference edits on archived entries, like content edits", async () => {
    const auth = makeAuth(EDITOR_A, viewEdit);
    const entry = await createMarkdownEntry(db, auth, "Archive refusal");
    await addKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_ORG });
    await publishKnowledgeEntry(db, auth, entry.id);
    await archiveKnowledgeEntry(db, auth, entry.id);

    await expect(
      addKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_GLOBAL })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      removeKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_ORG })
    ).rejects.toMatchObject({ status: 400 });

    // The rows themselves survive the archive (integrity rule).
    const archived = await getKnowledgeEntry(db, auth, entry.id);
    expect(archived.parameterReferences).toHaveLength(1);
  });

  it("removing a reference that does not exist is 404", async () => {
    const auth = makeAuth(EDITOR_A, viewEdit);
    const entry = await createMarkdownEntry(db, auth, "Missing removal");

    await expect(
      removeKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_ORG })
    ).rejects.toMatchObject({ status: 404 });
  });

  describe("parameter-side related knowledge (published-only invariant)", () => {
    it("shows published entries only — drafts and archived never appear, even to a manager", async () => {
      const editor = makeAuth(EDITOR_A, viewEdit);
      const manager = makeAuth(MANAGER, manageAll);

      const published = await createMarkdownEntry(db, editor, "Published referencing entry");
      await addKnowledgeParameterReference(db, editor, { entryId: published.id, specId: SPEC_ORG });
      await publishKnowledgeEntry(db, editor, published.id);

      const draft = await createMarkdownEntry(db, editor, "Draft referencing entry");
      await addKnowledgeParameterReference(db, editor, { entryId: draft.id, specId: SPEC_ORG });

      const archived = await createMarkdownEntry(db, editor, "Archived referencing entry");
      await addKnowledgeParameterReference(db, editor, { entryId: archived.id, specId: SPEC_ORG });
      await publishKnowledgeEntry(db, editor, archived.id);
      await archiveKnowledgeEntry(db, editor, archived.id);

      for (const caller of [makeAuth(VIEWER, viewOnly), editor, manager]) {
        const related = await findRelatedKnowledgeForSpec(db, caller, { specId: SPEC_ORG });
        expect(related.items.map((item) => item.entryId)).toEqual([published.id]);
        expect(related.items[0]).toMatchObject({ title: "Published referencing entry" });
        expect(related.items[0].revisionId).toBeTruthy();
      }
    });

    it("requires knowledge:view and stays organization-scoped", async () => {
      const editor = makeAuth(EDITOR_A, viewEdit);
      const entry = await createMarkdownEntry(db, editor, "Scoped entry");
      await addKnowledgeParameterReference(db, editor, { entryId: entry.id, specId: SPEC_ORG });
      await publishKnowledgeEntry(db, editor, entry.id);

      await expect(
        findRelatedKnowledgeForSpec(db, makeAuth(EDITOR_B, [] as BackendPermission[]), { specId: SPEC_ORG })
      ).rejects.toMatchObject({ status: 403 });

      // Another tenant cannot see this org's spec at all (404, like the spec API).
      await expect(
        findRelatedKnowledgeForSpec(db, makeAuth(OTHER_ORG_EDITOR, viewOnly, OTHER_ORG_ID), { specId: SPEC_ORG })
      ).rejects.toMatchObject({ status: 404 });

      // A global spec resolves for both tenants but each only sees its own entries.
      await addKnowledgeParameterReference(db, editor, { entryId: entry.id, specId: SPEC_GLOBAL });
      const foreignView = await findRelatedKnowledgeForSpec(db, makeAuth(OTHER_ORG_EDITOR, viewOnly, OTHER_ORG_ID), {
        specId: SPEC_GLOBAL
      });
      expect(foreignView.items).toHaveLength(0);
    });

    it("unknown specs are 404", async () => {
      await expect(
        findRelatedKnowledgeForSpec(db, makeAuth(VIEWER, viewOnly), { specId: "pspec:missing" })
      ).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe("integrity rules", () => {
    it("survives spec deprecation and reports the lifecycle honestly (ADR-0011)", async () => {
      const auth = makeAuth(EDITOR_A, viewEdit);
      const entry = await createMarkdownEntry(db, auth, "Deprecation survival");
      await addKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_ORG });
      await publishKnowledgeEntry(db, auth, entry.id);

      await db.query(`update parameter_specs set definition_lifecycle = 'deprecated' where id = $1`, [SPEC_ORG]);

      const reloaded = await getKnowledgeEntry(db, auth, entry.id);
      expect(reloaded.parameterReferences).toHaveLength(1);
      expect(reloaded.parameterReferences[0].lifecycle).toBe("deprecated");

      // The parameter side keeps listing the published entry too.
      const related = await findRelatedKnowledgeForSpec(db, auth, { specId: SPEC_ORG });
      expect(related.items.map((item) => item.entryId)).toEqual([entry.id]);
    });

    it("survives an ADR-0017 identity correction (surrogate id does not move)", async () => {
      const auth = makeAuth(EDITOR_A, viewEdit);
      const entry = await createMarkdownEntry(db, auth, "Identity correction survival");
      await addKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_ORG });

      // Re-attribution + property-key rename rewrite identity columns in place.
      const subjectId = `asub:${SPEC_GLOBAL}`;
      await db.query(
        `update parameter_specs set attribution_subject_id = $2, property_key = $3, specification_key = $4 where id = $1`,
        [SPEC_ORG, subjectId, "renamed_property_key", `manual/${SPEC_ORG}/renamed_property_key`]
      );

      const reloaded = await getKnowledgeEntry(db, auth, entry.id);
      expect(reloaded.parameterReferences).toHaveLength(1);
      expect(reloaded.parameterReferences[0].specId).toBe(SPEC_ORG);
      expect(reloaded.parameterReferences[0].propertyKey).toBe("renamed_property_key");
    });

    it("entry hard delete cascades reference rows and audits the count", async () => {
      const manager = makeAuth(MANAGER, manageAll);
      const entry = await createMarkdownEntry(db, manager, "Cascade on delete");
      await addKnowledgeParameterReference(db, manager, { entryId: entry.id, specId: SPEC_ORG });
      await addKnowledgeParameterReference(db, manager, { entryId: entry.id, specId: SPEC_GLOBAL });

      await hardDeleteKnowledgeEntry(db, manager, entry.id, { requestId: "req-xref-delete" });

      const rows = await db.query<{ count: string | number }>(
        `select count(*)::int as count from knowledge_parameter_references where entry_id = $1`,
        [entry.id]
      );
      expect(Number(rows.rows[0].count)).toBe(0);

      const audits = await db.query<{ metadata: Record<string, unknown> }>(
        `select metadata from audit_events where organization_id = $1 and target_id = $2 and kind = 'knowledge-entry-delete'`,
        [ORG_ID, entry.id]
      );
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0].metadata).toMatchObject({ parameterReferenceCount: 2 });
    });

    it("spec rows with references refuse deletion (no silent reference loss)", async () => {
      const auth = makeAuth(EDITOR_A, viewEdit);
      const entry = await createMarkdownEntry(db, auth, "FK restraint");
      await addKnowledgeParameterReference(db, auth, { entryId: entry.id, specId: SPEC_ORG });

      // The catalog has no spec hard-delete path; if one ever appears it must
      // decide reference disposition explicitly — the FK makes that a hard error.
      await expect(db.query(`delete from parameter_specs where id = $1`, [SPEC_ORG])).rejects.toThrow();
    });
  });
});
