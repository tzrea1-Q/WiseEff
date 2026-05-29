import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const activePlansDir = "docs/exec-plans/active";
export const requiredSections = ["## Documentation Impact Matrix", "## Documentation Update Gate"];

export function validatePlanDocument(planPath: string, content: string): string[] {
  const normalizedPath = planPath.replace(/\\/g, "/");

  if (normalizedPath.endsWith("/development-roadmap.md")) {
    return [];
  }

  const headings = collectMarkdownHeadings(content);

  return requiredSections
    .filter((section) => !headings.has(section))
    .map((section) => `${normalizedPath} is missing ${section}.`);
}

function collectMarkdownHeadings(content: string): Set<string> {
  const headings = new Set<string>();
  let inFence = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && trimmed.startsWith("## ")) {
      headings.add(trimmed);
    }
  }

  return headings;
}

export async function validateActivePlans(root = process.cwd()): Promise<string[]> {
  const activeDir = path.join(root, activePlansDir);
  const entries = await readdir(activeDir, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(activePlansDir, entry.name));

  const errors = await Promise.all(
    markdownFiles.map(async (planPath) => {
      const content = await readFile(path.join(root, planPath), "utf8");
      return validatePlanDocument(planPath, content);
    })
  );

  return errors.flat();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = await validateActivePlans();

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  console.log("Documentation governance check passed.");
}
