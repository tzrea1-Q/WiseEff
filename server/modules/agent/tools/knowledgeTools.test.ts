import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../../auth/types";
import type { ObjectStore } from "../../logs/objectStore";
import type { InMemoryTestDatabase } from "../../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../../testing/testDatabase";
import { createDefaultKnowledgeTextExtractor } from "../../knowledge/extraction";
import { processNextKnowledgeIndexJob } from "../../knowledge/indexing/worker";
import { createKnowledgeEntry, publishKnowledgeEntry } from "../../knowledge/service";
import { createAgentToolRegistry } from "../toolRegistry";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-kb-tools";
const OTHER_ORG_ID = "org-kb-tools-other";
const EDITOR = "user-kb-tools-editor";
const MEMBER = "user-kb-tools-member";
const OUTSIDER = "user-kb-tools-outsider";

function makeAuth(userId: string, permissions: BackendPermission[], organizationId = ORG_ID): AuthContext {
  return {
    user: { id: userId, organizationId, name: userId, title: "Engineer", isActive: true },
    organization: { id: organizationId, name: organizationId },
    // A plain project-scoped member: knowledge tools must not demand global admin.
    roles: [{ projectId: "aurora", roleId: "hardware-user" }],
    permissions
  };
}

function createFakeObjectStore(): ObjectStore {
  const objects = new Map<string, Buffer>();
  return {
    async put(input) {
      const checksum = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = `${input.organizationId}/${checksum}-${input.fileName}`;
      objects.set(storageKey, input.bytes);
      return {
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.byteLength,
        checksumSha256: checksum
      };
    },
    async get(storageKey) {
      const bytes = objects.get(storageKey);
      if (!bytes) throw new Error(`Missing object: ${storageKey}`);
      return bytes;
    }
  };
}

describe("knowledge tool registration", () => {
  it("registers both read tools as auto-executing organization-scoped knowledge:view tools", () => {
    const registry = createAgentToolRegistry({ db: { query: async () => ({ rows: [], rowCount: 0 }) } as never });

    const search = registry.get("knowledge.search");
    expect(search).toMatchObject({
      kind: "read",
      permission: "knowledge:view",
      requiresApproval: false,
      scope: "organization"
    });
    const getDocument = registry.get("knowledge.getDocument");
    expect(getDocument).toMatchObject({
      kind: "read",
      permission: "knowledge:view",
      requiresApproval: false,
      scope: "organization"
    });
  });
});

