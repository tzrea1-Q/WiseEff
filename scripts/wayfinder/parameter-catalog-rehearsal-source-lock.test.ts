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
const repairCommit = "2cb64226e9550c8874926d0af67150bd3e2d1dc3";

const historicalBlobSha256: Readonly<Record<string, string>> = {
  "docs/references/parameter-catalog-rehearsal-fixture.md":
    "700f64576f3effafbc33ebe6055aa3764c4b95e2150488f91c1cd7649e0c37c4",
  "docs/zh-CN/references/parameter-catalog-rehearsal-fixture.md":
    "e1aa797cf068bc4394ff0dacf9d8d12cfba473c16e2fc1daecd0d7a76c88d2c1",
  "scripts/wayfinder/export-parameter-catalog-rehearsal.sh":
    "48cacfbc94274f230f70da4db3e59ac64090068c43a13de5e7e3d7be0685936a",
  "scripts/wayfinder/import-parameter-catalog-rehearsal.sh":
    "229ab151d8e547d6632d462dfa49d3b4fd7d8e7dde76476e6630693b04ced774",
  "scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts":
    "ac429b6ae7b1fe66b96f8fb4368c60a29e488704437b7ed7587bd83407a36335",
  "scripts/wayfinder/rehearse-parameter-catalog-replacement.sh":
    "1664b49afd8e8e900faeb4218c1262d832c0be2121925ecff8c27d609a706d27",
  "scripts/wayfinder/sql/columns.sql":
    "12cae0640df2a468958b0ccf8efec6b4cb88c5c54e10fe490be92e5a51dd20fb",
  "scripts/wayfinder/sql/constraints.sql":
    "fc578e4545aa2b3c879527b3a0e00e05a2995fec7be66ff5ad99993aec98694f",
  "scripts/wayfinder/sql/indexes.sql":
    "2fcafd583c31d9b080dbbc5f12413afcaba6034a74c42112df5f207eae69bcf0",
  "scripts/wayfinder/sql/invariant-counts.sql":
    "397a8ecfe1557dadb31e97c1389c67f833e1d626a323cfb64c2051b587213b24",
  "scripts/wayfinder/sql/migration-inventory.sql":
    "6232cccb7d178bdb899df6ed5804d094590f2c591364491c7b4240c9d5e34e15",
  "scripts/wayfinder/sql/profile-schema.sql":
    "e84bac11a87ff0b9aaa1ed84bdbba601fb498d1c86b1f3b4a53f4e3e6e40cdd8",
  "scripts/wayfinder/sql/relations.sql":
    "d2936881f7bcaf203f38154cbbaeaf5427b7e2d452bc5dfe691b9c3ef14b7195",
  "scripts/wayfinder/sql/row-classes.sql":
    "091eb031ed20a65d73f1160138fb07d1300f07d73c1a6d3e6bf291b9a321a6ff",
  "scripts/wayfinder/sql/row-counts.sql":
    "6ec554005e107220f3decee258838e76f4fb71e13835bcfceefa7c195f575bcc",
  "scripts/wayfinder/sql/synthetic-fixture-verify.sql":
    "e1aa1beedf8f04b868016daeea661f6814e87e009a6cd85281cd79f578a36576",
  "scripts/wayfinder/sql/synthetic-fixture.sql":
    "d8dcc92d0d42c4586df872afc5550f0175a68d1e17ca1229b8af11fe0ecf3b82",
  "scripts/wayfinder/sql/triggers.sql":
    "b01b0df98e4d16434cba786e5188373cef9a6e92671c0eda9f8eb67458f563f7",
};

type SourceLockEntry = {
  path: string;
  mode: "100644" | "100755";
  sha256: string;
};

