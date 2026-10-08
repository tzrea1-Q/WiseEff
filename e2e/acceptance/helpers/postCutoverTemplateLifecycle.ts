import { OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV } from "./nestedRuntimeManifest";
import { cleanupLocalPostCutoverDatabaseTemplates } from "./postCutoverDatabaseTemplate";

export default function postCutoverTemplateLifecycle() {
  if (process.env[OWNED_ACCEPTANCE_NESTED_RUNTIME_MANIFEST_ENV]) return;
  const databaseUrls = new Set([process.env.DATABASE_URL, process.env.TEST_DATABASE_URL].filter((url): url is string => Boolean(url)));
  return async () => {
    for (const databaseUrl of databaseUrls) await cleanupLocalPostCutoverDatabaseTemplates(databaseUrl);
  };
}
