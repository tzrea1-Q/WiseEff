import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createPreview, PreviewError, type Preview } from "./verification/plan";
import { reportCommand, ReportError } from "./verification/report";
import { runCommand, RunError } from "./verification/run";

const OUTPUT_LIMIT = 64 * 1024;

function parse(argv: string[]): { base: string; head?: string } {
  const command = argv[0];
  if (command !== "plan") throw new PreviewError("INVALID_ARGUMENTS");
  let values: { base?: string; head?: string };
  try {
    ({ values } = parseArgs({ args: argv.slice(1), strict: true, allowPositionals: false, options: {
      base: { type: "string" }, head: { type: "string" },
    } }));
  } catch { throw new PreviewError("INVALID_ARGUMENTS"); }
  if (typeof values.base !== "string" || (values.head !== undefined && typeof values.head !== "string")) throw new PreviewError("INVALID_ARGUMENTS");
  return { base: values.base, head: values.head };
}

export function main(argv = process.argv.slice(2)): number {
  const { base, head } = parse(argv);
  const preview: Preview = createPreview({ cwd: process.cwd(), base, head });
  const output = JSON.stringify(preview);
  if (Buffer.byteLength(output, "utf8") > OUTPUT_LIMIT) throw new PreviewError("OUTPUT_TOO_LARGE");
  process.stdout.write(`${output}\n`);
  return 0;
}

export async function cli(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0];
  if (command === "plan") return main(argv);
  if (command === "run") return runCommand(argv.slice(1));
  if (command === "report") return reportCommand(argv.slice(1));
  throw new PreviewError("INVALID_ARGUMENTS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await cli(); }
  catch (error) {
    const code = error instanceof PreviewError || error instanceof RunError || error instanceof ReportError ? error.code : "INVALID_ARGUMENTS";
    process.stdout.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
  }
}
