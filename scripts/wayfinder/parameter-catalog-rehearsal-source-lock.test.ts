import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
const previousRepairCommit = "2cb64226e9550c8874926d0af67150bd3e2d1dc3";
const provenanceMergeCommit = "9a108c2ae5289332d7f0398b20e7180578fb7342";
const repairCommit = "df9c5e6f4e24d2d5b8a6a1ae9b46e2c9a8139b14";
const sourceLockPath = "scripts/wayfinder/parameter-catalog-rehearsal-source-lock.test.ts";

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
    sha256: "8c9d469bb4579be4d9ae7e8e86470e4f8f051fe4a2149395e36601cdd7289833",
  },
  {
    path: "docs/zh-CN/references/parameter-catalog-rehearsal-fixture.md",
    mode: "100644",
    sha256: "620d35b0ff3c13c7e0585a35d7b2b675c793a6d4a8c95175be4c34a0f5b2c44f",
  },
  {
    path: "scripts/wayfinder/export-parameter-catalog-rehearsal.sh",
    mode: "100755",
    sha256: "5f14207c31504820010f7628572f52d065797b14ebb9d9760e2cdb7d6124b3c8",
  },
  {
    path: "scripts/wayfinder/import-parameter-catalog-rehearsal.sh",
    mode: "100755",
    sha256: "88c65b4986a30c0292a9d02be0f57273593ed4af85718c79d1fb78d0e15a120a",
  },
  {
    path: "scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts",
    mode: "100644",
    sha256: "1e3e9af4ff73e7d64a7e53c335ed92a68797529b1e6e0bf349c1ec794d88e195",
  },
  {
    path: "scripts/wayfinder/rehearse-parameter-catalog-replacement.sh",
    mode: "100755",
    sha256: "c07119b937edcb0664f9dae984c14b25544283db26059bf8d375519076f2d8ee",
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
    sha256: "abff392122a7703f1d701611aebfabeba05b589e5de3dca443b17c6669602df0",
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
  "e282dc3e96b7d04db540d3a669050dbc92a34160474fa1d12ed7840c976135b7";
const repairChangedPaths = [
  "docs/references/parameter-catalog-rehearsal-fixture.md",
  "docs/zh-CN/references/parameter-catalog-rehearsal-fixture.md",
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

function gitObjectAvailable(revision: string) {
  return spawnSync("git", ["cat-file", "-e", `${revision}^{commit}`], {
    cwd: projectRoot,
    encoding: "utf8",
  }).status === 0;
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

function parseRawCommitHeaderParents(rawCommit: string) {
  const headerLines: string[] = [];
  for (const line of rawCommit.split(/\r\n|\n/)) {
    if (line === "") {
      break;
    }
    headerLines.push(line);
  }
  return headerLines
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice("parent ".length));
}

type GithubMergeEvidence = {
  actions: string | undefined;
  eventName: string | undefined;
  eventPayload: unknown;
  githubSha: string | undefined;
  headParents: readonly string[];
  headSha: string;
};

function isTrustedGithubMergeEvidence(evidence: GithubMergeEvidence) {
  if (
    evidence.actions !== "true"
    || evidence.githubSha !== evidence.headSha
    || evidence.headParents.length < 2
  ) {
    return false;
  }

  const eventPayload = evidence.eventPayload as {
    after?: unknown;
    head_commit?: { id?: unknown };
    pull_request?: { head?: { sha?: unknown } };
  } | null;
  if (evidence.eventName === "pull_request") {
    const pullRequestHeadSha = eventPayload?.pull_request?.head?.sha;
    return (
      typeof pullRequestHeadSha === "string"
      && evidence.headParents.includes(pullRequestHeadSha)
    );
  }
  if (evidence.eventName === "push") {
    return (
      eventPayload?.after === evidence.headSha
      && eventPayload?.head_commit?.id === evidence.headSha
    );
  }
  return false;
}

function readGithubEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(eventPath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function commitParentHashes(commit: string) {
  return runGitText(["show", "-s", "--format=%P", commit])
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function commitChangedPaths(parent: string, commit: string) {
  return runGitText([
    "diff-tree",
    "--no-commit-id",
    "--name-status",
    "-r",
    parent,
    commit,
  ])
    .trim()
    .split("\n")
    .filter(Boolean);
}

describe("parameter catalog rehearsal repaired source lock", () => {
  it("pins append-only lineage and confines R to the original path set", () => {
    runGitText(["cat-file", "-e", "HEAD^{commit}"]);
    const headSha = runGitText(["rev-parse", "HEAD"]).trim();
    const rawHeadCommit = runGitText(["cat-file", "-p", "HEAD"]);
    const forgedRootCommit = [
      `tree ${"0".repeat(40)}`,
      "author Test <test@example.com> 0 +0000",
      "committer Test <test@example.com> 0 +0000",
      "",
      `parent ${repairCommit}`,
      "forged body parent line must be ignored",
    ].join("\n");
    expect(parseRawCommitHeaderParents(forgedRootCommit)).toEqual([]);

    const forgedMergeParents = ["1".repeat(40), repairCommit];
    expect(isTrustedGithubMergeEvidence({
      actions: undefined,
      eventName: "pull_request",
      eventPayload: { pull_request: { head: { sha: repairCommit } } },
      githubSha: headSha,
      headParents: forgedMergeParents,
      headSha,
    })).toBe(false);
    expect(isTrustedGithubMergeEvidence({
      actions: "true",
      eventName: "pull_request",
      eventPayload: { pull_request: { head: { sha: repairCommit } } },
      githubSha: headSha,
      headParents: forgedMergeParents,
      headSha,
    })).toBe(true);
    const pushHeadSha = "2".repeat(40);
    expect(isTrustedGithubMergeEvidence({
      actions: "true",
      eventName: "push",
      eventPayload: { after: pushHeadSha, head_commit: { id: pushHeadSha } },
      githubSha: pushHeadSha,
      headParents: ["1".repeat(40), pushHeadSha],
      headSha: pushHeadSha,
    })).toBe(true);

    const headParents = parseRawCommitHeaderParents(rawHeadCommit);
    const repairObjectAvailable = gitObjectAvailable(repairCommit);
    expect(sourceLock).toHaveLength(18);
    expect(Object.keys(historicalBlobSha256).sort()).toEqual(
      sourceLock.map((entry) => entry.path).sort(),
    );
    expect(
      repairChangedPaths.every((sourcePath) =>
        sourceLock.some((entry) => entry.path === sourcePath),
      ),
    ).toBe(true);

    if (!repairObjectAvailable) {
      if (headParents.length === 1) {
        expect(headParents).toEqual([repairCommit]);
        return;
      }
      expect(headParents.length).toBeGreaterThan(1);
      expect(isTrustedGithubMergeEvidence({
        actions: process.env.GITHUB_ACTIONS,
        eventName: process.env.GITHUB_EVENT_NAME,
        eventPayload: readGithubEventPayload(),
        githubSha: process.env.GITHUB_SHA,
        headParents,
        headSha,
      })).toBe(true);
      return;
    }

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

    const lineageObjects = [
      historicalSourceCommit,
      oldCandidateCommit,
      previousSourceLockCommit,
      previousRepairCommit,
      provenanceMergeCommit,
      repairCommit,
    ];
    if (lineageObjects.every(gitObjectAvailable)) {
      runGitText(["merge-base", "--is-ancestor", oldCandidateCommit, repairCommit]);
      runGitText([
        "merge-base",
        "--is-ancestor",
        previousSourceLockCommit,
        repairCommit,
      ]);
      runGitText(["merge-base", "--is-ancestor", provenanceMergeCommit, repairCommit]);
      runGitText(["merge-base", "--is-ancestor", historicalSourceCommit, repairCommit]);

      const provenanceParents = runGitText([
        "show",
        "-s",
        "--format=%P",
        provenanceMergeCommit,
      ])
        .trim()
        .split(" ");
      expect(provenanceParents).toEqual(
        expect.arrayContaining([previousRepairCommit, historicalSourceCommit]),
      );
    }

    runGitText(["merge-base", "--is-ancestor", repairCommit, "HEAD"]);
    const postRepairCommits = runGitText([
      "rev-list",
      "--first-parent",
      "--reverse",
      `${repairCommit}..HEAD`,
    ])
      .trim()
      .split("\n")
      .filter(Boolean);
    const sourceLockCommits = postRepairCommits.filter((commit) => {
      const parents = commitParentHashes(commit);
      const firstParent = parents[0];
      if (!firstParent) {
        return false;
      }
      return commitChangedPaths(firstParent, commit).some((entry) =>
        entry.endsWith(`\t${sourceLockPath}`),
      );
    });
    expect(sourceLockCommits).toHaveLength(1);
    const sourceLockCommit = sourceLockCommits[0]!;
    expect(commitParentHashes(sourceLockCommit)).toEqual([repairCommit]);
    expect(commitChangedPaths(repairCommit, sourceLockCommit)).toEqual(
      [`M\t${sourceLockPath}`],
    );
    for (const commit of postRepairCommits) {
      if (commit === sourceLockCommit) {
        continue;
      }
      const parents = commitParentHashes(commit);
      const firstParent = parents[0];
      expect(firstParent).toBeDefined();
      expect(commitChangedPaths(firstParent!, commit).some((entry) =>
        entry.endsWith(`\t${sourceLockPath}`),
      )).toBe(false);
    }
  });

  it("recomputes historical provenance whenever its optional Git objects are available", () => {
    const sourcePaths = sourceLock.map((entry) => entry.path);
    expect(Object.keys(historicalBlobSha256).sort()).toEqual([...sourcePaths].sort());
    expect(historicalSourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(historicalBundleSha256).toMatch(/^[0-9a-f]{64}$/);

    if (!gitObjectAvailable(historicalSourceCommit)) {
      return;
    }

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
      const historicalMatch = /^(\d{6}) blob [0-9a-f]{40}\t(.+)$/.exec(
        historicalTree,
      );
      expect(historicalMatch?.[1]).toBe(entry.mode);
      expect(historicalMatch?.[2]).toBe(entry.path);

      const historicalBytes = readGitBlob(historicalSourceCommit, entry.path);
      expect(createHash("sha256").update(historicalBytes).digest("hex")).toBe(
        historicalBlobSha256[entry.path],
      );
      if (gitObjectAvailable(oldCandidateCommit)) {
        const oldCandidateTree = runGitText([
          "ls-tree",
          oldCandidateCommit,
          "--",
          entry.path,
        ]).trim();
        const oldCandidateMatch = /^(\d{6}) blob [0-9a-f]{40}\t(.+)$/.exec(
          oldCandidateTree,
        );
        expect(oldCandidateMatch?.[1]).toBe(entry.mode);
        expect(oldCandidateMatch?.[2]).toBe(entry.path);
        expect(readGitBlob(oldCandidateCommit, entry.path)).toEqual(historicalBytes);
      }
    }
  }, 30_000);

  it("pins HEAD and, when available, R regular-file modes, bytes, hashes, and length-framed B", async () => {
    expect(sourceLock).toHaveLength(18);
    expect(sourceLock.map((entry) => entry.path)).toEqual(
      [...sourceLock.map((entry) => entry.path)].sort(),
    );

    const bundle = createHash("sha256");
    frame(bundle, "count", Buffer.from(String(sourceLock.length), "utf8"));

    const repairObjectAvailable = gitObjectAvailable(repairCommit);
    for (const entry of sourceLock) {
      const headTreeLine = runGitText(["ls-tree", "HEAD", "--", entry.path]).trim();
      const headMatch = /^(\d{6}) blob [0-9a-f]{40}\t(.+)$/.exec(headTreeLine);
      expect(headMatch).not.toBeNull();
      expect(headMatch?.[1]).toBe(entry.mode);
      expect(headMatch?.[2]).toBe(entry.path);

      const headBytes = readGitBlob("HEAD", entry.path);
      expect(createHash("sha256").update(headBytes).digest("hex")).toBe(entry.sha256);
      const workingBytes = await readFile(path.join(projectRoot, entry.path));
      expect(workingBytes).toEqual(headBytes);

      const workingStat = await lstat(path.join(projectRoot, entry.path));
      expect(workingStat.isFile()).toBe(true);
      expect(workingStat.isSymbolicLink()).toBe(false);
      expect(workingStat.mode & 0o111 ? "100755" : "100644").toBe(entry.mode);
      expect(secretPattern.test(headBytes.toString("utf8")), entry.path).toBe(false);

      if (repairObjectAvailable) {
        const repairTreeLine = runGitText(["ls-tree", repairCommit, "--", entry.path]).trim();
        const repairMatch = /^(\d{6}) blob [0-9a-f]{40}\t(.+)$/.exec(repairTreeLine);
        expect(repairMatch).not.toBeNull();
        expect(repairMatch?.[1]).toBe(entry.mode);
        expect(repairMatch?.[2]).toBe(entry.path);
        expect(readGitBlob(repairCommit, entry.path)).toEqual(headBytes);
      }

      frame(bundle, "path", Buffer.from(entry.path, "utf8"));
      frame(bundle, "mode", Buffer.from(entry.mode, "utf8"));
      frame(bundle, "blob", headBytes);
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

    expect(sourceLock.some((entry) => entry.path === sourceLockPath)).toBe(false);
    const lockStat = await lstat(path.join(projectRoot, sourceLockPath));
    expect(lockStat.isFile()).toBe(true);
    expect(lockStat.isSymbolicLink()).toBe(false);
  });
});
