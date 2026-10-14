import { pathToFileURL } from "node:url";
import { runNpmScript } from "../e2e/acceptance/helpers/database";

export const browserSeedSteps = [
  { script: "db:migrate", label: "migration" },
  { script: "reset:quality-runtime", label: "seed-reset" },
  { script: "db:seed:all", label: "seed" },
  { script: "seed:quality:admin-lists", label: "seed-admin-lists" },
] as const;

export function runBrowserSeedScripts(runScript: (script: string) => void = runNpmScript) {
  for (const { script } of browserSeedSteps) {
    runScript(script);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBrowserSeedScripts();
}
