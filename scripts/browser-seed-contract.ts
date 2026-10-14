import { pathToFileURL } from "node:url";
import { runNpmScript } from "../e2e/acceptance/helpers/database";

export function runBrowserSeedScripts(runScript: (script: string) => void = runNpmScript) {
  for (const script of ["db:migrate", "reset:quality-runtime", "db:seed:all", "seed:quality:admin-lists"]) {
    runScript(script);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBrowserSeedScripts();
}
