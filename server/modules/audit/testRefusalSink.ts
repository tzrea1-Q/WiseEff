import { createPostgresDatabase } from "../../shared/database/client";
import { resolveTestDatabaseUrl } from "../../testing/tempDatabase";
import { createTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "./trustedRefusalSink";

const testRefusalRoot = createPostgresDatabase(resolveTestDatabaseUrl());

export const testRefusalAuditSink: TrustedRefusalAuditSink = createTrustedRefusalAuditSink(testRefusalRoot);

export async function closeTestRefusalAuditSink(): Promise<void> {
  await testRefusalRoot.close();
}
