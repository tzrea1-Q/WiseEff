import { describe, expect, it } from "vitest";

import { parseLogText } from "../../parser";
import { runLogPrefilter } from "../../prefilter";
import { executeLogAnalysisTool, LOG_ANALYSIS_TOOL_NAMES } from "./toolCatalog";
import type { LogAnalysisToolContext } from "./toolContext";

function buildContext(overrides: Partial<LogAnalysisToolContext> = {}): LogAnalysisToolContext {
  const content = [
    "2026-08-10T08:00:01Z INFO charge session started requested_ma=6000",
    "2026-08-10T08:00:02Z INFO battery_temp=38C pack ok",
    "2026-08-10T08:00:03Z WARN thermal foldback engaged battery_temp=52C",
    "2026-08-10T08:00:04Z ERROR charge current reduced code=E_THERMAL_FOLDBACK requested_ma=6000 charge_current_ma=2000",
    "2026-08-10T08:00:05Z INFO charge continuing at reduced rate",
    "2026-08-10T08:00:06Z INFO session heartbeat ok"
  ].join("\n");
  const parsed = parseLogText({ fileName: "charging.log", content });
  if (!parsed.ok) {
    throw new Error("fixture must parse");
  }
  return {
    parsed,
    prefilter: runLogPrefilter(parsed.entries),
    ...overrides
  };
}

describe("executeLogAnalysisTool dispatch", () => {
  it("rejects unknown tool names with the available catalog", async () => {
    const outcome = await executeLogAnalysisTool("write_parameter", {}, buildContext());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain('Unknown tool "write_parameter"');
      for (const name of LOG_ANALYSIS_TOOL_NAMES) {
        expect(outcome.error).toContain(name);
      }
    }
  });

  it("rejects invalid arguments through the zod schema", async () => {
    const outcome = await executeLogAnalysisTool("search_log_lines", { pattern: "" }, buildContext());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toContain('Invalid arguments for tool "search_log_lines"');
    }
  });
});

describe("search_log_lines", () => {
  it("finds keyword matches case-insensitively with neighborhood context", async () => {
    const outcome = await executeLogAnalysisTool("search_log_lines", { pattern: "THERMAL", neighborhood: 1 }, buildContext());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as {
        totalMatches: number;
        lines: Array<{ lineNumber: number; isMatch: boolean }>;
      };
      expect(result.totalMatches).toBe(2);
      const matchLines = result.lines.filter((line) => line.isMatch).map((line) => line.lineNumber);
      expect(matchLines).toEqual([3, 4]);
      // Neighborhood pulls in lines 2 and 5 as context.
      expect(result.lines.map((line) => line.lineNumber)).toEqual([2, 3, 4, 5]);
    }
  });

  it("supports regex matching and reports invalid regexes as tool errors", async () => {
    const regexOutcome = await executeLogAnalysisTool(
      "search_log_lines",
      { pattern: "code=E_[A-Z_]+", isRegex: true, neighborhood: 0 },
      buildContext()
    );
    expect(regexOutcome.ok).toBe(true);
    if (regexOutcome.ok) {
      const result = regexOutcome.result as { lines: Array<{ lineNumber: number }> };
      expect(result.lines.map((line) => line.lineNumber)).toEqual([4]);
    }

    const invalidOutcome = await executeLogAnalysisTool(
      "search_log_lines",
      { pattern: "([unclosed", isRegex: true },
      buildContext()
    );
    expect(invalidOutcome.ok).toBe(false);
    if (!invalidOutcome.ok) {
      expect(invalidOutcome.error).toContain("Invalid regular expression");
    }
  });

  it("truncates matches at maxMatches and reports the truncation", async () => {
    const outcome = await executeLogAnalysisTool(
      "search_log_lines",
      { pattern: "2026-08-10", maxMatches: 2, neighborhood: 0 },
      buildContext()
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as { totalMatches: number; returnedMatches: number; truncated: boolean };
      expect(result.totalMatches).toBe(6);
      expect(result.returnedMatches).toBe(2);
      expect(result.truncated).toBe(true);
    }
  });

  it("caps maxMatches at the hard limit through the schema", async () => {
    const outcome = await executeLogAnalysisTool("search_log_lines", { pattern: "a", maxMatches: 100 }, buildContext());
    expect(outcome.ok).toBe(false);
  });
});

describe("read_line_range", () => {
  it("reads a clamped range and rejects inverted or out-of-file ranges", async () => {
    const context = buildContext();
    const outcome = await executeLogAnalysisTool("read_line_range", { startLine: 3, endLine: 99 }, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as { endLine: number; totalLines: number; lines: Array<{ lineNumber: number }> };
      expect(result.endLine).toBe(6);
      expect(result.lines.map((line) => line.lineNumber)).toEqual([3, 4, 5, 6]);
    }

    const inverted = await executeLogAnalysisTool("read_line_range", { startLine: 5, endLine: 3 }, context);
    expect(inverted.ok).toBe(false);

    const beyond = await executeLogAnalysisTool("read_line_range", { startLine: 100, endLine: 120 }, context);
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) {
      expect(beyond.error).toContain("beyond the end of the log");
    }
  });

  it("truncates ranges longer than 40 lines and flags it", async () => {
    const content = Array.from({ length: 100 }, (_, index) => `2026-08-10T08:00:01Z INFO line ${index + 1}`).join("\n");
    const parsed = parseLogText({ fileName: "long.log", content });
    if (!parsed.ok) throw new Error("fixture must parse");
    const context = buildContext({ parsed });

    const outcome = await executeLogAnalysisTool("read_line_range", { startLine: 1, endLine: 100 }, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as { endLine: number; truncated: boolean; lines: unknown[] };
      expect(result.lines).toHaveLength(40);
      expect(result.endLine).toBe(40);
      expect(result.truncated).toBe(true);
    }
  });
});

