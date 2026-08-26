import { createTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { createPostgresDatabase } from "../../shared/database/client";
import { resolveTestDatabaseUrl } from "../../testing/tempDatabase";

// Unit suites still use their transactional test database for domain reads/writes. The
// refusal sink is intentionally a separate pool-root object, even when its audit writer is mocked.
const testRefusalRoot = createPostgresDatabase(resolveTestDatabaseUrl());

export const testRefusalAuditSink: TrustedRefusalAuditSink = createTrustedRefusalAuditSink(testRefusalRoot);

export async function closeTestRefusalAuditSink(): Promise<void> {
  await testRefusalRoot.close();
}