describe.skipIf(!databaseAvailable)("knowledge tools against the knowledge service", () => {
  let db: InMemoryTestDatabase;
  let publishedEntryId: string;
  let draftEntryId: string;
  const editor = makeAuth(EDITOR, ["knowledge:view", "knowledge:edit"]);
  const extractor = createDefaultKnowledgeTextExtractor();

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    for (const orgId of [ORG_ID, OTHER_ORG_ID]) {
      await db.query(`insert into organizations (id, name) values ($1, $1) on conflict (id) do nothing`, [orgId]);
    }
    for (const [userId, orgId] of [
      [EDITOR, ORG_ID],
      [MEMBER, ORG_ID],
      [OUTSIDER, OTHER_ORG_ID]
    ] as const) {
      await db.query(
        `insert into users (id, organization_id, name, title, is_active) values ($1, $2, $1, 'Engineer', true)
         on conflict (id) do update set organization_id = excluded.organization_id`,
        [userId, orgId]
      );
    }

    const objectStore = createFakeObjectStore();
    const published = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "markdown",
      title: "快充温控调参经验",
      tags: ["快充"],
      contentMarkdown: "当电池温度超过 45 度时,按 0.5A 步长下调快充电流。"
    });
    publishedEntryId = published.id;
    await publishKnowledgeEntry(db, editor, publishedEntryId);
    while ((await processNextKnowledgeIndexJob({ db })) !== "idle") {
      // drain the index queue so chunk-backed retrieval is live
    }

    const draft = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "markdown",
      title: "未发布草稿",
      tags: [],
      contentMarkdown: "草稿独占关键词:玄武岩纤维。"
    });
    draftEntryId = draft.id;
  });

  afterEach(async () => {
    await db.rollback();
  });

  function registryFor() {
    return createAgentToolRegistry({ db });
  }

  it("knowledge.search runs for a project-less org member under their AuthContext and returns citation payloads", async () => {
    const registry = registryFor();
    const member = makeAuth(MEMBER, ["knowledge:view"]);

    // No projectId in context or payload: organization scope must not demand one.
    const result = await registry.run(
      "knowledge.search",
      { auth: member, requestId: "req-1", sessionId: "session-1" },
      { query: "快充温控" }
    );

    expect(result.summary).toContain("Found 1");
    expect(result.data.retrievalMode).toBe("fts_only");
    expect(result.citations).toEqual([
      expect.objectContaining({
        type: "knowledge",
        id: publishedEntryId,
        label: "快充温控调参经验",
        href: `/knowledge?entryId=${publishedEntryId}`
      })
    ]);
    expect(result.citations[0].snippet).toBeTruthy();
  });

  it("knowledge.search never surfaces drafts and enforces knowledge:view", async () => {
    const registry = registryFor();
    const member = makeAuth(MEMBER, ["knowledge:view"]);

    const draftSearch = await registry.run(
      "knowledge.search",
      { auth: member, requestId: "req-2", sessionId: "session-1" },
      { query: "玄武岩纤维" }
    );
    expect(draftSearch.citations).toHaveLength(0);

    const noPermission = makeAuth(MEMBER, ["parameter:view"]);
    await expect(
      registry.run("knowledge.search", { auth: noPermission, requestId: "req-3", sessionId: "session-1" }, { query: "快充" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("knowledge.search stays organization-isolated", async () => {
    const registry = registryFor();
    const outsider = makeAuth(OUTSIDER, ["knowledge:view"], OTHER_ORG_ID);

    const result = await registry.run(
      "knowledge.search",
      { auth: outsider, requestId: "req-4", sessionId: "session-1" },
      { query: "快充温控" }
    );
    expect(result.citations).toHaveLength(0);
  });

  it("knowledge.getDocument returns published content with citations and rejects drafts even for the owner", async () => {
    const registry = registryFor();
    const member = makeAuth(MEMBER, ["knowledge:view"]);

    const document = await registry.run(
      "knowledge.getDocument",
      { auth: member, requestId: "req-5", sessionId: "session-1" },
      { entryId: publishedEntryId }
    );
    expect(document.data).toMatchObject({ entryId: publishedEntryId, contentForm: "markdown", truncated: false });
    expect(String(document.data.content)).toContain("45 度");
    expect(document.data.referencedParameters).toEqual([]);
    expect(document.citations[0]).toMatchObject({ type: "knowledge", id: publishedEntryId });

    await expect(
      registry.run("knowledge.getDocument", { auth: editor, requestId: "req-6", sessionId: "session-1" }, { entryId: draftEntryId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("knowledge.getDocument names the entry's referenced definitions with honest lifecycles", async () => {
    const specId = "pspec:kb-tools-ratio";
    await db.query(
      `insert into attribution_subjects (id, organization_id, subject_kind, display_name, source_key)
       values ($1, $2, 'driver-registration', 'SC8562', $1)`,
      [`asub:${specId}`, ORG_ID]
    );
    await db.query(
      `insert into parameter_specs (id, organization_id, source_kind, specification_key, property_key, attribution_subject_id, definition_lifecycle)
       values ($1, $2, 'manual', $3, 'charge_pump_ratio', $4, 'deprecated')`,
      [specId, ORG_ID, `manual/${specId}/charge_pump_ratio`, `asub:${specId}`]
    );
    await db.query(
      `insert into parameter_spec_versions (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status)
       values ($1, $2, 1, '充电泵比率', '', '{"kind":"int32"}'::jsonb, 'deprecated', 'active')`,
      [`${specId}:v1`, specId]
    );
    const { addKnowledgeParameterReference } = await import("../../knowledge/service");
    await addKnowledgeParameterReference(db, editor, { entryId: publishedEntryId, specId });

    const registry = registryFor();
    const document = await registry.run(
      "knowledge.getDocument",
      { auth: makeAuth(MEMBER, ["knowledge:view"]), requestId: "req-9", sessionId: "session-1" },
      { entryId: publishedEntryId }
    );
    expect(document.data.referencedParameters).toEqual([
      { specId, name: "充电泵比率", lifecycle: "deprecated" }
    ]);
  });

  it("validates tool payloads", async () => {
    const registry = registryFor();
    const member = makeAuth(MEMBER, ["knowledge:view"]);

    await expect(
      registry.run("knowledge.search", { auth: member, requestId: "req-7", sessionId: "session-1" }, {})
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      registry.run("knowledge.getDocument", { auth: member, requestId: "req-8", sessionId: "session-1" }, {})
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