const sourceLock: readonly SourceLockEntry[] = [
  {
    path: "docs/references/parameter-catalog-rehearsal-fixture.md",
    mode: "100644",
    sha256: "77c1e12131e463067334d5f12b00c5a1988bfa65dbc741ab70842e50028f424c",
  },
  {
    path: "docs/zh-CN/references/parameter-catalog-rehearsal-fixture.md",
    mode: "100644",
    sha256: "bb5b1d430fa4da628d0680b6444cefe2ae20552efb8aa5da6031e243adc19abf",
  },
  {
    path: "scripts/wayfinder/export-parameter-catalog-rehearsal.sh",
    mode: "100755",
    sha256: "d99dce5f77fd9b093ce8642e3ba12747a910a7d7a289685b07f82a0acd355465",
  },
  {
    path: "scripts/wayfinder/import-parameter-catalog-rehearsal.sh",
    mode: "100755",
    sha256: "fcef41de309ec09ec99897ddede8af7f303f2a42a6597bb63182b65ff2a5f159",
  },
  {
    path: "scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts",
    mode: "100644",
    sha256: "dc7758569deaeea1bd11767c732ba827ca5521583d5b7ec256c9f36ad0fa805c",
  },
  {
    path: "scripts/wayfinder/rehearse-parameter-catalog-replacement.sh",
    mode: "100755",
    sha256: "31c2eb3fc6eea36886531f8af938969aaf3f472e83e4ec090f23bcf815c92664",
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
    sha256: "e66f60ad19932abaf65a27ccdd8118393ae5e1c5f160af58bf7bc1ebe2164018",
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
  "6029bd517da385b6067c8c4783c95b4a728c30e63dca07f00e1283c112744c6e";
const repairChangedPaths = [
  "docs/references/parameter-catalog-rehearsal-fixture.md",
  "docs/zh-CN/references/parameter-catalog-rehearsal-fixture.md",
  "scripts/wayfinder/export-parameter-catalog-rehearsal.sh",
  "scripts/wayfinder/import-parameter-catalog-rehearsal.sh",
  "scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts",
  "scripts/wayfinder/rehearse-parameter-catalog-replacement.sh",
  "scripts/wayfinder/sql/synthetic-fixture-verify.sql",
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

function runGitBuffer(args: string[]) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  expect(result.status, result.stderr.toString()).toBe(0);
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
    runGitText(["merge-base", "--is-ancestor", historicalSourceCommit, "HEAD"]);

    const lineage = runGitText([
      "rev-list",
      "--ancestry-path",
      `${repairCommit}..HEAD`,
    ])
      .trim()
      .split("\n")
      .filter(Boolean);
    const provenanceMerge = lineage.find((commit) => {
      const parents = runGitText(["show", "-s", "--format=%P", commit])
        .trim()
        .split(" ");
      return parents.includes(repairCommit) && parents.includes(historicalSourceCommit);
    });
    expect(provenanceMerge).toBeDefined();

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

  it("recomputes the immutable historical blobs and tar bundle from reachable provenance", () => {
    const sourcePaths = sourceLock.map((entry) => entry.path);
    expect(Object.keys(historicalBlobSha256).sort()).toEqual([...sourcePaths].sort());

    const historicalArchive = runGitBuffer([
      "archive",
      "--format=tar",
      historicalSourceCommit,
      ...sourcePaths,
    ]);
    expect(createHash("sha256").update(historicalArchive).digest("hex")).toBe(
      historicalBundleSha256,
    );

    for (const entry of sourceLock) {
      const historicalTree = runGitText([
        "ls-tree",
        historicalSourceCommit,
        "--",
        entry.path,
      ]).trim();
      const oldCandidateTree = runGitText([
        "ls-tree",
        oldCandidateCommit,
        "--",
        entry.path,
      ]).trim();
      const historicalMatch = /^(\d{6}) blob [0-9a-f]{40}\t(.+)$/.exec(
        historicalTree,
      );
      const oldCandidateMatch = /^(\d{6}) blob [0-9a-f]{40}\t(.+)$/.exec(
        oldCandidateTree,
      );
      expect(historicalMatch?.[1]).toBe(entry.mode);
      expect(historicalMatch?.[2]).toBe(entry.path);
      expect(oldCandidateMatch?.[1]).toBe(entry.mode);
      expect(oldCandidateMatch?.[2]).toBe(entry.path);

      const historicalBytes = readGitBlob(historicalSourceCommit, entry.path);
      expect(createHash("sha256").update(historicalBytes).digest("hex")).toBe(
        historicalBlobSha256[entry.path],
      );
      expect(readGitBlob(oldCandidateCommit, entry.path)).toEqual(historicalBytes);
    }
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

  it("keeps immutable historical provenance documented and excludes this lock from B", async () => {
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
