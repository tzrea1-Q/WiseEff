import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildOpenApiDocument } from "../server/modules/contracts/openapi";

const outputPath = path.resolve("docs/generated/openapi.json");
const document = buildOpenApiDocument();

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

console.log(`Wrote ${outputPath}`);
