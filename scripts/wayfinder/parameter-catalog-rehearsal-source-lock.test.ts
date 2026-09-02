import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const historicalSourceCommit = "6c3adfc35c0e3be6d5d381013dace9408190380e";
const historicalBundleSha256 =
  "017b3e614f1f4eba5a70f0c6b0cd3316b7e5ebd1aa9ccec4cf8e514c56dba7ff";
const oldCandidateCommit = "72abe1be813fbbe5f8c83437bf9a94cc36846229";
const previousSourceLockCommit = "5e32adbdd9b6909796046f2fa54f97c97f289875";
const repairCommit = "39c64406ca4e6bb35d4da314f6c17fef1dc5b9ae";

type SourceLockEntry = {
  path: string;
  mode: "100644" | "100755";
  sha256: string;
};

const sourceLock: readonly SourceLockEntry[] = [
  {
    path: "docs/references/parameter-catalog-rehearsal-fixture.md",
    mode: "100644",
    sha256: "c366773d756ff46f5760510f2263ae8c3758355aae415bca986157c5ed009a11",
  },
  {
    path: "docs/zh-CN/references/parameter-catalog-rehearsal-fixture.md",
    mode: "100644",
    sha256: "95859e795f6ac20b255a2a12f25627918c6e5f5131a591d1653d227944f3206d",
  },
  {
    path: "scripts/wayfinder/export-parameter-catalog-rehearsal.sh",
    mode: "100755",
    sha256: "c6ff9a33fe33840abd0c7915c80e1929d0267610c818036f04aa507204e3ba82",
  },
  {
    path: "scripts/wayfinder/import-parameter-catalog-rehearsal.sh",
    mode: "100755",
    sha256: "ebee8a024e7177a704ce662ead168c22010113ffc91f0ebc70e03e7527d45f5e",
  },
  {
    path: "scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts",
    mode: "100644",
    sha256: "67433f6ec316b9c2cb1a82605100182315c60e41d5c13b20df671eec5df9b3d3",
  },
  {
    path: "scripts/wayfinder/rehearse-parameter-catalog-replacement.sh",
    mode: "100755",
    sha256: "d1f2627ae2ead2b23d2ee306f08a86c8c439b8cf00f33ea4d3b271e955842f86",
  },
  {
    path: "scripts/wayfinder/sql/columns.sql",
    mode: "100644",
    sha256: "12cae0640df2a468958b0ccf8efec6b4cb88c5c54e10fe490be92e5a51dd20fb",
  },
  {
    path: "scripts/wayfinder/sql/constraints.sql",
    mode: "100644",
    sha256: "fc578e4545aa2b3c879527b3a0e00e05a2995fec7be66ff5ad99993aec98694f",
  },
  {
    path: "scripts/wayfinder/sql/indexes.sql",
    mode: "100644",
    sha256: "2fcafd583c31d9b080dbbc5f12413afcaba6034a74c42112df5f207eae69bcf0",
  },
  {
    path: "scripts/wayfinder/sql/invariant-counts.sql",
    mode: "100644",
    sha256: "397a8ecfe1557dadb31e97c1389c67f833e1d626a323cfb64c2051b587213b24",
  },
  {
    path: "scripts/wayfinder/sql/migration-inventory.sql",
    mode: "100644",
    sha256: "6232cccb7d178bdb899df6ed5804d094590f2c591364491c7b4240c9d5e34e15",
  },
  {
    path: "scripts/wayfinder/sql/profile-schema.sql",
    mode: "100644",
    sha256: "e84bac11a87ff0b9aaa1ed84bdbba601fb498d1c86b1f3b4a53f4e3e6e40cdd8",
  },
  {
    path: "scripts/wayfinder/sql/relations.sql",
    mode: "100644",
    sha256: "d2936881f7bcaf203f38154cbbaeaf5427b7e2d452bc5dfe691b9c3ef14b7195",
  },
  {
    path: "scripts/wayfinder/sql/row-classes.sql",
    mode: "100644",
    sha256: "091eb031ed20a65d73f1160138fb07d1300f07d73c1a6d3e6bf291b9a321a6ff",
  },
  {
    path: "scripts/wayfinder/sql/row-counts.sql",
    mode: "100644",
    sha256: "6ec554005e107220f3decee258838e76f4fb71e13835bcfceefa7c195f575bcc",
  },
  {
    path: "scripts/wayfinder/sql/synthetic-fixture-verify.sql",
    mode: "100644",
    sha256: "134c0b2e3185bbc3b5087fa63f628d9452389ed4dabd702c94c4f27ead8d8e62",
  },
  {
    path: "scripts/wayfinder/sql/synthetic-fixture.sql",
    mode: "100644",
    sha256: "d8dcc92d0d42c4586df872afc5550f0175a68d1e17ca1229b8af11fe0ecf3b82",
  },
  {
    path: "scripts/wayfinder/sql/triggers.sql",
    mode: "100644",
    sha256: "b01b0df98e4d16434cba786e5188373cef9a6e92671c0eda9f8eb67458f563f7",
  },
] as const;

