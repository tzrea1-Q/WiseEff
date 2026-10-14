import { validateM6RunbookCommands } from "./check-doc-governance";

const errors = await validateM6RunbookCommands();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Runbook command check passed.");
}