describe("get_prefilter_findings", () => {
  it("returns the deterministic prefilter signals and rejects stray arguments", async () => {
    const outcome = await executeLogAnalysisTool("get_prefilter_findings", {}, buildContext());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as {
        ruleHits: string[];
        errorCodeStats: Array<{ code: string }>;
        severityCounts: { error: number };
      };
      expect(result.ruleHits).toContain("thermal-foldback");
      expect(result.errorCodeStats.map((stat) => stat.code)).toContain("E_THERMAL_FOLDBACK");
      expect(result.severityCounts.error).toBe(1);
    }

    const strayArgs = await executeLogAnalysisTool("get_prefilter_findings", { extra: true }, buildContext());
    expect(strayArgs.ok).toBe(false);
  });
});

describe("read_domain_knowledge", () => {
  it("states unavailability honestly when no retrieval backend is bound", async () => {
    const outcome = await executeLogAnalysisTool("read_domain_knowledge", { query: "thermal foldback" }, buildContext());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toMatchObject({ available: false, items: [] });
    }
  });

  it("passes the query to the bound backend, truncates excerpts, and labels the generic fallback scope", async () => {
    const longExcerpt = "knowledge ".repeat(100);
    const queries: string[] = [];
    const context = buildContext({
      searchDomainKnowledge: async (query) => {
        queries.push(query);
        return {
          scope: "organization-generic",
          retrievalMode: "fts_only",
          items: Array.from({ length: 8 }, (_, index) => ({
            entryId: `entry-${index}`,
            title: `Entry ${index}`,
            contentForm: "markdown" as const,
            tags: [],
            excerpt: longExcerpt,
            updatedAt: "2026-08-13T00:00:00.000Z",
            revisionId: null
          }))
        };
      }
    });

    const outcome = await executeLogAnalysisTool("read_domain_knowledge", { query: "E_THERMAL_FOLDBACK meaning" }, context);
    expect(queries).toEqual(["E_THERMAL_FOLDBACK meaning"]);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as {
        scope: string;
        scopeNote: string;
        items: Array<{ excerpt: string }>;
      };
      expect(result.scope).toBe("organization-generic");
      expect(result.scopeNote).toContain("organization-wide generic retrieval");
      expect(result.items).toHaveLength(5);
      expect(result.items[0].excerpt.length).toBeLessThanOrEqual(401);
    }
  });

  it("labels domain-linked scope when the backend restricted retrieval", async () => {
    const context = buildContext({
      searchDomainKnowledge: async () => ({
        scope: "domain-linked",
        retrievalMode: "semantic_fts",
        items: [
          {
            entryId: "entry-1",
            title: "E_THERMAL_FOLDBACK handbook",
            contentForm: "markdown" as const,
            tags: ["charging"],
            excerpt: "Thermal foldback error code meanings.",
            updatedAt: "2026-08-13T00:00:00.000Z",
            revisionId: "rev-1"
          }
        ]
      })
    });

    const outcome = await executeLogAnalysisTool("read_domain_knowledge", { query: "foldback" }, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toMatchObject({
        scope: "domain-linked",
        retrievalMode: "semantic_fts",
        items: [{ entryId: "entry-1", title: "E_THERMAL_FOLDBACK handbook" }]
      });
    }
  });
});

describe("get_related_parameter_context", () => {
  it("reports no related parameter when no backend is bound", async () => {
    const outcome = await executeLogAnalysisTool("get_related_parameter_context", {}, buildContext());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toMatchObject({ available: false });
    }
  });

  it("returns the parameter summary with recent changes capped at 5", async () => {
    const context = buildContext({
      loadRelatedParameterContext: async () => ({
        parameterId: "binding-1",
        name: "battery-temp-target",
        description: "Target pack temperature",
        unit: "C",
        projectId: "proj-1",
        currentValue: "45",
        schemaDefault: "40",
        policyTarget: "42",
        recentChanges: Array.from({ length: 9 }, (_, index) => ({
          value: String(40 + index),
          changedAt: `2026-08-0${(index % 9) + 1}T00:00:00.000Z`
        }))
      })
    });

    const outcome = await executeLogAnalysisTool("get_related_parameter_context", {}, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const result = outcome.result as { available: boolean; parameter: { recentChanges: unknown[] } };
      expect(result.available).toBe(true);
      expect(result.parameter.recentChanges).toHaveLength(5);
    }
  });

  it("stays honest when the parameter is missing from the organization", async () => {
    const context = buildContext({ loadRelatedParameterContext: async () => null });
    const outcome = await executeLogAnalysisTool("get_related_parameter_context", {}, context);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result).toMatchObject({ available: false });
    }
  });
});
