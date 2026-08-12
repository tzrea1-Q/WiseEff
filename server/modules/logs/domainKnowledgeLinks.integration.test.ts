import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { searchPublishedKnowledgeForLogAnalysis } from "../knowledge/logDomainRetrieval";
import { createDbLogAnalysisToolBackends } from "./analyzer/tools/dbToolBackends";
import {
  createLogDomainRecord,
  listLogDomainKnowledgeLinkRecords,
  setLogDomainKnowledgeLinkRecords
} from "./domainsService";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-log-kb-links";
const OTHER_ORG_ID = "org-log-kb-links-other";
const ADMIN_ID = "user-log-kb-admin";
const OTHER_ADMIN_ID = "user-log-kb-foreign";

const adminPermissions: BackendPermission[] = ["logs:view", "logs:admin-domains", "knowledge:view", "knowledge:edit"];

function makeAuth(userId: string, organizationId: string): AuthContext {
  return {
    user: { id: userId, organizationId, name: userId, title: "Admin", isActive: true },
    organization: { id: organizationId, name: organizationId },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: [...adminPermissions]
  };
}

async function seedCore(db: InMemoryTestDatabase) {
  for (const orgId of [ORG_ID, OTHER_ORG_ID]) {
    await db.query(`insert into organizations (id, name) values ($1, $1) on conflict (id) do nothing`, [orgId]);
  }
  for (const [userId, orgId] of [
    [ADMIN_ID, ORG_ID],
    [OTHER_ADMIN_ID, OTHER_ORG_ID]
  ] as const) {
    await db.query(
      `insert into users (id, organization_id, name, title, is_active)
       values ($1, $2, $1, 'Admin', true)
       on conflict (id) do update set organization_id = excluded.organization_id`,
      [userId, orgId]
    );
  }
}

async function seedKnowledgeEntry(
  db: InMemoryTestDatabase,
  input: { organizationId: string; createdBy: string; title: string; content: string; status: "draft" | "published" | "archived" }
): Promise<string> {
  const entryId = randomUUID();
  const revisionId = randomUUID();
  const searchText = `${input.title}\n${input.content}`;
  await db.query(
    `insert into knowledge_entries (id, organization_id, title, content_form, status, tags, source_type, created_by_user_id, search_text, head_revision_number)
     values ($1, $2, $3, 'markdown', $4, '{}', 'human', $5, $6, 1)`,
    [entryId, input.organizationId, input.title, input.status, input.createdBy, searchText]
  );
  await db.query(
    `insert into knowledge_revisions (id, entry_id, organization_id, revision_number, title, tags, content_markdown, author_user_id)
     values ($1, $2, $3, 1, $4, '{}', $5, $6)`,
    [revisionId, entryId, input.organizationId, input.title, input.content, input.createdBy]
  );
  await db.query(`update knowledge_entries set head_revision_id = $2 where id = $1`, [entryId, revisionId]);
  return entryId;
}

