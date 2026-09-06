import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DISPOSITION_BY_R_CLASS, R_CLASSES } from "../classifier/index";
import { decryptArchiveObject, encryptArchiveObject } from "./crypto";
import { THREAT_MATRIX } from "./threatMatrix";
import { createArchiveAdapter } from "./adapter";
import type { ArchiveAdapterOptions, PersistArchiveCommand } from "./types";

const archiveDir = path.dirname(fileURLToPath(import.meta.url));

const productionSources = (): readonly { name: string; text: string }[] =>
  readdirSync(archiveDir)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .map((name) => ({
      name,
      text: readFileSync(path.join(archiveDir, name), "utf8"),
    }));

const PLAINTEXT_TOKEN = "S7ARC-PLAINTEXT-SOURCE-v1-DO-NOT-PERSIST-IN-OBJECT-OR-METADATA";

describe("S7-ARC threat matrix", () => {
  it("freezes the eight R3 rows before production behavior is accepted", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "archived-disposition-success",
      "plaintext-public-leak",
      "partial-commit-crash",
      "restore-checksum-mismatch",
      "unauthorized-restore",
      "truncated-object",
      "replay-identity-run-checksum",
      "mapping-not-imported",
    ]);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
  });

  it("uses classifier production dispositions to know which R classes are archived", () => {
    const archived = R_CLASSES.filter(
      (rClass) => DISPOSITION_BY_R_CLASS[rClass] === "archived",
    );
    expect(archived).toEqual(["R1", "R7", "R10"]);
    expect(DISPOSITION_BY_R_CLASS.R0).toBe("blocked");
    expect(DISPOSITION_BY_R_CLASS.R6).toBe("review-evidence");
  });
});

describe("encrypted archive object", () => {
  it("round-trips plaintext and never stores the source token in the envelope", () => {
    const key = randomBytes(32);
    const aad = Buffer.from("s7-arc-aad-binding", "utf8");
    const plaintext = Buffer.from(
      JSON.stringify({ token: PLAINTEXT_TOKEN, body: "legacy-source-row" }),
      "utf8",
    );
    const envelope = encryptArchiveObject({ key, aad, plaintext });
    expect(envelope.includes(PLAINTEXT_TOKEN)).toBe(false);
    expect(envelope.toString("utf8")).not.toContain(PLAINTEXT_TOKEN);
    expect(decryptArchiveObject({ key, aad, envelope }).equals(plaintext)).toBe(true);
  });

  it("fails closed on a truncated envelope", () => {
    const key = randomBytes(32);
    const aad = Buffer.from("s7-arc-aad-binding", "utf8");
    const plaintext = Buffer.from(PLAINTEXT_TOKEN, "utf8");
    const envelope = encryptArchiveObject({ key, aad, plaintext });
    expect(() =>
      decryptArchiveObject({
        key,
        aad,
        envelope: envelope.subarray(0, 8),
      }),
    ).toThrow(/truncated|integrity/i);
  });
});

describe("operational evidence keeps the primary disposition", () => {
  const forbiddenIo = async (): Promise<never> => { throw new Error("unexpected I/O"); };
  const adapter = () => createArchiveAdapter({
    client: { query: forbiddenIo }, encryptionKey: randomBytes(32),
    objectStore: { putExclusive: forbiddenIo, get: forbiddenIo, remove: forbiddenIo, exists: forbiddenIo, listRefs: forbiddenIo },
  } satisfies ArchiveAdapterOptions);
  const command = (rClass: PersistArchiveCommand["rClass"]): PersistArchiveCommand => ({
    actor: { role: "cutover-operator", auditRef: "synthetic-audit" },
    legacyIdentityId: "legacy-source", ownerScopeKind: "platform", ownerScopeId: "platform",
    rClass, reason: "source-evidence", sourceGraph: { sourcePayload: {}, relationGraph: {} },
    protectedReferences: [], cutoverRunId: "synthetic-run", catalogReleaseId: "synthetic-release",
    successAuditRef: "synthetic-audit", retainUntil: new Date("2030-01-01"),
  });
  it("ordinary Archive still rejects mapped R9 before any I/O", async () => {
    expect(await adapter().persistArchive(command("R9"))).toMatchObject({ ok:false,error:{code:"PCAT-ARC-DISPOSITION-NOT-ARCHIVED"} });
  });
  it("evidence refuses archived, review and blocked dispositions without I/O", async () => {
    for (const rClass of ["R0","R1","R3","R6","R7","R8","R10"] as const) {
      expect(await adapter().persistEvidenceArchive(command(rClass))).toMatchObject({ ok:false,error:{code:"PCAT-ARC-DISPOSITION-NOT-ARCHIVED"} });
    }
    expect(await adapter().persistEvidenceArchive({ ...command("R9"), actor:{role:"public"} })).toMatchObject({ok:false,error:{code:"PCAT-ARC-PERMISSION-DENIED"}});
  });
});

describe("S7-ARC production source bans", () => {
  it("does not import S7-MAP and does not embed the retired catalog relation token", () => {
    const sources = productionSources();
    expect(sources.length).toBeGreaterThan(0);
    const bannedRelation = ["parameter", "definitions"].join("_");
    for (const source of sources) {
      expect(source.text, source.name).not.toContain("catalog-cutover/mapping");
      expect(source.text, source.name).not.toMatch(
        /from\s+["'](?:\.\.\/)+mapping(?:\/|["'])/u,
      );
      expect(source.text, source.name).not.toContain(bannedRelation);
    }
  });
});
