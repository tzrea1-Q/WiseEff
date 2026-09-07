import { describe, expect, it } from "vitest";
import { checkRecoveryStorageBoundary, readRecoveryBoundarySources, RECOVERY_STORAGE_OWNERSHIP } from "./recovery-storage-boundary";

const check = (sources: Record<string, string>, ownership: Record<string, "check" | "execution" | "test" | "data"> = {
  "ops/self-hosted/storage/check.ts": "check", "ops/self-hosted/storage/execution/restore.ts": "execution",
}) => checkRecoveryStorageBoundary(sources, ownership);

describe("authorized recovery ownership and dependency contract", () => {
  it("registers every storage file and keeps check roots out of the execution dependency graph", () => {
    expect(checkRecoveryStorageBoundary(readRecoveryBoundarySources(), RECOVERY_STORAGE_OWNERSHIP)).toEqual([]);
  });
  it.each(["hidden.js", "nested/hidden.mjs", "hidden.test.ts", "hidden.sh"])("refuses unregistered storage module %s", name => {
    expect(check({ [`ops/self-hosted/storage/${name}`]: "export const x = 1;" })).toContain(`unregistered:ops/self-hosted/storage/${name}`);
  });
  it.each([
    "import './execution/restore'", "export * from './execution/restore'", "const m = require('./execution/restore')",
    "const m = import('./execution/restore')", "const m = import('./execution/' + 'restore')",
  ])("refuses check-to-execution dependency: %s", code => {
    expect(check({ "ops/self-hosted/storage/check.ts": code, "ops/self-hosted/storage/execution/restore.ts": "" }))
      .toContain("execution-dependency:ops/self-hosted/storage/check.ts:ops/self-hosted/storage/execution/restore.ts");
  });
  it("finds an indirect execution dependency through a helper outside storage", () => {
    expect(check({ "ops/self-hosted/storage/check.ts": "import '../../../scripts/helper'",
      "scripts/helper.ts": "export * from '../ops/self-hosted/storage/execution/restore'", "ops/self-hosted/storage/execution/restore.ts": "" }))
      .toContain("execution-dependency:ops/self-hosted/storage/check.ts:ops/self-hosted/storage/execution/restore.ts");
  });
  it("detects unregistered helpers outside storage even when they import no execution module", () => {
    expect(check({ "ops/self-hosted/storage/check.ts": "import '../../../scripts/new-helper'", "scripts/new-helper.ts": "export const harmless = true",
      "ops/self-hosted/storage/execution/restore.ts": "" })).toContain("unregistered-local:scripts/new-helper.ts");
  });
  it.each(["import(target)", "require(target)", "eval(source)", "new Function(source)", "const load = require; load(target)",
    "globalThis['Func' + 'tion'](source)", "globalThis[loader](source)", "const f = (()=>{}).constructor(source)"])("refuses unresolved dynamic loading: %s", code => {
    expect(check({ "ops/self-hosted/storage/check.ts": code, "ops/self-hosted/storage/execution/restore.ts": "" }))
      .toContain("dynamic-code:ops/self-hosted/storage/check.ts");
  });
  it("rejects unknown capture executables and executable modules mislabeled as data", () => {
    expect(check({ "ops/self-hosted/storage/controlledRecovery.docker.ts": "io.exec(resources.postgres, [fromEnvironment])" },
      { "ops/self-hosted/storage/controlledRecovery.docker.ts": "check" }))
      .toContain("unbounded-capture-command:ops/self-hosted/storage/controlledRecovery.docker.ts");
    expect(check({ "ops/self-hosted/storage/hidden.js": "" }, { "ops/self-hosted/storage/hidden.js": "data" }))
      .toContain("executable-data:ops/self-hosted/storage/hidden.js");
  });
  it.each(["'pg_restore'", "'pg_' + 'restore'", "['pg', 'restore'].join('_')", "`pg_${'restore'}`"])("refuses restoration token string evasion %s", code => {
    expect(check({ "ops/self-hosted/storage/check.ts": `const command = ${code};`, "ops/self-hosted/storage/execution/restore.ts": "" }))
      .toContain("restore-effect:ops/self-hosted/storage/check.ts");
  });
  it("does not make test-file renaming an execution escape", () => {
    expect(check({ "ops/self-hosted/storage/check.ts": "import './hidden.test'", "ops/self-hosted/storage/hidden.test.ts": "" },
      { "ops/self-hosted/storage/check.ts": "check", "ops/self-hosted/storage/hidden.test.ts": "test" }))
      .toContain("test-dependency:ops/self-hosted/storage/check.ts:ops/self-hosted/storage/hidden.test.ts");
  });
  it("forbids execution modules from importing a synthetic approval fixture", () => {
    expect(check({ "ops/self-hosted/storage/execution/restore.ts": "import '../fixture'", "ops/self-hosted/storage/fixture.ts": "" },
      { "ops/self-hosted/storage/execution/restore.ts": "execution", "ops/self-hosted/storage/fixture.ts": "test" }))
      .toContain("test-dependency:ops/self-hosted/storage/execution/restore.ts:ops/self-hosted/storage/fixture.ts");
  });
  it.each(["@/ops/self-hosted/storage/execution/restore", "/ops/self-hosted/storage/execution/restore.ts", "file:///ops/self-hosted/storage/execution/restore.ts", "unregistered-module"])("refuses unchecked non-relative loader %s", name => {
    expect(check({ "ops/self-hosted/storage/check.ts": `import ${JSON.stringify(name)}`, "ops/self-hosted/storage/execution/restore.ts": "" }))
      .toContain(`unapproved-external:ops/self-hosted/storage/check.ts:${name}`);
  });
});
