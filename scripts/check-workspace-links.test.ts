import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WORKSPACE_LINK_REPAIR_HINT, validateWorkspaceLinks } from "./check-workspace-links";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiseeff-workspace-links-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writePackageJson(
  root: string,
  options: {
    workspaces?: unknown;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }
): Promise<void> {
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      workspaces: options.workspaces ?? ["packages/*"],
      dependencies: options.dependencies ?? {},
      devDependencies: options.devDependencies ?? {}
    }),
    "utf8"
  );
}

describe("validateWorkspaceLinks", () => {
  it("fails when a workspace:* dependency is missing from node_modules", async () => {
    const root = await createTempRoot();
    await writePackageJson(root, {
      dependencies: {
        "@wiseeff/xiaoze-protocol": "workspace:*",
        react: "^19.0.0"
      }
    });

    const errors = await validateWorkspaceLinks(root);

    expect(errors).toContain(
      "Workspace package @wiseeff/xiaoze-protocol is listed as workspace:* but node_modules/@wiseeff/xiaoze-protocol is missing or does not resolve."
    );
    expect(errors).toContain(WORKSPACE_LINK_REPAIR_HINT);
  });

  it("fails when a workspace:* symlink does not resolve", async () => {
    const root = await createTempRoot();
    await writePackageJson(root, {
      dependencies: { "@wiseeff/xiaoze-protocol": "workspace:*" }
    });
    await mkdir(path.join(root, "node_modules", "@wiseeff"), { recursive: true });
    await symlink(
      path.join(root, "packages", "xiaoze-protocol"),
      path.join(root, "node_modules", "@wiseeff", "xiaoze-protocol")
    );

    const errors = await validateWorkspaceLinks(root);

    expect(errors[0]).toContain("@wiseeff/xiaoze-protocol");
    expect(errors).toContain(WORKSPACE_LINK_REPAIR_HINT);
  });

  it("passes when every workspace:* dependency is a directory or resolving symlink", async () => {
    const root = await createTempRoot();
    await writePackageJson(root, {
      workspaces: { packages: ["packages/*"] },
      dependencies: { "@wiseeff/xiaoze-protocol": "workspace:*" },
      devDependencies: { "@wiseeff/device-command-core": "workspace:*" }
    });
    await mkdir(path.join(root, "packages", "xiaoze-protocol"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "@wiseeff"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "@wiseeff", "device-command-core"), { recursive: true });
    await symlink(
      path.join("..", "..", "packages", "xiaoze-protocol"),
      path.join(root, "node_modules", "@wiseeff", "xiaoze-protocol")
    );

    await expect(validateWorkspaceLinks(root)).resolves.toEqual([]);
  });

  it("ignores registry dependencies that are not workspace:*", async () => {
    const root = await createTempRoot();
    await writePackageJson(root, {
      dependencies: { react: "^19.0.0" },
      devDependencies: { vitest: "^4.0.0" }
    });

    await expect(validateWorkspaceLinks(root)).resolves.toEqual([]);
  });

  it("keeps this repository's workspace:* packages linked in node_modules", async () => {
    await expect(validateWorkspaceLinks(repoRoot)).resolves.toEqual([]);
  });
});
