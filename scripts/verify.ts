import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createPreview, PreviewError, type Preview } from "./verification/plan";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(); }
  catch (error) {
    const code = error instanceof PreviewError ? error.code : "INVALID_ARGUMENTS";
    process.stdout.write(`${JSON.stringify({ error: code })}\n`);
    process.exitCode = 1;
  }
}
