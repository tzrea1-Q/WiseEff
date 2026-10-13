import "dotenv/config";
import { pathToFileURL } from "node:url";
import { loadServerEnv } from "../server/config/env";
import type { AuthContext } from "../server/modules/auth/types";
import { createDefaultKnowledgeTextExtractor } from "../server/modules/knowledge/extraction";
import { createKnowledgeEntry, listKnowledgeEntries, publishKnowledgeEntry } from "../server/modules/knowledge/service";
import type { ObjectStore } from "../server/modules/logs/objectStore";
import { createProductFeedback, listProductFeedback } from "../server/modules/product-feedback/service";
import { createObjectStoreFromEnv } from "../server/objectStoreFactory";
import { createPostgresDatabase, type Database } from "../server/shared/database/client";

const auth: AuthContext = {
  user: { id: "u-xu-yun", organizationId: "org-chargelab", name: "Xu Yun", title: "Platform Owner", isActive: true },
  organization: { id: "org-chargelab", name: "ChargeLab" },
  roles: [{ projectId: null, roleId: "admin" }],
  permissions: ["knowledge:view", "knowledge:edit", "admin:access"]
};

export async function seedQualityAdminLists(db: Database, objectStore: ObjectStore) {
  const knowledge = await listKnowledgeEntries(db, auth, { status: "published", limit: 1 });
  if (knowledge.length === 0) {
    const entry = await createKnowledgeEntry(db, objectStore, createDefaultKnowledgeTextExtractor(), auth, {
      contentForm: "markdown", title: "质量检查：参数调试经验", tags: ["调试"],
      contentMarkdown: "记录参数调试经验，便于团队检索与复用。"
    });
    await publishKnowledgeEntry(db, auth, entry.id);
  }
  const feedback = await listProductFeedback(db, auth, { limit: 1 });
  if (feedback.items.length === 0) {
    await createProductFeedback(db, objectStore, auth, {
      pagePath: "/knowledge", pageTitle: "知识库", feedbackType: "experience",
      description: "质量检查：知识条目筛选与查看体验", attachments: []
    });
  }
}

async function main() {
  const env = loadServerEnv(process.env);
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required to seed quality admin lists.");
  const db = createPostgresDatabase(env.DATABASE_URL);
  try {
    await seedQualityAdminLists(db, createObjectStoreFromEnv(env));
    console.log("Seeded populated knowledge and product feedback quality lists.");
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
