import { createHash } from "node:crypto";
import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { listParameterSpecs, listSpecReviewTasks } from "./service";

/** Test-only independent old-source oracle. Never a canonical contribution. */
export async function captureComparisonLegacySource(database: Database) {
  const organizations = await database.query<{ id: string }>("select id from organizations order by id");
  const records = new Map<string, { kind: "definition" | "review"; id: string; value: unknown }>();
  for (const { id } of organizations.rows) {
    const auth: AuthContext = {
      user: { id: "synthetic-source-auditor", organizationId: id, name: "Synthetic", email: "synthetic@example.invalid", title: "test", isActive: true },
      organization: { id, name: id },
      roles: [{ projectId: null, roleId: "platform-admin" }],
      permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
    };
    for (const item of (await listParameterSpecs(database, auth, {})).items) {
      records.set(`definition:${item.id}`, { kind: "definition", id: item.id, value: item });
    }
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await listSpecReviewTasks(database, auth, { limit: 100, cursor });
      for (const item of page.items) records.set(`review:${item.id}`, { kind: "review", id: item.id, value: item });
      if (!page.nextCursor) break;
      if (cursors.has(page.nextCursor)) throw new Error("synthetic-review-pagination-repeated");
      cursors.add(page.nextCursor); cursor = page.nextCursor;
    }
  }
  const ordered = [...records.values()].sort((a, b) =>
    a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    records: ordered,
    count: ordered.length,
    checksum: createHash("sha256").update(`${JSON.stringify(ordered)}\n`).digest("hex"),
  };
}
