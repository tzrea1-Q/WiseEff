import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const WORKSPACE_LINK_REPAIR_HINT =
  "Run `npm ci` or `npm install` from the repository root so npm can link workspace packages.";

type PackageJson = {
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function workspacePackageNames(pkg: PackageJson): string[] {
  const names = new Set<string>();
  for (const [name, version] of [
    ...Object.entries(pkg.dependencies ?? {}),
    ...Object.entries(pkg.devDependencies ?? {})
  ]) {
    if (version === "workspace:*") {
      names.add(name);
    }
  }
  return [...names].sort();
}

async function linkResolves(linkPath: string): Promise<boolean> {
  try {
    const stats = await lstat(linkPath);
    if (stats.isSymbolicLink()) {
      const target = await realpath(linkPath);
      const targetStats = await lstat(target);
      return targetStats.isDirectory();
    }
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export async function validateWorkspaceLinks(repoRoot: string): Promise<string[]> {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as PackageJson;
  const names = workspacePackageNames(pkg);
  const errors: string[] = [];

  for (const name of names) {
    const linkPath = path.join(repoRoot, "node_modules", name);
    if (!(await linkResolves(linkPath))) {
      errors.push(
        `Workspace package ${name} is listed as workspace:* but node_modules/${name} is missing or does not resolve.`
      );
    }
  }

  if (errors.length > 0) {
    errors.push(WORKSPACE_LINK_REPAIR_HINT);
  }

  return errors;
}

async function main(): Promise<void> {
  const errors = await validateWorkspaceLinks(process.cwd());
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("Workspace package links are present.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