describe.skipIf(!databaseAvailable)("log domain knowledge links (integration)", () => {
  let db: InMemoryTestDatabase;
  let auth: AuthContext;
  let domainId: string;
  let publishedEntryId: string;
  let secondPublishedEntryId: string;
  let draftEntryId: string;
  let foreignPublishedEntryId: string;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    auth = makeAuth(ADMIN_ID, ORG_ID);
    await seedCore(db);

    const domain = await createLogDomainRecord(
      db,
      auth,
      { name: "charging-power", description: "Charging subsystem kernel log" },
      { requestId: "req-links-setup" }
    );
    domainId = domain.id;

    publishedEntryId = await seedKnowledgeEntry(db, {
      organizationId: ORG_ID,
      createdBy: ADMIN_ID,
      title: "E_THERMAL_FOLDBACK handbook",
      content: "E_THERMAL_FOLDBACK means thermal protection reduced the charge output.",
      status: "published"
    });
    secondPublishedEntryId = await seedKnowledgeEntry(db, {
      organizationId: ORG_ID,
      createdBy: ADMIN_ID,
      title: "Generic charging note",
      content: "Generic thermal foldback background outside the domain link set.",
      status: "published"
    });
    draftEntryId = await seedKnowledgeEntry(db, {
      organizationId: ORG_ID,
      createdBy: ADMIN_ID,
      title: "Draft thermal note",
      content: "Draft content that must never be linkable.",
      status: "draft"
    });
    foreignPublishedEntryId = await seedKnowledgeEntry(db, {
      organizationId: OTHER_ORG_ID,
      createdBy: OTHER_ADMIN_ID,
      title: "Foreign org thermal foldback doc",
      content: "Belongs to another organization; must stay invisible.",
      status: "published"
    });
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("replaces the link set, lists it with entry status, and writes the audit event", async () => {
    const set = await setLogDomainKnowledgeLinkRecords(
      db,
      auth,
      { domainId, knowledgeEntryIds: [publishedEntryId] },
      { requestId: "req-links-set" }
    );
    expect(set.items).toEqual([
      expect.objectContaining({ knowledgeEntryId: publishedEntryId, entryStatus: "published" })
    ]);

    const listed = await listLogDomainKnowledgeLinkRecords(db, auth, domainId);
    expect(listed.items).toHaveLength(1);

    const audit = await db.query<{ kind: string; metadata: { linkedCount?: number } }>(
      `select kind, metadata from audit_events where organization_id = $1 and target_id = $2 and kind = 'log-domain-knowledge-links-update'`,
      [ORG_ID, domainId]
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.linkedCount).toBe(1);

    // Replace with an empty set removes the link.
    const cleared = await setLogDomainKnowledgeLinkRecords(
      db,
      auth,
      { domainId, knowledgeEntryIds: [] },
      { requestId: "req-links-clear" }
    );
    expect(cleared.items).toHaveLength(0);
  });

  it("refuses draft entries and foreign-organization entries", async () => {
    await expect(
      setLogDomainKnowledgeLinkRecords(
        db,
        auth,
        { domainId, knowledgeEntryIds: [draftEntryId] },
        { requestId: "req-links-draft" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await expect(
      setLogDomainKnowledgeLinkRecords(
        db,
        auth,
        { domainId, knowledgeEntryIds: [foreignPublishedEntryId] },
        { requestId: "req-links-foreign" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("restricts read_domain_knowledge retrieval to the linked set and inherits published-only", async () => {
    await setLogDomainKnowledgeLinkRecords(
      db,
      auth,
      { domainId, knowledgeEntryIds: [publishedEntryId] },
      { requestId: "req-links-retrieval" }
    );

    const backends = createDbLogAnalysisToolBackends({ db, organizationId: ORG_ID, logDomainId: domainId });
    const linked = await backends.searchDomainKnowledge!("thermal foldback");
    expect(linked.scope).toBe("domain-linked");
    expect(linked.items.map((item) => item.entryId)).toEqual([publishedEntryId]);

    // Archiving the linked entry drops it from retrieval without touching the link.
    await db.query(`update knowledge_entries set status = 'archived' where id = $1`, [publishedEntryId]);
    const afterArchive = await backends.searchDomainKnowledge!("thermal foldback");
    expect(afterArchive.items).toHaveLength(0);
    const listed = await listLogDomainKnowledgeLinkRecords(db, auth, domainId);
    expect(listed.items[0]).toMatchObject({ knowledgeEntryId: publishedEntryId, entryStatus: "archived" });
  });

  it("falls back to organization-generic retrieval when the domain has no links, never crossing org lines", async () => {
    const result = await searchPublishedKnowledgeForLogAnalysis(db, {
      organizationId: ORG_ID,
      query: "thermal foldback",
      linkedEntryIds: []
    });

    expect(result.scope).toBe("organization-generic");
    const entryIds = result.items.map((item) => item.entryId);
    expect(entryIds).toContain(publishedEntryId);
    expect(entryIds).toContain(secondPublishedEntryId);
    expect(entryIds).not.toContain(draftEntryId);
    expect(entryIds).not.toContain(foreignPublishedEntryId);
  });
});
