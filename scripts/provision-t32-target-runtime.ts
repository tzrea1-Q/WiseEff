import { writeFileSync } from "node:fs";
import path from "node:path";

import { provisionOwnedLocalAcceptanceRuntime } from "./owned-local-acceptance-runtime";

const worktreeRoot = process.cwd();
const baseDatabaseUrl =
  process.env.WISEEFF_T32_BASE_DATABASE_URL ?? "postgres://wiseeff:wiseeff@127.0.0.1:55438/postgres";

const runtime = await provisionOwnedLocalAcceptanceRuntime({
  baseDatabaseUrl,
  worktreeRoot,
  runsRoot: "test-results/t32-target-synthetic-runtime",
});

const pointer = path.join(worktreeRoot, "test-results/t32-target-synthetic-pointer.json");
writeFileSync(
  pointer,
  `${JSON.stringify(
    {
      descriptorPath: runtime.descriptorPath,
      frontendUrl: runtime.descriptor.endpoints.frontend.url,
      apiUrl: runtime.descriptor.endpoints.api.url,
      runId: runtime.descriptor.run.id,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`READY ${runtime.descriptorPath}\n`);
await new Promise(() => undefined);
