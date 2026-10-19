import { afterEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import * as domains from "./domainsRepository";
import * as workerDecoding from "./parsing/workerDecoding";
import { previewLogSkillParsing, previewLogSkillExtractor, previewLogSkillFormat, PARSE_PREVIEW_MAX_MS } from "./skillsService";
import { parsePreviewResponseSchema, parsingSpecSchema } from "./parsing/spec";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const auth = makeTestAuthContext({ organizationId: "org-preview", permissions: ["logs:admin-domains"] });
const parsing = { schemaVersion: "parsing/v1", extractors: [{ id: "value", pattern: "(?P<v>.+)", fields: { v: { type: "string" } } }] };
const db: Queryable = { query: vi.fn(() => { throw new Error("Unexpected database access"); }) };
function skill() {
  return vi.spyOn(domains, "getLogDomainById").mockResolvedValue({ id: "skill", name: "Preview", status: "active", webhook: { enabled: false, secretConfigured: false }, createdAt: "2026-10-19", updatedAt: "2026-10-19" });
}

describe("parsing preview service bounds", () => {
  it("requires admin permission and an organization-owned skill for authoring previews", async () => {
    const input = { line: "n=1", segments: [{ start: 2, end: 3, name: "n", type: "uint" as const }], sampleLines: ["n=2", "x=2"] };
    const lookup = skill();
    expect(await previewLogSkillExtractor(db, auth, "skill", input)).toMatchObject({ matchCount: 1, coverage: 0.5 });
    expect(lookup).toHaveBeenCalledWith(db, { organizationId: auth.organization.id, domainId: "skill" });
    const viewer = makeTestAuthContext({ organizationId: "org-preview", permissions: ["logs:view"] });
    await expect(previewLogSkillExtractor(db, viewer, "skill", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(previewLogSkillFormat(db, viewer, "skill", { sampleText: "n=1", formatProfile: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
    lookup.mockResolvedValue(null);
    await expect(previewLogSkillExtractor(db, auth, "foreign", input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(previewLogSkillFormat(db, auth, "foreign", { sampleText: "n=1", formatProfile: {} })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("surfaces invalid RE2 and format schema failures as validation errors", async () => {
    skill();
    await expect(previewLogSkillExtractor(db, auth, "skill", { line: "", segments: [], pattern: "(?=x)", sampleLines: [] })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(previewLogSkillFormat(db, auth, "skill", { sampleText: "x", formatProfile: { timestampPattern: "(?=x)" } })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
  it("keeps preview limits independent of worker environment settings", async () => {
    skill();
    vi.stubEnv("LOG_DECODE_MAX_MS", "1");
    vi.stubEnv("LOG_DECODE_MAX_EVENTS", "1");
    const result = await previewLogSkillParsing(db, auth, "skill", { parsing, sampleText: "one\ntwo" });
    expect(result).toMatchObject({ valid: true, truncated: false, counts: { total: 2, errors: {} } });
    expect(result.events).toHaveLength(2);
  });
  it("hard-stops slow validation before it can block for its full runtime", async () => {
    skill();
    const parse = parsingSpecSchema.safeParse.bind(parsingSpecSchema);
    vi.spyOn(parsingSpecSchema, "safeParse").mockImplementationOnce((input) => {
      const end = performance.now() + 400;
      while (performance.now() < end) { /* simulate expensive pattern compilation */ }
      return parse(input);
    });
    const started = performance.now();
    const result = await previewLogSkillParsing(db, auth, "skill", { parsing, sampleText: "value" });
    expect(performance.now() - started).toBeLessThan(350);
    expect(result).toMatchObject({ valid: false, truncated: true, reason: "time_cap", events: [], counts: { errors: { time_cap: 1 } } });
  });
  it("validates dangerous patterns with extractor paths before executing them", async () => {
    skill();
    for (const pattern of ["(?P<v>(?:a|b)*a(?:a|b){1000})$", `(?P<v>${"a".repeat(513)})`]) {
      const result = await previewLogSkillParsing(db, auth, "skill", { parsing: { ...parsing, extractors: [{ ...parsing.extractors[0], pattern }] }, sampleText: "a".repeat(8192) });
      expect(result).toMatchObject({ valid: false, truncated: false, events: [], issues: expect.arrayContaining([expect.objectContaining({ path: ["extractors", 0, "pattern"] })]) });
      expect(result.issues[0].message).toMatch(/100|512/);
    }
  });
  it("returns partial line-capped results and keeps the complete sample's unmatched count", async () => {
    const lookup = skill();
    const decode = workerDecoding.decodeLogFilesCooperatively;
    vi.spyOn(workerDecoding, "decodeLogFilesCooperatively").mockImplementationOnce((spec, files, options) =>
      decode(spec, files, { ...options, maxMs: PARSE_PREVIEW_MAX_MS, now: () => 0, hardTimeout: false }));
    const result = await previewLogSkillParsing(db, auth, "skill", { parsing: { schemaVersion: "parsing/v1", extractors: [] }, sampleText: "x\n".repeat(5000) });
    expect(parsePreviewResponseSchema.parse(result)).toMatchObject({ valid: true, truncated: true, reason: "line_cap", unmatchedLineCount: 5001 });
    expect(lookup).toHaveBeenCalledWith(db, { organizationId: auth.organization.id, domainId: "skill" });
  });
  it("stops preview at its independent time budget, returns a flag, and ignores worker env limits", async () => {
    skill();
    let time = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time++);
    const result = await previewLogSkillParsing(db, auth, "skill", { parsing, sampleText: "x\n".repeat(1000) });
    expect(result).toMatchObject({ valid: true, truncated: true, reason: "time_cap", counts: { errors: { time_cap: 1 } } });
    expect(result.counts.total).toBeLessThan(1000);
  });
});
