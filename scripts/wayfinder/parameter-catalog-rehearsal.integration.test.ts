import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { describe, expect, it } from "vitest";

import { createDatabase } from "../../server/shared/database/client";
import { applyMigrations } from "../../server/shared/database/migrations";
import { isTestDatabaseAvailable } from "../../server/testing/testDatabase";
import {
  adminConnectionString,
  migrationsDir,
  withAdminClient,
  withTempDatabase,
} from "../../server/testing/tempDatabase";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const exporter = path.join(
  projectRoot,
  "scripts/wayfinder/export-parameter-catalog-rehearsal.sh",
);
const importer = path.join(
  projectRoot,
  "scripts/wayfinder/import-parameter-catalog-rehearsal.sh",
);
const rehearser = path.join(
  projectRoot,
  "scripts/wayfinder/rehearse-parameter-catalog-replacement.sh",
);
const containerName =
  process.env.WAYFINDER_POSTGRES_CONTAINER?.trim() || "wiseeff-postgres-1";
const databaseAvailable = await isTestDatabaseAvailable();
const containerAvailable =
  spawnSync("docker", ["inspect", containerName], { stdio: "ignore" }).status === 0;
const artifactFiles = [
  "schema.sql",
  "profile-schema.sql",
  "synthetic-fixture.sql",
  "synthetic-fixture-verify.sql",
  "relations.csv",
  "columns.csv",
  "constraints.csv",
  "indexes.csv",
  "triggers.csv",
  "migration-inventory.csv",
  "row-counts.csv",
  "row-classes.csv",
  "invariant-counts.csv",
  "manifest.csv",
] as const;

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with ${result.status}`,
        result.stdout,
        result.stderr,
      ].join("\n"),
    );
  }
  return result;
}

function runResult(command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function databaseName(connectionString: string) {
  return new URL(connectionString).pathname.slice(1);
}

async function refreshArtifactChecksums(artifactDir: string) {
  const lines = await Promise.all(
    artifactFiles.map(async (file) => {
      const bytes = await readFile(path.join(artifactDir, file));
      return `${createHash("sha256").update(bytes).digest("hex")}  ${file}`;
    }),
  );
  await writeFile(path.join(artifactDir, "SHA256SUMS"), `${lines.sort().join("\n")}\n`);
}

async function writeSafeArtifact(artifactDir: string) {
  for (const file of artifactFiles) {
    await writeFile(path.join(artifactDir, file), "safe fixture input\n");
  }
  const fixtureVerifyHash = createHash("sha256")
    .update(await readFile(path.join(artifactDir, "synthetic-fixture-verify.sql")))
    .digest("hex");
  await writeFile(
    path.join(artifactDir, "manifest.csv"),
    [
      "key,value",
      "format_version,2",
      "artifact_kind,parameter-catalog-populated-rehearsal-fixture",
      "fixture_mode,populated",
      "data_rows_exported,0",
      "source_data_rows_exported,0",
      "synthetic_fixture_version,1",
      "import_populates_synthetic_rows,true",
      "historical_source_commit,6c3adfc35c0e3be6d5d381013dace9408190380e",
      "historical_bundle_sha256,017b3e614f1f4eba5a70f0c6b0cd3316b7e5ebd1aa9ccec4cf8e514c56dba7ff",
      `synthetic_fixture_verify_sha256,${fixtureVerifyHash}`,
      "",
    ].join("\n"),
  );
  await refreshArtifactChecksums(artifactDir);
}

async function refreshFixtureVerifierManifest(artifactDir: string) {
  const verifierHash = createHash("sha256")
    .update(await readFile(path.join(artifactDir, "synthetic-fixture-verify.sql")))
    .digest("hex");
  const manifestPath = path.join(artifactDir, "manifest.csv");
  await writeFile(
    manifestPath,
    (await readFile(manifestPath, "utf8")).replace(
      /synthetic_fixture_verify_sha256,[0-9a-f]{64}/,
      `synthetic_fixture_verify_sha256,${verifierHash}`,
    ),
  );
  await refreshArtifactChecksums(artifactDir);
}

let trustedArchiveSequence = 0;
async function createTrustedArchiveArgs(
  artifactDir: string,
  tempRoot: string,
  includeEveryEntry = false,
) {
  trustedArchiveSequence += 1;
  const archivePath = path.join(
    tempRoot,
    `trusted-artifact-${trustedArchiveSequence}.tar.gz`,
  );
  const memberNames = includeEveryEntry
    ? await readdir(artifactDir)
    : ["SHA256SUMS", ...artifactFiles];
  const archive = runResult("tar", [
    "-czf",
    archivePath,
    "-C",
    path.dirname(artifactDir),
    "--",
    ...memberNames.map(
      (file) => `${path.basename(artifactDir)}/${file}`,
    ),
  ]);
  expect(archive.status, archive.stderr).toBe(0);
  const digest = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  return ["--archive", archivePath, "--expected-archive-sha256", digest] as const;
}

describe("parameter catalog rehearsal SQL containment", () => {
  it("accepts only the transaction-contained fixture DDL/DML subset", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-safe-sql-"),
    );
    const candidateFile = path.join(tempRoot, "candidate.sql");
    const validationFile = path.join(tempRoot, "validation.sql");

    try {
      await writeFile(
        candidateFile,
        "create schema wf671_candidate; set constraints all immediate;\n",
      );
      await writeFile(
        validationFile,
        [
          "select count(*) from pg_catalog.pg_namespace;",
          String.raw`select E'ordinary\\path', 'ordinary\path';`,
          String.raw`-- a documented \gexec is not executable here`,
          String.raw`/* nor is a documented \connect inside a block comment */`,
          "select 'commit work is documentation';",
          "",
        ].join("\n"),
      );

      const result = runResult("bash", [
        rehearser,
        "--check-sql-only",
        "--migration-file",
        candidateFile,
        "--validation-file",
        validationFile,
      ]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("SQL_INPUT_OK\n");
      expect(result.stderr).toBe("");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["commit-work", "select 1; /* conceal */ commit /* gap */ work;"],
    ["end-transaction", "end;"],
    ["prepared-transaction", "prepare /* gap */ transaction 'wf671';"],
    ["savepoint", "savepoint wf671;"],
    ["release-savepoint", "release /* gap */ savepoint wf671;"],
    ["copy-stdin", "copy wf671_candidate from /* gap */ stdin;"],
    ["psql-i", "\\i /tmp/escape.sql"],
    ["psql-ir", "\\ir escape.sql"],
    ["psql-gexec", "select 'commit'; \\gexec"],
    ["psql-gset", "select 'commit' as x; \\gset"],
    ["psql-copy", "\\copy wf671_candidate from '/tmp/data'"],
    ["psql-connect", "\\connect postgres"],
    ["psql-shell", "\\! touch /tmp/wf671-escape"],
    ["psql-quit", "\\q"],
    ["psql-autocommit", "\\set AUTOCOMMIT on"],
    ["session-role", "set role postgres;"],
    ["session-authorization", "set session authorization postgres;"],
    ["session-search-path", "set search_path = public;"],
    ["session-reset", "reset all;"],
    ["session-discard", "discard all;"],
    [
      "dynamic-control",
      "do $$ begin execute 'commit work'; end $$;",
    ],
    [
      "dynamic-set-config",
      "select set_config('search_path', 'public', false);",
    ],
    ["copy-to-program", "copy (select 'escape') to program 'touch /tmp/wf671';"],
    ["copy-to-server-file", "copy (select 'escape') to '/tmp/wf671';"],
    ["copy-from-server-file", "copy wf671_candidate from '/tmp/wf671';"],
    ["copy-to-stdout", "copy (select 'escape') to stdout;"],
    ["copy-from-stdin", "copy wf671_candidate from stdin;"],
    ["create-extension", "create extension dblink;"],
    ["foreign-data-wrapper", "create foreign data wrapper wf671 handler postgres_fdw_handler;"],
    ["foreign-server", "create server wf671 foreign data wrapper postgres_fdw;"],
    ["user-mapping", "create user mapping for current_user server wf671;"],
    ["direct-dblink", "select dblink_exec('dbname=postgres', 'select 1');"],
    ["large-object-export", "select lo_export(lo_create(0), '/tmp/wf671');"],
    ["server-file-write", "select pg_write_file('/tmp/wf671', 'escape');"],
    ["procedure-call", "call wf671_external_effect();"],
    [
      "single-quoted-function-body",
      "create function wf671_external_effect() returns void language plpgsql as 'begin perform dblink_exec(''dbname=postgres'', ''select 1''); end';",
    ],
    [
      "single-quoted-do-body",
      "do 'begin perform dblink_exec(''dbname=postgres'', ''select 1''); end';",
    ],
  ])("rejects %s before opening a database session", async (_name, sql) => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-unsafe-sql-"),
    );
    const candidateFile = path.join(tempRoot, "candidate.sql");
    const validationFile = path.join(tempRoot, "validation.sql");

    try {
      await writeFile(candidateFile, `${sql}\n`);
      await writeFile(validationFile, "select 1;\n");
      const result = runResult("bash", [
        rehearser,
        "--check-sql-only",
        "--migration-file",
        candidateFile,
        "--validation-file",
        validationFile,
      ]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "SQL input contains a forbidden transaction, session, or psql control",
      );
      expect(result.stdout).toBe("");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["concatenated string", "do $$ begin execute 'com' || 'mit work'; end $$;"],
    ["concat expression", "do $$ begin execute concat('com', 'mit work'); end $$;"],
    [
      "format expression",
      "do $$ begin execute format('%s %s', 'commit', 'work'); end $$;",
    ],
    [
      "escape-string expression",
      String.raw`do $$ begin execute E'com\\x6dit work'; end $$;`,
    ],
    [
      "Unicode-escape expression",
      String.raw`do $$ begin execute U&'com\\006Dit work'; end $$;`,
    ],
  ])(
    "rejects procedural EXECUTE via %s before any database side effect",
    async (_name, sql) => {
      const tempRoot = await mkdtemp(
        path.join(os.tmpdir(), "wiseeff-wayfinder671-dynamic-execute-"),
      );
      const fakeBin = path.join(tempRoot, "bin");
      const fakeDocker = path.join(fakeBin, "docker");
      const databaseSessionMarker = path.join(tempRoot, "database-session-opened");
      const candidateFile = path.join(tempRoot, "candidate.sql");
      const validationFile = path.join(tempRoot, "validation.sql");

      try {
        await mkdir(fakeBin);
        await writeFile(
          fakeDocker,
          [
            "#!/usr/bin/env bash",
            'printf %s invoked > "${WAYFINDER_DB_SESSION_MARKER:?}"',
            "exit 97",
            "",
          ].join("\n"),
        );
        await chmod(fakeDocker, 0o755);
        await writeFile(candidateFile, `${sql}\n`);
        await writeFile(validationFile, "select 1;\n");

        const result = spawnSync(
          "bash",
          [
            rehearser,
            "--container",
            "wayfinder-dynamic-execute-probe",
            "--database",
            "wiseeff_wayfinder671_restore_dynamic_execute_probe",
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ],
          {
            cwd: projectRoot,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${fakeBin}:${process.env.PATH}`,
              WAYFINDER_DB_SESSION_MARKER: databaseSessionMarker,
            },
          },
        );

        expect(result.status).toBe(2);
        expect(result.stderr).toContain(
          "SQL input contains a forbidden transaction, session, or psql control",
        );
        expect(result.stdout).toBe("");
        await expect(readFile(databaseSessionMarker, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  );

  it("executes the immutable SQL snapshots when caller paths change", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-input-snapshot-"),
    );
    const fakeBin = path.join(tempRoot, "bin");
    const fakeDocker = path.join(fakeBin, "docker");
    const candidateFile = path.join(tempRoot, "candidate.sql");
    const validationFile = path.join(tempRoot, "validation.sql");
    const capturedInput = path.join(tempRoot, "captured-candidate.sql");
    const verifierChecksum = createHash("sha256")
      .update(
        await readFile(
          path.join(projectRoot, "scripts/wayfinder/sql/synthetic-fixture-verify.sql"),
        ),
      )
      .digest("hex");

    try {
      await mkdir(fakeBin);
      await writeFile(candidateFile, "create schema wf671_snapshot_original;\n");
      await writeFile(validationFile, "select 1;\n");
      await writeFile(
        fakeDocker,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'payload="$(command cat)"',
          'arguments="$*"',
          'if [[ "${arguments}" == *"pg_dump"* ]]; then printf "stable dump\\n"; exit 0; fi',
          'if [[ "${arguments}" == *"to_regclass"* ]]; then',
          '  printf "%s\\n" "copy (select 1) to program \'touch /tmp/wf671-mutated\';" > "${WAYFINDER_CALLER_CANDIDATE:?}"',
          '  printf "wayfinder_rehearsal.fixture_cases\\n"',
          "  exit 0",
          "fi",
          'if [[ "${arguments}" == *"fixture_mode"* ]]; then printf "populated\\n"; exit 0; fi',
          'if [[ "${arguments}" == *"synthetic_fixture_verify_sha256"* ]]; then printf "%s\\n" "${WAYFINDER_VERIFIER_CHECKSUM:?}"; exit 0; fi',
          'if [[ "${arguments}" == *"count(*) from wayfinder_rehearsal.fixture_cases"* ]]; then printf "10\\n"; exit 0; fi',
          'if [[ "${payload}" == *"__WISEEFF_WAYFINDER_671_VALIDATION__"* ]]; then',
          '  printf "%s" "${payload}" > "${WAYFINDER_CAPTURED_INPUT:?}"',
          '  printf "__WISEEFF_WAYFINDER_671_FIXTURE_VERIFY_AFTER_CANDIDATE__\\n"',
          "fi",
          "exit 0",
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);

      const result = spawnSync(
        "bash",
        [
          rehearser,
          "--container",
          "wayfinder-snapshot-probe",
          "--database",
          "wiseeff_wayfinder671_restore_snapshot_probe",
          "--migration-file",
          candidateFile,
          "--validation-file",
          validationFile,
        ],
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            WAYFINDER_CALLER_CANDIDATE: candidateFile,
            WAYFINDER_CAPTURED_INPUT: capturedInput,
            WAYFINDER_VERIFIER_CHECKSUM: verifierChecksum,
          },
        },
      );

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const executed = await readFile(capturedInput, "utf8");
      expect(executed).toContain("create schema wf671_snapshot_original;");
      expect(executed).not.toContain("copy (select 1) to program");
      expect(await readFile(candidateFile, "utf8")).toContain("copy (select 1)");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("parameter catalog rehearsal artifact containment", () => {
  it("requires an externally trusted digest for the immutable archive bytes", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-trusted-archive-"),
    );
    const artifactDir = path.join(tempRoot, "artifact");
    try {
      await mkdir(artifactDir);
      await writeSafeArtifact(artifactDir);
      const trustedArgs = await createTrustedArchiveArgs(artifactDir, tempRoot);
      const accepted = runResult("bash", [
        importer,
        "--validate-artifact-only",
        ...trustedArgs,
      ]);
      expect(accepted.status, accepted.stderr).toBe(0);
      expect(accepted.stdout).toBe("ARTIFACT_OK\n");

      const missingTrust = runResult("bash", [
        importer,
        "--validate-artifact-only",
        "--archive",
        trustedArgs[1],
      ]);
      expect(missingTrust.status).toBe(2);
      expect(missingTrust.stderr).toContain("--expected-archive-sha256 is required");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a leading-dash artifact basename before opening a database session", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-dash-basename-"),
    );
    const fakeBin = path.join(tempRoot, "bin");
    const fakeDocker = path.join(fakeBin, "docker");
    const marker = path.join(tempRoot, "database-session-opened");
    try {
      await mkdir(fakeBin);
      await writeFile(fakeDocker, [
        "#!/usr/bin/env bash",
        'printf invoked > "${WAYFINDER_DB_SESSION_MARKER:?}"',
        "exit 97",
        "",
      ].join("\n"));
      await chmod(fakeDocker, 0o755);
      const result = spawnSync("bash", [
        exporter,
        "--container",
        "wayfinder-dash-basename-probe",
        "--fixture-mode",
        "populated",
        "--output-dir",
        path.join(tempRoot, "-artifact"),
      ], {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          WAYFINDER_DB_SESSION_MARKER: marker,
        },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Artifact basename must not begin with a dash");
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("requires an explicit fixture mode before opening a database session", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-explicit-mode-"),
    );
    const fakeBin = path.join(tempRoot, "bin");
    const fakeDocker = path.join(fakeBin, "docker");
    const databaseSessionMarker = path.join(tempRoot, "database-session-opened");
    try {
      await mkdir(fakeBin);
      await writeFile(
        fakeDocker,
        [
          "#!/usr/bin/env bash",
          'printf %s invoked > "${WAYFINDER_DB_SESSION_MARKER:?}"',
          "exit 97",
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);
      const result = spawnSync(
        "bash",
        [
          exporter,
          "--container",
          "wayfinder-explicit-mode-probe",
          "--output-dir",
          path.join(tempRoot, "artifact"),
        ],
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            WAYFINDER_DB_SESSION_MARKER: databaseSessionMarker,
          },
        },
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        "--fixture-mode must be explicitly set to populated or zero",
      );
      await expect(readFile(databaseSessionMarker, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("accepts only the exact regular-file artifact world", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-artifact-world-"),
    );
    const artifactDir = path.join(tempRoot, "artifact");
    try {
      await mkdir(artifactDir);
      await writeSafeArtifact(artifactDir);
      const result = runResult("bash", [
        importer,
        "--validate-artifact-only",
        ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
      ]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("ARTIFACT_OK\n");
      expect(result.stderr).toBe("");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["regular file", "file"],
    ["directory", "directory"],
    ["symbolic link", "symlink"],
    ["FIFO", "fifo"],
  ])("rejects an unknown %s before hashing", async (_label, kind) => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-artifact-entry-"),
    );
    const artifactDir = path.join(tempRoot, "artifact");
    try {
      await mkdir(artifactDir);
      await writeSafeArtifact(artifactDir);
      const unexpected = path.join(artifactDir, "unexpected-entry");
      if (kind === "file") await writeFile(unexpected, "not registered\n");
      if (kind === "directory") {
        const result = spawnSync("mkdir", [unexpected]);
        expect(result.status).toBe(0);
      }
      if (kind === "symlink") {
        const result = spawnSync("ln", ["-s", "schema.sql", unexpected]);
        expect(result.status).toBe(0);
      }
      if (kind === "fifo") {
        const result = spawnSync("mkfifo", [unexpected]);
        expect(result.status).toBe(0);
      }

      const result = runResult("bash", [
        importer,
        "--validate-artifact-only",
        ...(await createTrustedArchiveArgs(artifactDir, tempRoot, true)),
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unknown artifact entry: unexpected-entry");
      expect(result.stdout).toBe("");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("secret-scans every registered generated artifact", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-artifact-secret-"),
    );
    const artifactDir = path.join(tempRoot, "artifact");
    try {
      await mkdir(artifactDir);
      await writeSafeArtifact(artifactDir);
      const syntheticSecret = ["AKIA", "1234567890ABCDEF"].join("");
      await writeFile(path.join(artifactDir, "schema.sql"), `${syntheticSecret}\n`);
      await refreshArtifactChecksums(artifactDir);

      const result = runResult("bash", [
        importer,
        "--validate-artifact-only",
        ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Sensitive-token pattern detected in schema.sql");
      expect(result.stderr).not.toContain(syntheticSecret);
      expect(result.stdout).toBe("");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "FDW user mapping password",
      ["create user mapping for current_user server wf options (", "password", " 'wf671-sensitive');"].join(""),
    ],
    ["libpq keyword password", ["host=localhost dbname=wiseeff ", "password", "=wf671-sensitive"].join("")],
    ["PGPASSWORD assignment", ["PGPASS", "WORD=wf671-sensitive"].join("")],
    ["credential URI", ["postgresql://fixture:", "wf671-sensitive", "@localhost/wiseeff"].join("")],
    ["generic access token", ["access_", "token=wf671-sensitive-value"].join("")],
  ])("rejects PostgreSQL %s forms in the closed artifact world", async (_label, secret) => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-artifact-credential-"),
    );
    const artifactDir = path.join(tempRoot, "artifact");
    try {
      await mkdir(artifactDir);
      await writeSafeArtifact(artifactDir);
      await writeFile(path.join(artifactDir, "schema.sql"), `${secret}\n`);
      await refreshArtifactChecksums(artifactDir);

      const result = runResult("bash", [
        importer,
        "--validate-artifact-only",
        ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Sensitive-token pattern detected in schema.sql");
      expect(result.stderr).not.toContain("wf671-sensitive");
      expect(result.stdout).toBe("");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects a manifest whose fixture mode and artifact kind disagree", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-artifact-mode-"),
    );
    const artifactDir = path.join(tempRoot, "artifact");
    try {
      await mkdir(artifactDir);
      await writeSafeArtifact(artifactDir);
      const manifestPath = path.join(artifactDir, "manifest.csv");
      await writeFile(
        manifestPath,
        (await readFile(manifestPath, "utf8")).replace(
          "fixture_mode,populated",
          "fixture_mode,zero",
        ),
      );
      await refreshArtifactChecksums(artifactDir);

      const result = runResult("bash", [
        importer,
        "--validate-artifact-only",
        ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "Zero fixture manifest mode and import policy disagree",
      );
      expect(result.stdout).toBe("");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("imports the immutable artifact snapshot when caller files change", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-artifact-snapshot-"),
    );
    const artifactDir = path.join(tempRoot, "artifact");
    const fakeBin = path.join(tempRoot, "bin");
    const fakeDocker = path.join(fakeBin, "docker");
    const capturedInput = path.join(tempRoot, "captured-import.sql");
    try {
      await mkdir(artifactDir);
      await writeSafeArtifact(artifactDir);
      const trustedArgs = await createTrustedArchiveArgs(artifactDir, tempRoot);
      await mkdir(fakeBin);
      await writeFile(
        fakeDocker,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'payload="$(command cat)"',
          'if [[ "$*" == *"user_namespaces"* ]]; then printf "0\\n"; exit 0; fi',
          'if [[ "$*" == *"from pg_database"* ]]; then',
          '  printf "mutated caller archive\\n" > "${WAYFINDER_CALLER_ARCHIVE:?}"',
          '  printf "1\\n"',
          "  exit 0",
          "fi",
          'printf "%s" "${payload}" > "${WAYFINDER_CAPTURED_IMPORT:?}"',
          'printf "__WISEEFF_IMPORT_METRICS__|1|1|10|1\\n"',
          "exit 0",
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);

      const result = spawnSync(
        "bash",
        [
          importer,
          "--container",
          "wayfinder-import-snapshot-probe",
          "--database",
          "wiseeff_wayfinder671_restore_import_snapshot_probe",
          ...trustedArgs,
        ],
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            WAYFINDER_CALLER_ARCHIVE: trustedArgs[1],
            WAYFINDER_CAPTURED_IMPORT: capturedInput,
          },
        },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const executed = await readFile(capturedInput, "utf8");
      expect(executed).toContain("safe fixture input");
      expect(executed).not.toContain("mutated caller archive");
      expect(await readFile(trustedArgs[1], "utf8")).toBe("mutated caller archive\n");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("parameter catalog rehearsal cleanup containment", () => {
  it("emits CLEANUP_OK only after its owned resources are gone", () => {
    const result = runResult("bash", [rehearser, "--check-cleanup-only"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("CLEANUP_OK\n");
    expect(result.stderr).toBe("");
  });

  it("fails closed and withholds CLEANUP_OK when cleanup fails", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-cleanup-failure-"),
    );
    const fakeBin = path.join(tempRoot, "bin");
    const fakePython = path.join(fakeBin, "python3");
    const realPython = runResult("which", ["python3"]).stdout.trim();
    try {
      await mkdir(fakeBin);
      await writeFile(
        fakePython,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'probe="$(mktemp)"',
          'command cat > "${probe}"',
          'if grep -q "os.rmdir" "${probe}"; then exit 73; fi',
          `exec ${JSON.stringify(realPython)} "$@" < "\${probe}"`,
          "",
        ].join("\n"),
      );
      await chmod(fakePython, 0o755);
      const result = spawnSync("bash", [rehearser, "--check-cleanup-only"], {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          TMPDIR: tempRoot,
        },
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("CLEANUP_FAILED");
      expect(result.stderr).not.toContain("CLEANUP_OK");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("never deletes a foreign output path created after the preflight check", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-export-race-"),
    );
    const fakeBin = path.join(tempRoot, "bin");
    const fakeDocker = path.join(fakeBin, "docker");
    const invocationCounter = path.join(tempRoot, "docker-invocations");
    const outputDir = path.join(tempRoot, "artifact");
    const foreignFile = path.join(outputDir, "foreign-data");
    try {
      await mkdir(fakeBin);
      await writeFile(
        fakeDocker,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'counter="${WAYFINDER_DOCKER_INVOCATIONS:?}"',
          'current="$(cat "${counter}" 2>/dev/null || printf 0)"',
          'current="$((current + 1))"',
          'printf "%s" "${current}" > "${counter}"',
          'case "${current}" in',
          "  1) printf 'on\\n' ;;",
          "  2) ;;",
          "  3) printf '0\\n' ;;",
          "  4)",
          '    mkdir -p "${WAYFINDER_FOREIGN_OUTPUT:?}"',
          '    printf "%s\\n" foreign > "${WAYFINDER_FOREIGN_OUTPUT}/foreign-data"',
          "    exit 73",
          "    ;;",
          "  *) exit 97 ;;",
          "esac",
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);

      const result = spawnSync(
        "bash",
        [
          exporter,
          "--container",
          "wayfinder-export-race-probe",
          "--database",
          "wiseeff",
          "--fixture-mode",
          "populated",
          "--output-dir",
          outputDir,
        ],
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            WAYFINDER_DOCKER_INVOCATIONS: invocationCounter,
            WAYFINDER_FOREIGN_OUTPUT: outputDir,
          },
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("EXPORT_FAILED");
      expect(await readFile(foreignFile, "utf8")).toBe("foreign\n");
      expect(
        (await readdir(tempRoot)).filter((entry) => entry.startsWith("artifact.tmp.")),
      ).toEqual([]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("preserves a foreign replacement for the runner private directory", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "wiseeff-wayfinder671-runner-race-"),
    );
    const fakeBin = path.join(tempRoot, "bin");
    const fakeDocker = path.join(fakeBin, "docker");
    const candidateFile = path.join(tempRoot, "candidate.sql");
    const validationFile = path.join(tempRoot, "validation.sql");
    try {
      await mkdir(fakeBin);
      await writeFile(candidateFile, "select 1;\n");
      await writeFile(validationFile, "select 1;\n");
      await writeFile(
        fakeDocker,
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'runner="$(find "${TMPDIR:?}" -mindepth 1 -maxdepth 1 -type d -name "wiseeff-wayfinder671-runner.*" -print -quit)"',
          'if [[ -n "${runner}" && ! -e "${runner}.displaced" ]]; then',
          '  mv "${runner}" "${runner}.displaced"',
          '  mkdir "${runner}"',
          '  printf "foreign\\n" > "${runner}/foreign-data"',
          "fi",
          'if [[ "$*" == *"to_regclass"* ]]; then printf "wayfinder_rehearsal.fixture_cases\\n"; fi',
          'if [[ "$*" == *"fixture_mode"* ]]; then printf "populated\\n"; fi',
          'if [[ "$*" == *"count(*) from wayfinder_rehearsal.fixture_cases"* ]]; then printf "10\\n"; fi',
          "exit 0",
          "",
        ].join("\n"),
      );
      await chmod(fakeDocker, 0o755);

      const result = spawnSync(
        "bash",
        [
          rehearser,
          "--container",
          "wayfinder-runner-race-probe",
          "--database",
          "wiseeff_wayfinder671_restore_runner_race_probe",
          "--migration-file",
          candidateFile,
          "--validation-file",
          validationFile,
        ],
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, TMPDIR: tempRoot },
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("CLEANUP_FAILED");
      const replacement = (await readdir(tempRoot)).find((entry) =>
        entry.startsWith("wiseeff-wayfinder671-runner.") && !entry.endsWith(".displaced"),
      );
      expect(replacement).toBeDefined();
      expect(await readFile(path.join(tempRoot, replacement!, "foreign-data"), "utf8"))
        .toBe("foreign\n");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!(databaseAvailable && containerAvailable))(
  "parameter catalog rehearsal artifact",
  () => {
    it(
      "refuses credential-bearing FDW metadata before producing an export artifact",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-fdw-secret-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        try {
          await withTempDatabase(
            { prefix: "wayfinder671_fdw_secret", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              const client = new pg.Client({ connectionString });
              await client.connect();
              try {
                await client.query("create extension postgres_fdw");
                await client.query(
                  "create server wf671_secret foreign data wrapper postgres_fdw options (host '127.0.0.1')",
                );
                await client.query(
                  [
                    "create user mapping for current_user server wf671_secret options (user 'fixture', ",
                    "password",
                    " 'wf671-sensitive')",
                  ].join(""),
                );
              } finally {
                await client.end();
              }

              const result = runResult("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
              expect(result.status).not.toBe(0);
              expect(result.stderr).toContain(
                "Source database contains external or credential-bearing objects",
              );
              await expect(readFile(path.join(artifactDir, "schema.sql"), "utf8"))
                .rejects.toMatchObject({ code: "ENOENT" });
            },
          );
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "refuses standalone FDWs and disconnected subscriptions before export",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-external-source-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        try {
          await withTempDatabase(
            { prefix: "wayfinder671_external_source", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              const client = new pg.Client({ connectionString });
              await client.connect();
              try {
                await client.query(
                  "create foreign data wrapper wf671_standalone_fdw no handler",
                );
                await client.query(`
                  create subscription wf671_disconnected_subscription
                  connection 'host=127.0.0.1 port=1 dbname=postgres user=wiseeff'
                  publication wf671_absent_publication
                  with (connect = false, create_slot = false, enabled = false)
                `);

                const result = runResult("bash", [
                  exporter,
                  "--container",
                  containerName,
                  "--database",
                  databaseName(connectionString),
                  "--fixture-mode",
                  "populated",
                  "--output-dir",
                  artifactDir,
                ]);
                expect(result.status).not.toBe(0);
                expect(result.stderr).toContain(
                  "Source database contains external or credential-bearing objects",
                );
                await expect(readFile(path.join(artifactDir, "schema.sql"), "utf8"))
                  .rejects.toMatchObject({ code: "ENOENT" });
              } finally {
                await client.query(
                  "alter subscription wf671_disconnected_subscription disable",
                );
                await client.query(
                  "alter subscription wf671_disconnected_subscription set (slot_name = NONE)",
                );
                await client.query("drop subscription wf671_disconnected_subscription");
                await client.end();
              }
            },
          );
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "rejects external SQL capabilities against the real PostgreSQL target before any side effect",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-copy-side-effect-"),
        );
        const candidateFile = path.join(tempRoot, "candidate.sql");
        const validationFile = path.join(tempRoot, "validation.sql");
        const marker = `/tmp/wiseeff-wayfinder671-copy-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
        const restoreDatabase = `wiseeff_wayfinder671_restore_copy_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const db = createDatabase({
              query: async (text, values = []) => {
                const result = await client.query(text, values);
                return { rows: result.rows, rowCount: result.rowCount };
              },
            });
            await applyMigrations(db, migrationsDir, {
              through: "0128_repair_driver_placement_subject_cutover.sql",
            });
            const before = await client.query<{ count: string }>(
              "select count(*)::text as count from schema_migrations",
            );
            expect(
              spawnSync("docker", ["exec", containerName, "test", "!", "-e", marker])
                .status,
            ).toBe(0);
            await writeFile(validationFile, "select 1;\n");
            const unsafeCandidates = [
              `copy (select 'escape') to program 'touch ${marker}';\n`,
              `create function wf671_external_effect() returns void language plpgsql as 'begin perform pg_catalog.pg_write_file(''${marker}'', ''escape''); end'; select wf671_external_effect();\n`,
              `select lo_export(lo_create(0), '${marker}');\n`,
            ];
            for (const unsafeSql of unsafeCandidates) {
              await writeFile(candidateFile, unsafeSql);
              const result = runResult("bash", [
                rehearser,
                "--container",
                containerName,
                "--database",
                restoreDatabase,
                "--migration-file",
                candidateFile,
                "--validation-file",
                validationFile,
              ]);

              expect(result.status).toBe(2);
              expect(result.stderr).toContain(
                "SQL input contains a forbidden transaction, session, or psql control",
              );
              expect(
                spawnSync("docker", ["exec", containerName, "test", "!", "-e", marker])
                  .status,
              ).toBe(0);
              const after = await client.query<{ count: string }>(
                "select count(*)::text as count from schema_migrations",
              );
              expect(after.rows).toEqual(before.rows);
            }
          } finally {
            await client.end();
          }
        } finally {
          await withAdminClient(async (admin) => {
            await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "lexically rejects inline psql commands but accepts backslashes in SQL strings and comments",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-psql-lexer-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        try {
          await withTempDatabase(
            { prefix: "wayfinder671_psql_lexer", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          const schemaPath = path.join(artifactDir, "schema.sql");
          const baseSchema = await readFile(schemaPath, "utf8");
          await chmod(schemaPath, 0o600);

          for (const inlineCommand of [
            String.raw`select 'select 1' \gexec`,
            String.raw`select 1 \gset wf671_`,
            String.raw`select 1; \! true`,
            String.raw`select 1; \connect postgres`,
          ]) {
            await writeFile(schemaPath, `${baseSchema}\n${inlineCommand}\n`);
            await refreshArtifactChecksums(artifactDir);
            const result = runResult("bash", [
              importer,
              "--validate-artifact-only",
              ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
            ]);
            expect(result.status, inlineCommand).not.toBe(0);
            expect(result.stderr).toContain(
              "Unsafe psql meta-command detected in schema.sql",
            );
          }

          await writeFile(
            schemaPath,
            [
              baseSchema,
              String.raw`select 'ordinary\path', E'escaped\\path';`,
              String.raw`-- documented \gexec is not executable`,
              String.raw`/* documented \connect and \! are not executable */`,
              "",
            ].join("\n"),
          );
          await refreshArtifactChecksums(artifactDir);
          const safeResult = runResult("bash", [
            importer,
            "--validate-artifact-only",
            ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
          ]);
          expect(safeResult.status, safeResult.stderr).toBe(0);
          expect(safeResult.stdout).toBe("ARTIFACT_OK\n");
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "rejects checksum-consistent inline gexec before any real PostgreSQL side effect",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-psql-gexec-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const restoreDatabase = `wiseeff_wayfinder671_restore_psql_gexec_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
        try {
          await withTempDatabase(
            { prefix: "wayfinder671_psql_gexec", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          const schemaPath = path.join(artifactDir, "schema.sql");
          await chmod(schemaPath, 0o600);
          await writeFile(
            schemaPath,
            [
              await readFile(schemaPath, "utf8"),
              String.raw`select 'create table public.wf671_inline_meta_side_effect(id integer)' \gexec`,
              "",
            ].join("\n"),
          );
          await refreshArtifactChecksums(artifactDir);
          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });

          const result = runResult("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
          ]);
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("Unsafe psql meta-command detected in schema.sql");

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const state = await client.query<{
              ledger: string | null;
              side_effect: string | null;
            }>(`
              select
                to_regclass('public.schema_migrations')::text as ledger,
                to_regclass('public.wf671_inline_meta_side_effect')::text as side_effect
            `);
            expect(state.rows).toEqual([{ ledger: null, side_effect: null }]);
          } finally {
            await client.end();
          }
        } finally {
          await withAdminClient(async (admin) => {
            await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "restores checked-empty when a post-commit log scan fails",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-log-scan-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const restoreDatabase = `wiseeff_wayfinder671_restore_log_scan_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
        try {
          await withTempDatabase(
            { prefix: "wayfinder671_log_scan", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          const verifierPath = path.join(artifactDir, "synthetic-fixture-verify.sql");
          await chmod(verifierPath, 0o600);
          await writeFile(
            verifierPath,
            `${await readFile(verifierPath, "utf8")}\nselect 'PGPASS' || 'WORD=wf671-sensitive' as emitted;\n`,
          );
          const schemaPath = path.join(artifactDir, "schema.sql");
          await chmod(schemaPath, 0o600);
          await writeFile(
            schemaPath,
            [
              await readFile(schemaPath, "utf8"),
              "create foreign data wrapper wf671_cleanup_fdw no handler;",
              "create server wf671_cleanup_server foreign data wrapper wf671_cleanup_fdw;",
              "create user mapping for current_user server wf671_cleanup_server;",
              [
                "create subscription wf671_cleanup_subscription",
                "connection 'host=127.0.0.1 port=1 dbname=postgres user=wiseeff'",
                "publication wf671_absent_publication",
                "with (connect = false, create_slot = false, enabled = false);",
              ].join(" "),
              "",
            ].join("\n"),
          );
          await refreshFixtureVerifierManifest(artifactDir);
          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });

          const result = runResult("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
          ]);
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("Sensitive-token pattern detected in import.log");
          expect(result.stderr.match(/^CLEANUP_OK$/gm)).toHaveLength(1);
          expect(result.stderr.match(/^CLEANUP_FAILED$/gm) ?? []).toHaveLength(0);

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const state = await client.query<{ objects: string }>(`
              with user_namespaces as (
                select oid
                from pg_namespace
                where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
                  and nspname !~ '^pg_(temp|toast_temp)_'
              ), object_counts(value) as (
                values
                  ((select count(*) from pg_namespace where oid in (select oid from user_namespaces) and nspname <> 'public')),
                  ((select count(*) from pg_class where relnamespace in (select oid from user_namespaces))),
                  ((select count(*) from pg_proc where pronamespace in (select oid from user_namespaces))),
                  ((select count(*) from pg_extension where extname <> 'plpgsql')),
                  ((select count(*) from pg_publication)),
                  ((select count(*) from pg_subscription where subdbid = (select oid from pg_database where datname = current_database()))),
                  ((select count(*) from pg_foreign_data_wrapper)),
                  ((select count(*) from pg_foreign_server)),
                  ((select count(*) from pg_user_mapping))
              )
              select coalesce(sum(value), 0)::text as objects from object_counts
            `);
            expect(state.rows).toEqual([{ objects: "0" }]);
          } finally {
            await client.end();
          }
        } finally {
          const cleanupClient = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          try {
            await cleanupClient.connect();
            const subscription = await cleanupClient.query<{ present: boolean }>(`
              select exists (
                select 1 from pg_subscription
                where subdbid = (select oid from pg_database where datname = current_database())
                  and subname = 'wf671_cleanup_subscription'
              ) as present
            `);
            if (subscription.rows[0]?.present) {
              await cleanupClient.query("alter subscription wf671_cleanup_subscription disable");
              await cleanupClient.query(
                "alter subscription wf671_cleanup_subscription set (slot_name = NONE)",
              );
              await cleanupClient.query("drop subscription wf671_cleanup_subscription");
            }
          } catch {
            // The database may not have been created if fixture preparation failed.
          } finally {
            await cleanupClient.end().catch(() => undefined);
          }
          await withAdminClient(async (admin) => {
            await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "exports, imports, verifies, and rolls back an explicit zero-inventory fixture",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-zero-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const candidateFile = path.join(tempRoot, "candidate.sql");
        const validationFile = path.join(tempRoot, "validation.sql");
        const restoreDatabase = `wiseeff_wayfinder671_restore_zero_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_zero_source", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "zero",
                "--output-dir",
                artifactDir,
              ]);
            },
          );

          expect(await readFile(path.join(artifactDir, "manifest.csv"), "utf8"))
            .toContain("fixture_mode,zero\n");
          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          run("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
          ]);

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const zeroInventory = await client.query<{
              parameter_specs: string;
              driver_schemas: string;
              bindings: string;
              fixture_cases: string;
            }>(`
              select
                (select count(*)::text from parameter_specs) as parameter_specs,
                (select count(*)::text from driver_schemas) as driver_schemas,
                (select count(*)::text from project_parameter_bindings) as bindings,
                (select count(*)::text from wayfinder_rehearsal.fixture_cases)
                  as fixture_cases
            `);
            expect(zeroInventory.rows).toEqual([
              {
                parameter_specs: "0",
                driver_schemas: "0",
                bindings: "0",
                fixture_cases: "0",
              },
            ]);
          } finally {
            await client.end();
          }

          await writeFile(candidateFile, "create schema wf671_zero_candidate;\n");
          await writeFile(
            validationFile,
            `
              select 1 / case when not exists (
                select 1 from parameter_specs
              ) then 1 else 0 end;
            `,
          );
          const rehearsal = run("bash", [
            rehearser,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ]);
          expect(rehearsal.stdout).toContain("REHEARSAL_ROLLBACK_OK");
          expect(rehearsal.stdout).toContain("fixture_mode=zero");
          expect(rehearsal.stdout).toContain("fixture_cases=0");
        } finally {
          await withAdminClient(async (admin) => {
            await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "imports a deterministic populated graph that replays the observed migration cohorts",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-populated-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const restoreDatabase = `wiseeff_wayfinder671_restore_populated_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_source", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );

          expect(
            await readFile(path.join(artifactDir, "synthetic-fixture.sql"), "utf8"),
          ).toContain("wf671-platform-driver-definition");
          expect(
            await readFile(
              path.join(artifactDir, "synthetic-fixture-verify.sql"),
              "utf8",
            ),
          ).toContain("wayfinder_rehearsal.fixture_cases");

          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          run("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
          ]);

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const cases = await client.query<{ case_name: string }>(
              `select case_name
               from wayfinder_rehearsal.fixture_cases
               order by case_name`,
            );
            expect(cases.rows.map((row) => row.case_name)).toEqual([
              "binding-module-identity-mismatch",
              "driver-schema-root",
              "formal-platform-driver-definition",
              "formal-platform-node-type-definition",
              "inactive-definition-binding",
              "legacy-twin-r6-r8",
              "organization-manual-node-type-draft",
              "organization-registration-placement",
              "pinned-binding-revision",
              "platform-subjectless-dts-draft",
            ]);

            const graph = await client.query<{
              formal_definitions: string;
              formal_driver_definitions: string;
              formal_node_definitions: string;
              subjectless_drafts: string;
              organization_drafts: string;
              driver_schema_roots: string;
              registrations: string;
              placements: string;
              modules: string;
              module_mappings: string;
              bindings: string;
              revisions: string;
              module_mismatches: string;
              inactive_definition_bindings: string;
            }>(`
              select
                (select count(*)::text
                 from parameter_specs ps
                 join dts_property_specs dps on dps.parameter_spec_id = ps.id
                 where ps.source_kind = 'dts'
                   and ps.definition_lifecycle = 'active'
                   and ps.attribution_subject_id is not null
                   and dps.driver_schema_id is not null) as formal_definitions,
                (select count(*)::text
                 from parameter_specs ps
                 join attribution_subjects subject
                   on subject.id = ps.attribution_subject_id
                 join driver_registrations registration
                   on registration.attribution_subject_id = subject.id
                 join dts_property_specs dps on dps.parameter_spec_id = ps.id
                 where ps.organization_id is null
                   and ps.definition_lifecycle = 'active'
                   and subject.subject_kind = 'driver-registration'
                   and dps.driver_schema_id is not null)
                  as formal_driver_definitions,
                (select count(*)::text
                 from parameter_specs ps
                 join attribution_subjects subject
                   on subject.id = ps.attribution_subject_id
                 join node_type_definitions node_type
                   on node_type.attribution_subject_id = subject.id
                 join dts_property_specs dps on dps.parameter_spec_id = ps.id
                 where ps.organization_id is null
                   and ps.definition_lifecycle = 'active'
                   and subject.subject_kind = 'node-type-definition'
                   and dps.driver_schema_id is not null)
                  as formal_node_definitions,
                (select count(*)::text
                 from parameter_specs ps
                 join dts_property_specs dps on dps.parameter_spec_id = ps.id
                 where ps.source_kind = 'dts'
                   and ps.definition_lifecycle = 'draft'
                   and ps.organization_id is null
                   and ps.attribution_subject_id is null
                   and dps.driver_schema_id is null) as subjectless_drafts,
                (select count(*)::text
                 from parameter_specs ps
                 join attribution_subjects subject
                   on subject.id = ps.attribution_subject_id
                 join node_type_definitions node_type
                   on node_type.attribution_subject_id = subject.id
                 join dts_property_specs dps on dps.parameter_spec_id = ps.id
                 where ps.source_kind = 'manual'
                   and ps.definition_lifecycle = 'draft'
                   and ps.organization_id is not null
                   and subject.organization_id = ps.organization_id
                   and dps.driver_schema_id is null) as organization_drafts,
                (select count(*)::text
                 from driver_schemas ds
                 join parameter_specs ps on ps.id = ds.parameter_spec_id
                 where ps.property_key is null) as driver_schema_roots,
                (select count(*)::text from driver_registrations) as registrations,
                (select count(*)::text from driver_registration_placements) as placements,
                (select count(*)::text from parameter_modules) as modules,
                (select count(*)::text from parameter_module_mappings)
                  as module_mappings,
                (select count(*)::text from project_parameter_bindings) as bindings,
                (select count(*)::text from project_parameter_binding_revisions) as revisions,
                (select count(*)::text
                 from project_parameter_bindings ppb
                 join parameter_specs ps on ps.id = ppb.parameter_spec_id
                 join parameter_modules pm on pm.id = ppb.module_id
                 where pm.attribution_subject_id is distinct from ps.attribution_subject_id)
                  as module_mismatches,
                (select count(*)::text
                 from project_parameter_bindings ppb
                 join parameter_specs ps on ps.id = ppb.parameter_spec_id
                 where ps.definition_lifecycle <> 'active')
                  as inactive_definition_bindings
            `);
            expect(graph.rows[0]).toEqual({
              formal_definitions: "2",
              formal_driver_definitions: "1",
              formal_node_definitions: "1",
              subjectless_drafts: "1",
              organization_drafts: "1",
              driver_schema_roots: "2",
              registrations: "1",
              placements: "1",
              modules: "3",
              module_mappings: "2",
              bindings: "3",
              revisions: "3",
              module_mismatches: "1",
              inactive_definition_bindings: "1",
            });

            const migrationLedger = await client.query<{
              applied_migrations: string;
              required_0128_rows: string;
            }>(`
              select
                count(*)::text as applied_migrations,
                count(*) filter (
                  where name = '0128_repair_driver_placement_subject_cutover.sql'
                )::text as required_0128_rows
              from schema_migrations
            `);
            expect(migrationLedger.rows[0]).toEqual({
              applied_migrations: "126",
              required_0128_rows: "1",
            });
            const restoredDb = createDatabase({
              query: async (text, values = []) => {
                const result = await client.query(text, values);
                return { rows: result.rows, rowCount: result.rowCount };
              },
            });
            await expect(
              applyMigrations(restoredDb, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              }),
            ).resolves.toEqual([]);

          } finally {
            await client.end();
          }

        } finally {
          await withAdminClient(async (admin) => {
            await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "rejects an artifact directory containing a file outside the closed manifest",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-unknown-file-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        try {
          await withTempDatabase(
            { prefix: "wayfinder671_unknown", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          await writeFile(path.join(artifactDir, "unexpected.txt"), "not allowed\n");

          const result = runResult("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            "wiseeff_wayfinder671_restore_unknown_file",
            ...(await createTrustedArchiveArgs(artifactDir, tempRoot, true)),
          ]);
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("Unknown artifact entry: unexpected.txt");
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "requires one safe checksum entry for every required artifact file",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-checksums-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const invoke = async (directory: string) =>
          runResult("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            "wiseeff_wayfinder671_restore_checksum_validation",
            ...(await createTrustedArchiveArgs(directory, tempRoot, true)),
          ]);

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_checksums", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );

          const checksumText = await readFile(
            path.join(artifactDir, "SHA256SUMS"),
            "utf8",
          );
          const checksumLines = checksumText.trimEnd().split("\n");

          const missingFileDir = path.join(tempRoot, "missing-file");
          await cp(artifactDir, missingFileDir, { recursive: true });
          await rm(path.join(missingFileDir, "manifest.csv"));
          expect((await invoke(missingFileDir)).stderr).toContain(
            "Required artifact file is missing: manifest.csv",
          );

          const missingChecksumDir = path.join(tempRoot, "missing-checksum");
          await cp(artifactDir, missingChecksumDir, { recursive: true });
          await writeFile(
            path.join(missingChecksumDir, "SHA256SUMS"),
            `${checksumLines.filter((line) => !line.endsWith("  schema.sql")).join("\n")}\n`,
          );
          expect((await invoke(missingChecksumDir)).stderr).toContain(
            "Checksum entry is missing: schema.sql",
          );

          const duplicateDir = path.join(tempRoot, "duplicate-checksum");
          await cp(artifactDir, duplicateDir, { recursive: true });
          await writeFile(
            path.join(duplicateDir, "SHA256SUMS"),
            `${checksumText}${checksumLines[0]}\n`,
          );
          expect((await invoke(duplicateDir)).stderr).toContain(
            `Duplicate checksum entry: ${checksumLines[0]?.split("  ")[1]}`,
          );

          const traversalDir = path.join(tempRoot, "traversal-checksum");
          await cp(artifactDir, traversalDir, { recursive: true });
          await writeFile(
            path.join(traversalDir, "SHA256SUMS"),
            `${checksumText}${"0".repeat(64)}  ../escape.sql\n`,
          );
          expect((await invoke(traversalDir)).stderr).toContain(
            "Unsafe or malformed SHA256SUMS entry",
          );
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "rejects a target with user-defined objects even when it has no tables",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-nonempty-target-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const restoreDatabase = `wiseeff_wayfinder671_restore_nonempty_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_nonempty", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );

          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            await client.query("create schema wf671_preexisting");
            await client.query(`
              create function public.wf671_preexisting_function()
              returns integer
              language sql
              immutable
              as 'select 1'
            `);
          } finally {
            await client.end();
          }

          const result = runResult("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
          ]);
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain(
            "Target database contains user-defined objects; refusing to overwrite or merge.",
          );
        } finally {
          await withAdminClient(async (admin) => {
            await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "rejects every checked-empty external object class before import",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-external-target-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const fixtures = [
          [
            "standalone_fdw",
            ["create foreign data wrapper wf671_external_fdw no handler"],
          ],
          [
            "foreign_server",
            [
              "create foreign data wrapper wf671_external_fdw no handler",
              "create server wf671_external_server foreign data wrapper wf671_external_fdw",
            ],
          ],
          [
            "user_mapping",
            [
              "create foreign data wrapper wf671_external_fdw no handler",
              "create server wf671_external_server foreign data wrapper wf671_external_fdw",
              "create user mapping for current_user server wf671_external_server",
            ],
          ],
          [
            "subscription",
            [[
              "create subscription wf671_external_subscription",
              "connection 'host=127.0.0.1 port=1 dbname=postgres user=wiseeff'",
              "publication wf671_absent_publication",
              "with (connect = false, create_slot = false, enabled = false)",
            ].join(" ")],
          ],
        ] as const;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_external_target_source", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );

          for (const [fixtureName, statements] of fixtures) {
            const restoreDatabase = `wiseeff_wayfinder671_restore_external_${fixtureName}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
            await withAdminClient(async (admin) => {
              await admin.query(`create database ${restoreDatabase}`);
            });
            const client = new pg.Client({
              connectionString: adminConnectionString(restoreDatabase),
            });
            try {
              await client.connect();
              for (const statement of statements) await client.query(statement);

              const result = runResult("bash", [
                importer,
                "--container",
                containerName,
                "--database",
                restoreDatabase,
                ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
              ]);
              expect(result.status, fixtureName).not.toBe(0);
              expect(result.stderr).toContain(
                "Target database contains user-defined objects; refusing to overwrite or merge.",
              );
              const state = await client.query<{ objects: string }>(`
                select (
                  (select count(*) from pg_subscription where subdbid = (select oid from pg_database where datname = current_database()))
                  + (select count(*) from pg_foreign_data_wrapper)
                  + (select count(*) from pg_foreign_server)
                  + (select count(*) from pg_user_mapping)
                )::text as objects
              `);
              expect(Number(state.rows[0]?.objects), fixtureName).toBeGreaterThan(0);
            } finally {
              if (fixtureName === "subscription") {
                await client.query("alter subscription wf671_external_subscription disable")
                  .catch(() => undefined);
                await client.query(
                  "alter subscription wf671_external_subscription set (slot_name = NONE)",
                ).catch(() => undefined);
                await client.query("drop subscription if exists wf671_external_subscription")
                  .catch(() => undefined);
              }
              await client.end().catch(() => undefined);
              await withAdminClient(async (admin) => {
                await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
              });
            }
          }
        } finally {
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      120_000,
    );

    it(
      "rolls back every imported object when a late fixture step fails",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-import-rollback-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const restoreDatabase = `wiseeff_wayfinder671_restore_import_rollback_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_import_rollback", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          const syntheticFixturePath = path.join(artifactDir, "synthetic-fixture.sql");
          await chmod(syntheticFixturePath, 0o600);
          await writeFile(
            syntheticFixturePath,
            `${await readFile(path.join(artifactDir, "synthetic-fixture.sql"), "utf8")}\nselect 1 / 0;\n`,
          );
          await refreshArtifactChecksums(artifactDir);
          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });

          const result = runResult("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
          ]);
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("IMPORT_FAILED");
          expect(result.stderr.match(/^CLEANUP_OK$/gm)).toHaveLength(1);

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const state = await client.query<{ objects: string }>(`
              with user_namespaces as (
                select oid
                from pg_namespace
                where nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
                  and nspname !~ '^pg_(temp|toast_temp)_'
              )
              select (
                (select count(*) from pg_namespace
                 where oid in (select oid from user_namespaces)
                   and nspname <> 'public')
                +
                (select count(*) from pg_class
                 where relnamespace in (select oid from user_namespaces))
                +
                (select count(*) from pg_proc
                 where pronamespace in (select oid from user_namespaces))
              )::text as objects
            `);
            expect(state.rows).toEqual([{ objects: "0" }]);
          } finally {
            await client.end();
          }
        } finally {
          await withAdminClient(async (admin) => {
            await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "restores checked-empty when owned local cleanup fails after import validation",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-import-cleanup-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const fakeBin = path.join(tempRoot, "bin");
        const fakePython = path.join(fakeBin, "python3");
        const realPython = runResult("which", ["python3"]).stdout.trim();
        const restoreDatabase = `wiseeff_wayfinder671_restore_import_cleanup_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_import_cleanup", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          await mkdir(fakeBin);
          await writeFile(
            fakePython,
            [
              "#!/usr/bin/env bash",
              "set -euo pipefail",
              'probe="$(mktemp)"',
              'command cat > "${probe}"',
              'if grep -q "os.rmdir" "${probe}"; then exit 73; fi',
              `exec ${JSON.stringify(realPython)} "$@" < "\${probe}"`,
              "",
            ].join("\n"),
          );
          await chmod(fakePython, 0o755);

          const result = spawnSync(
            "bash",
            [
              importer,
              "--container",
              containerName,
              "--database",
              restoreDatabase,
              ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
            ],
            {
              cwd: projectRoot,
              encoding: "utf8",
              maxBuffer: 10 * 1024 * 1024,
              env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, TMPDIR: tempRoot },
            },
          );
          expect(result.status).not.toBe(0);
          expect(result.stderr).toContain("CLEANUP_FAILED");

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const state = await client.query<{ objects: string }>(`
              with user_namespaces as (
                select oid from pg_namespace
                where nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'public')
                  and nspname !~ '^pg_(temp|toast_temp)_'
              )
              select (
                (select count(*) from user_namespaces)
                + (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public')
                + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')
                + (select count(*) from pg_extension where extname <> 'plpgsql')
                + (select count(*) from pg_foreign_server)
                + (select count(*) from pg_publication)
              )::text as objects
            `);
            expect(state.rows).toEqual([{ objects: "0" }]);
          } finally {
            await client.end();
          }
        } finally {
          await withAdminClient(async (admin) => {
            await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
          });
          for (const entry of await readdir(tempRoot)) {
            if (entry.startsWith("wiseeff-wayfinder671-import-")) {
              await chmod(path.join(tempRoot, entry), 0o700).catch(() => undefined);
            }
          }
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "runs candidate SQL plus validation and proves a full database rollback",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-rollback-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const candidateFile = path.join(tempRoot, "candidate.sql");
        const validationFile = path.join(tempRoot, "validation.sql");
        const restoreDatabase = `wiseeff_wayfinder671_restore_rollback_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_rollback", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          run("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
          ]);

          await writeFile(
            candidateFile,
            `
              create schema wf671_candidate_replacement;
              create table wf671_candidate_replacement.definition_map as
              select id, attribution_subject_id, property_key, definition_lifecycle
              from parameter_specs;
            `,
          );
          await writeFile(
            validationFile,
            `
              select 1 / case when (
                select count(*)
                from wf671_candidate_replacement.definition_map
              ) = 6 then 1 else 0 end;
            `,
          );

          const result = run("bash", [
            rehearser,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ]);
          expect(result.stdout).toContain("REHEARSAL_ROLLBACK_OK");
          expect(result.stdout.match(/^FIXTURE_VERIFY_BEFORE_OK$/gm)).toHaveLength(1);
          expect(
            result.stdout.match(/^FIXTURE_VERIFY_AFTER_CANDIDATE_OK$/gm),
          ).toHaveLength(1);
          expect(
            result.stdout.match(/^FIXTURE_VERIFY_AFTER_ROLLBACK_OK$/gm),
          ).toHaveLength(1);
          expect(result.stdout.match(/^CLEANUP_OK$/gm)).toHaveLength(1);
          expect(result.stdout).toMatch(/before_sha256=[0-9a-f]{64}/);
          expect(result.stdout).toMatch(/after_sha256=[0-9a-f]{64}/);

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const rollbackState = await client.query<{
              candidate_schema: string | null;
              mismatch_module: string;
            }>(`
              select
                to_regnamespace('wf671_candidate_replacement')::text
                  as candidate_schema,
                (select module_id
                 from project_parameter_bindings
                 where id = 'wf671-mismatch-binding') as mismatch_module
            `);
            expect(rollbackState.rows[0]).toEqual({
              candidate_schema: null,
              mismatch_module: "wf671-org-node-module",
            });
          } finally {
            await client.end();
          }

          await writeFile(
            candidateFile,
            "delete from wayfinder_rehearsal.fixture_cases where case_name = 'legacy-twin-r6-r8';\n",
          );
          const incompleteGraphResult = runResult("bash", [
            rehearser,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ]);
          expect(incompleteGraphResult.status).not.toBe(0);
          expect(incompleteGraphResult.stderr).toContain(
            "Candidate migration, validation, or fixture verification failed.",
          );

          const rollbackClient = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await rollbackClient.connect();
          try {
            const casesAfterRejectedCandidate = await rollbackClient.query<{
              count: string;
            }>("select count(*)::text from wayfinder_rehearsal.fixture_cases");
            expect(casesAfterRejectedCandidate.rows).toEqual([{ count: "10" }]);
          } finally {
            await rollbackClient.end();
          }

          await writeFile(candidateFile, "select 1; commit;\n");
          const unsafeResult = runResult("bash", [
            rehearser,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ]);
          expect(unsafeResult.status).not.toBe(0);
          expect(unsafeResult.stderr).toContain(
            "SQL input contains a forbidden transaction, session, or psql control",
          );
        } finally {
          await withAdminClient(async (admin) => {
            await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );

    it(
      "keeps the same-key R6 staging row and R8 proposal distinct during migration rehearsal",
      async () => {
        const tempRoot = await mkdtemp(
          path.join(os.tmpdir(), "wiseeff-wayfinder671-legacy-twin-"),
        );
        const artifactDir = path.join(tempRoot, "artifact");
        const candidateFile = path.join(tempRoot, "candidate.sql");
        const validationFile = path.join(tempRoot, "validation.sql");
        const restoreDatabase = `wiseeff_wayfinder671_restore_legacy_twin_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

        try {
          await withTempDatabase(
            { prefix: "wayfinder671_legacy_twin", migrate: false },
            async ({ db, connectionString }) => {
              await applyMigrations(db, migrationsDir, {
                through: "0128_repair_driver_placement_subject_cutover.sql",
              });
              run("bash", [
                exporter,
                "--container",
                containerName,
                "--database",
                databaseName(connectionString),
                "--fixture-mode",
                "populated",
                "--output-dir",
                artifactDir,
              ]);
            },
          );
          await withAdminClient(async (admin) => {
            await admin.query(`create database ${restoreDatabase}`);
          });
          run("bash", [
            importer,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            ...(await createTrustedArchiveArgs(artifactDir, tempRoot)),
          ]);

          const client = new pg.Client({
            connectionString: adminConnectionString(restoreDatabase),
          });
          await client.connect();
          try {
            const fixtureCase = await client.query<{
              expected_rows: string;
            }>(`
              select expected_rows::text
              from wayfinder_rehearsal.fixture_cases
              where case_name = 'legacy-twin-r6-r8'
            `);
            expect(fixtureCase.rows).toEqual([{ expected_rows: "2" }]);

            const twin = await client.query<{
              id: string;
              source_kind: string;
              organization_id: string | null;
              attribution_subject_id: string | null;
              driver_schema_id: string | null;
              binding_count: string;
              property_key: string;
            }>(`
              select
                ps.id,
                ps.source_kind,
                ps.organization_id,
                ps.attribution_subject_id,
                dps.driver_schema_id,
                count(binding.id)::text as binding_count,
                ps.property_key
              from parameter_specs ps
              join dts_property_specs dps on dps.parameter_spec_id = ps.id
              left join project_parameter_bindings binding
                on binding.parameter_spec_id = ps.id
              where ps.property_key = 'synthetic.legacy-twin'
              group by ps.id, dps.driver_schema_id
              order by ps.id
            `);
            expect(twin.rows).toEqual([
              {
                id: "wf671-org-manual-node-draft",
                source_kind: "manual",
                organization_id: "wf671-org",
                attribution_subject_id: "wf671-org-node-subject",
                driver_schema_id: null,
                binding_count: "1",
                property_key: "synthetic.legacy-twin",
              },
              {
                id: "wf671-platform-subjectless-draft",
                source_kind: "dts",
                organization_id: null,
                attribution_subject_id: null,
                driver_schema_id: null,
                binding_count: "0",
                property_key: "synthetic.legacy-twin",
              },
            ]);
          } finally {
            await client.end();
          }

          await writeFile(
            validationFile,
            `
              select 1 / case when (
                select count(*)
                from parameter_specs
                where property_key = 'synthetic.legacy-twin'
              ) = 2 then 1 else 0 end;

              select 1 / case when (
                select count(*)
                from parameter_specs ps
                join dts_property_specs dps on dps.parameter_spec_id = ps.id
                where ps.id = 'wf671-platform-subjectless-draft'
                  and ps.property_key = 'synthetic.legacy-twin'
                  and ps.source_kind = 'dts'
                  and ps.organization_id is null
                  and ps.attribution_subject_id is null
                  and ps.definition_lifecycle = 'draft'
                  and dps.property_key = ps.property_key
                  and dps.driver_schema_id is null
                  and not exists (
                    select 1 from project_parameter_bindings binding
                    where binding.parameter_spec_id = ps.id
                  )
              ) = 1 then 1 else 0 end;

              select 1 / case when (
                select count(*)
                from parameter_specs ps
                join dts_property_specs dps on dps.parameter_spec_id = ps.id
                join attribution_subjects subject on subject.id = ps.attribution_subject_id
                join node_type_definitions node_type
                  on node_type.attribution_subject_id = subject.id
                where ps.id = 'wf671-org-manual-node-draft'
                  and ps.property_key = 'synthetic.legacy-twin'
                  and ps.source_kind = 'manual'
                  and ps.organization_id = 'wf671-org'
                  and ps.definition_lifecycle = 'draft'
                  and subject.organization_id = ps.organization_id
                  and subject.subject_kind = 'node-type-definition'
                  and dps.property_key = ps.property_key
                  and dps.driver_schema_id is null
                  and exists (
                    select 1 from project_parameter_bindings binding
                    where binding.parameter_spec_id = ps.id
                      and binding.module_id = 'wf671-org-node-module'
                  )
              ) = 1 then 1 else 0 end;

              select 1 / case when (
                select count(*)
                from wf671_candidate_replacement.legacy_twin_dispositions
              ) = 2 then 1 else 0 end;

              select 1 / case when (
                  select count(distinct legacy_id)
                  from wf671_candidate_replacement.legacy_twin_dispositions
                ) = 2 and not exists (
                  select legacy_id
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  group by legacy_id
                  having count(*) <> 1
                ) then 1 else 0 end;

              select 1 / case when not exists (
                  select 1
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  where (legacy_id = 'wf671-platform-subjectless-draft'
                         and legacy_class <> 'R6')
                     or (legacy_id = 'wf671-org-manual-node-draft'
                         and legacy_class <> 'R8')
                     or legacy_id not in (
                          'wf671-platform-subjectless-draft',
                          'wf671-org-manual-node-draft'
                        )
                ) then 1 else 0 end;

              select 1 / case when not exists (
                  select 1
                  from wf671_candidate_replacement.legacy_twin_dispositions candidate
                  join parameter_specs source on source.id = candidate.legacy_id
                  where candidate.property_key <> 'synthetic.legacy-twin'
                     or candidate.source_attribution_subject_id
                        is distinct from source.attribution_subject_id
                ) then 1 else 0 end;

              select 1 / case when not exists (
                  select 1
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  where target_formal_subject_id is not null
                ) then 1 else 0 end;

              select 1 / case when not exists (
                  select 1
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  where (legacy_class = 'R6' and destination_kind not in (
                           'Observation', 'ReviewEvidence', 'Archive'
                         ))
                     or (legacy_class = 'R8' and destination_kind not in (
                           'Proposal', 'Observation', 'Archive'
                         ))
                     or legacy_class not in ('R6', 'R8')
                ) then 1 else 0 end;

              select 1 / case when not exists (
                  select 1
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  where destination_kind = 'Definition'
                     or is_current_definition
                ) then 1 else 0 end;

              select 1 / case when not exists (
                  select destination_identity
                  from wf671_candidate_replacement.legacy_twin_dispositions
                  group by destination_identity
                  having count(*) > 1
                ) then 1 else 0 end;
            `,
          );

          await writeFile(
            candidateFile,
            `
              create schema wf671_candidate_replacement;
              create table wf671_candidate_replacement.legacy_twin_dispositions as
              select
                min(id) as legacy_id,
                'merged-by-property-key'::text as legacy_class,
                property_key,
                'Definition'::text as destination_kind,
                property_key as destination_identity,
                min(attribution_subject_id) as source_attribution_subject_id,
                max(attribution_subject_id) as target_formal_subject_id,
                true as is_current_definition
              from parameter_specs
              where property_key = 'synthetic.legacy-twin'
              group by property_key;
            `,
          );
          const mergedResult = runResult("bash", [
            rehearser,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ]);
          expect(mergedResult.status).not.toBe(0);
          expect(mergedResult.stderr).toContain(
            "Candidate migration, validation, or fixture verification failed.",
          );

          await writeFile(
            candidateFile,
            `
              create schema wf671_candidate_replacement;
              create table wf671_candidate_replacement.legacy_twin_dispositions as
              select
                id as legacy_id,
                case id
                  when 'wf671-platform-subjectless-draft' then 'R6'
                  when 'wf671-org-manual-node-draft' then 'R8'
                end as legacy_class,
                property_key,
                case id
                  when 'wf671-platform-subjectless-draft' then 'Observation'
                  when 'wf671-org-manual-node-draft' then 'Proposal'
                end as destination_kind,
                case id
                  when 'wf671-platform-subjectless-draft' then 'wf671-observation-r6'
                  when 'wf671-org-manual-node-draft' then 'wf671-proposal-r8'
                end as destination_identity,
                attribution_subject_id as source_attribution_subject_id,
                null::text as target_formal_subject_id,
                false as is_current_definition
              from parameter_specs
              where property_key = 'synthetic.legacy-twin';
            `,
          );
          const acceptedResult = run("bash", [
            rehearser,
            "--container",
            containerName,
            "--database",
            restoreDatabase,
            "--migration-file",
            candidateFile,
            "--validation-file",
            validationFile,
          ]);
          expect(acceptedResult.stdout).toContain("REHEARSAL_ROLLBACK_OK");
        } finally {
          await withAdminClient(async (admin) => {
            await admin.query(`drop database if exists ${restoreDatabase} with (force)`);
          });
          await rm(tempRoot, { recursive: true, force: true });
        }
      },
      60_000,
    );
  },
);
