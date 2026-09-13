import { spawnSync } from "node:child_process";

const fail = (message: string, code = 2): never => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

if (process.env.WISEEFF_CATALOG_DELIVERY_ACCEPTANCE !== "1") {
  fail(
    "WISEEFF_CATALOG_DELIVERY_ACCEPTANCE=1 is required. Missing prerequisites are a failure, not a skip.",
  );
}

if (process.env.WISEEFF_CATALOG_TEST_CAPABILITIES) {
  fail(
    "WISEEFF_CATALOG_TEST_CAPABILITIES must be unset for delivery acceptance; grant real catalog capabilities instead.",
  );
}

if (!process.env.WISEEFF_PUBLICATION_MANAGER_DATABASE_URL && !process.env.DATABASE_URL) {
  fail("WISEEFF_PUBLICATION_MANAGER_DATABASE_URL or DATABASE_URL is required.");
}

const result = spawnSync(
  "npx",
  [
    "playwright",
    "test",
    "--config",
    "playwright.acceptance.config.ts",
    "e2e/acceptance/catalog-publication.acceptance.spec.ts",
  ],
  { stdio: "inherit", env: { ...process.env, WISEEFF_CATALOG_DELIVERY_ACCEPTANCE: "1" } },
);

process.exit(result.status === 0 ? 0 : result.status ?? 1);
