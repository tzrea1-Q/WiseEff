import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import serverConfig from "../vitest.server.config";
import { componentTestCommands } from "./run-upgrade-component-tests";

it("runs the cluster-role Binding producer only in its mandatory owned lane", () => {
  const file = "server/modules/catalog-cutover/bindingImportProducer.integration.test.ts";
  // Per-worker databases cannot isolate CREATE ROLE / membership from the
  // Catalog role manifest's cluster-wide negative query.
  expect(serverConfig.test?.exclude).toContain(file);
  const commands = componentTestCommands("bindings-pg16");
  expect(commands).toHaveLength(1);
  expect(commands[0].filter(argument => argument === file)).toHaveLength(1);
  expect(commands[0]).toContain("vitest.upgrade-cutover.config.ts");
  expect(readFileSync(file, "utf8")).toContain("s7_binding_");
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  expect(workflow).toMatch(/--suite bindings-pg16 --github-hosted/);
  const config = readFileSync("vitest.upgrade-cutover.config.ts", "utf8");
  expect(config).toContain("assertOwnedUpgradeTestTarget();");
  expect(config).toContain('"server/modules/catalog-cutover/**/*.test.ts"');
  expect(config).not.toMatch(/passWithNoTests:\s*true/);
});
