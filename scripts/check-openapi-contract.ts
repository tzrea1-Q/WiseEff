import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildOpenApiDocument } from "../server/modules/contracts/openapi";

const artifactPath = path.resolve("docs/generated/openapi.json");
const expected = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

let actual: string;

try {
  actual = await readFile(artifactPath, "utf8");
} catch (error) {
  console.error(`OpenAPI contract artifact is missing at ${artifactPath}. Run npm run contract:openapi.`);
  throw error;
}

if (actual !== expected) {
  console.error("OpenAPI contract artifact is out of date. Run npm run contract:openapi and commit docs/generated/openapi.json.");
  process.exit(1);
}

console.log("OpenAPI contract artifact is current.");