const repairedBundleSha256 =
  "89563a1498779e80e696dd72320a8dae03e5a4fdc85ebda107c28f3eb91c964f";
const repairChangedPaths = [
  "scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts",
  "scripts/wayfinder/rehearse-parameter-catalog-replacement.sh",
] as const;

const secretPattern = new RegExp(
  [
    "postgres(?:ql)?://[^\\s]+:[^\\s@]+@",
    "bearer\\s+[A-Za-z0-9._-]{16,}",
    "BEGIN\\s+[^\\s]*\\s+PRIVATE\\s+KEY",
    "A(?:KI|SI)A[0-9A-Z]{16}",
    "gh[pousr]_[A-Za-z0-9]{20,}",
    "xox[baprs]-[A-Za-z0-9-]{10,}",
    "\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}",
  ].join("|"),
  "i",
);

function runGitText(args: string[]) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

function readGitBlob(revision: string, sourcePath: string) {
  const result = spawnSync("git", ["cat-file", "blob", `${revision}:${sourcePath}`], {
    cwd: projectRoot,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  expect(result.status, result.stderr.toString()).toBe(0);
  return result.stdout;
}

function frame(hash: ReturnType<typeof createHash>, tag: string, bytes: Buffer) {
  hash.update(Buffer.from(`${tag}:${bytes.length}:`, "utf8"));
  hash.update(bytes);
}

describe("parameter catalog rehearsal repaired source lock", () => {
  it("pins append-only lineage and confines R to the original path set", () => {
    runGitText(["cat-file", "-e", `${historicalSourceCommit}^{commit}`]);
    runGitText(["cat-file", "-e", `${oldCandidateCommit}^{commit}`]);
    runGitText(["cat-file", "-e", `${previousSourceLockCommit}^{commit}`]);
    runGitText(["cat-file", "-e", `${repairCommit}^{commit}`]);
    runGitText(["merge-base", "--is-ancestor", oldCandidateCommit, repairCommit]);
    runGitText([
      "merge-base",
      "--is-ancestor",
      previousSourceLockCommit,
      repairCommit,
    ]);

    const changedPaths = runGitText([
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      `${repairCommit}^`,
      repairCommit,
    ])
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(changedPaths).toEqual([...repairChangedPaths].sort());
    expect(changedPaths.every((sourcePath) => sourceLock.some((entry) => entry.path === sourcePath))).toBe(
      true,
    );
  });

  it("pins the exact regular-file modes, repaired bytes, hashes, and length-framed B", async () => {
    expect(sourceLock).toHaveLength(18);
    expect(sourceLock.map((entry) => entry.path)).toEqual(
      [...sourceLock.map((entry) => entry.path)].sort(),
    );

    const bundle = createHash("sha256");
    frame(bundle, "count", Buffer.from(String(sourceLock.length), "utf8"));

    for (const entry of sourceLock) {
      const treeLine = runGitText(["ls-tree", repairCommit, "--", entry.path]).trim();
      const match = /^(\d{6}) blob [0-9a-f]{40}\t(.+)$/.exec(treeLine);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe(entry.mode);
      expect(match?.[2]).toBe(entry.path);

      const repairedBytes = readGitBlob(repairCommit, entry.path);
      expect(createHash("sha256").update(repairedBytes).digest("hex")).toBe(entry.sha256);

      const workingStat = await lstat(path.join(projectRoot, entry.path));
      expect(workingStat.isFile()).toBe(true);
      expect(workingStat.isSymbolicLink()).toBe(false);
      expect(await readFile(path.join(projectRoot, entry.path))).toEqual(repairedBytes);
      expect(secretPattern.test(repairedBytes.toString("utf8")), entry.path).toBe(false);

      frame(bundle, "path", Buffer.from(entry.path, "utf8"));
      frame(bundle, "mode", Buffer.from(entry.mode, "utf8"));
      frame(bundle, "blob", repairedBytes);
    }

    expect(bundle.digest("hex")).toBe(repairedBundleSha256);
  });

  it("keeps immutable historical provenance documentary and excludes this lock from B", async () => {
    const englishDoc = await readFile(
      path.join(projectRoot, "docs/references/parameter-catalog-rehearsal-fixture.md"),
      "utf8",
    );
    const chineseDoc = await readFile(
      path.join(projectRoot, "docs/zh-CN/references/parameter-catalog-rehearsal-fixture.md"),
      "utf8",
    );
    for (const fixtureDoc of [englishDoc, chineseDoc]) {
      expect(fixtureDoc).toContain(historicalSourceCommit);
      expect(fixtureDoc).toContain(historicalBundleSha256);
      expect(fixtureDoc).toContain("source-lock");
    }

    const lockPath = "scripts/wayfinder/parameter-catalog-rehearsal-source-lock.test.ts";
    expect(sourceLock.some((entry) => entry.path === lockPath)).toBe(false);
    const lockStat = await lstat(path.join(projectRoot, lockPath));
    expect(lockStat.isFile()).toBe(true);
    expect(lockStat.isSymbolicLink()).toBe(false);
  });
});
