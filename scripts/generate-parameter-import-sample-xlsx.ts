import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sampleDir = join(root, "docs/samples/parameter-import");
const csvText = readFileSync(join(sampleDir, "mixed-batch-zh.csv"), "utf8");
const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
const rows = lines.map((line) => line.split(","));

const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.aoa_to_sheet(rows);
XLSX.utils.book_append_sheet(workbook, sheet, "参数");
const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
writeFileSync(join(sampleDir, "mixed-batch-zh.xlsx"), bytes);

console.log(`Wrote ${join(sampleDir, "mixed-batch-zh.xlsx")} (${rows.length - 1} data rows)`);
