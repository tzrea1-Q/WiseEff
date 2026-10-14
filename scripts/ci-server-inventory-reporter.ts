import { writeFileSync } from "node:fs";
import type { Reporter, TestModule } from "vitest/node";

export default class ServerInventoryReporter implements Reporter {
  private tests: Array<{ file: string; name: string; location: unknown }> = [];

  onTestModuleCollected(module: TestModule): void {
    for (const test of module.children.allTests()) {
      this.tests.push({ file: module.moduleId, name: test.fullName, location: test.location });
    }
  }

  onTestRunEnd(): void {
    const file = process.env.WISEEFF_CI_SERVER_INVENTORY_FILE;
    if (!file) throw new Error("CI_SHARD_COLLECTION_PATH");
    writeFileSync(file, JSON.stringify(this.tests), { flag: "wx", mode: 0o600 });
  }
}
