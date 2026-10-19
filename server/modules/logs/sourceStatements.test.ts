import { describe, expect, it } from "vitest";
import { createSourceStatementBudget, extractSourceStatements, extractSourceStatementsCooperatively, getSourceStatementLimits, matchesStatementSkeleton, normalizeStatementFormat, statementMatchKeys } from "./sourceStatements";
import { logSkillSpecSchema } from "./skillSpec";

describe("source log statements", () => {
  it("rejects empty/capture-heavy custom patterns and bounds the original 10k reproduction", () => {
    for (const pattern of ["()".repeat(1000), "()", "a*", "\\b", "(a)".repeat(9)]) {
      expect(logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", source: { statementPatterns: [pattern] } }).success).toBe(false);
    }
    const started = performance.now();
    expect(extractSourceStatements({ path: "a.c", text: "a".repeat(10_000), patterns: ["()".repeat(1000)] }))
      .toEqual({ statements: [], truncated: true });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("bounds malformed C++ raw-string delimiter searches", () => {
    const started = performance.now();
    expect(extractSourceStatements({ path: "a.cpp", text: 'R"" '.repeat(32_000) }).statements).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("budgets all examined matches and capture work, including matches that are not calls, across files", () => {
    const file = extractSourceStatements({ path: "a.c", text: "a".repeat(10_000), patterns: ["a"] });
    expect(file).toEqual({ statements: [], truncated: true });
    const budget = createSourceStatementBudget({ maxMatches: 3 });
    expect(extractSourceStatements({ path: "a.c", text: "aa", patterns: ["a"] }, { budget }).truncated).toBe(false);
    expect(budget.matchesRemaining).toBe(1);
    expect(extractSourceStatements({ path: "b.c", text: "aa", patterns: ["a"] }, { budget }).truncated).toBe(true);
    expect(budget.matchesRemaining).toBe(0);
    const captures = createSourceStatementBudget({ maxCaptures: 6 });
    expect(extractSourceStatements({ path: "c.c", text: "ababab", patterns: ["(a)(b)"] }, { budget: captures }).truncated).toBe(true);
    expect(captures.capturesRemaining).toBe(0);
    expect(captures.matchesRemaining).toBe(19_998);
    const fileCaptures = createSourceStatementBudget();
    expect(extractSourceStatements({ path: "d.c", text: "a".repeat(16_000), patterns: ["(a)".repeat(8)] }, { budget: fileCaptures }).truncated).toBe(true);
    expect(fileCaptures.matchesRemaining).toBe(20_000 - Math.floor(16_000 / 9));
  });

  it("rejects long and unterminated stream literals before linear bounded normalization", () => {
    const started = performance.now();
    for (const tail of ['";', ""]) {
      expect(extractSourceStatements({ path: "a.cpp", text: 'LOG(INFO) << "' + "${".repeat(16_384) + tail }))
        .toEqual({ statements: [], truncated: true });
    }
    expect(normalizeStatementFormat("${".repeat(16_384))).toBeNull();
    expect(normalizeStatementFormat("${".repeat(2048))).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("cooperatively yields, obeys file/snapshot deadlines and propagates lost leases", async () => {
    let clock = 0, ticks = 0;
    const input = { path: "a.c", text: 'pr_warn("thermal %d", temp);\n'.repeat(300) };
    const budget = createSourceStatementBudget({ now: () => clock, maxMs: 3 });
    const result = await extractSourceStatementsCooperatively(input, { budget, now: () => clock,
      onCheckpoint: async () => { ticks++; clock++; } });
    expect(ticks).toBe(3);
    expect(result.truncated).toBe(true);
    expect(extractSourceStatements(input, { budget, now: () => clock })).toEqual({ statements: [], truncated: true });
    let scheduled = false;
    setImmediate(() => { scheduled = true; });
    const complete = await extractSourceStatementsCooperatively(input);
    expect(scheduled).toBe(true);
    expect(complete.statements.length).toBeGreaterThan(0);
    await expect(extractSourceStatementsCooperatively(input, { onCheckpoint: async () => { throw new Error("lease lost"); } })).rejects.toThrow("lease lost");
    expect(extractSourceStatements(input, { maxMs: 0 })).toEqual({ statements: [], truncated: true });
  });

  it.each([
    ['pr_warn("thermal foldback: temp=%d\\n", temp);', "thermal foldback: temp=71"],
    ['printk(KERN_WARNING "thermal: %02x\\n", value);', "thermal: ff"],
    ['pr_warn("thermal mac=%pM", address);', "thermal mac=aa:bb:cc:dd:ee:ff"],
    ['dev_err(dev, "thermal: %ld\\n", value);', "thermal: 71"],
    ['ALOGW("thermal: %d", value);', "thermal: 71"],
    ['ALOGW_IF(hot, "thermal: %d", value);', "thermal: 71"],
    ['Log.w("ThermalTag", "thermal: %d", value);', "thermal: 71"],
    ['Log.w(TAG, "thermal: " + temperature);', "thermal: 71"],
    ['Log.w(TAG, "thermal: $temperature");', "thermal: 71"],
    ['LOG(WARNING) << "thermal: " << temperature;', "thermal: 71"],
    ['LOG(INFO) << R"(thermal foldback)";', "thermal foldback"],
    ['LOG(INFO) << R"msg(thermal \\ foldback)msg";', "thermal \\ foldback"],
    ['LOG("thermal: %d", temperature);', "thermal: 71"],
    ['LOG(WARNING, "thermal: %d", temperature);', "thermal: 71"],
    ['logging.warning("thermal: %s", temperature)', "thermal: 71"],
    ['logging.warning(f"thermal: {temperature:.2f}")', "thermal: 71.00"],
    ['logging.log(WARNING, "thermal: %d", temperature)', "thermal: 71"],
    ['log.Printf("thermal: %v", temperature)', "thermal: 71"],
    ['slog.Warn("thermal foldback", "temperature", temperature)', "thermal foldback temperature=71"],
    ['slog.WarnContext(ctx, "thermal foldback", "temperature", temperature)', "thermal foldback temperature=71"],
    ['slog.Log(ctx, level, "thermal foldback", "temperature", temperature)', "thermal foldback temperature=71"]
  ])("extracts the emitter in %s", (text, log) => {
    const path = text.startsWith("logging") ? "src/main.py" : text.includes("$temperature") ? "src/main.kt" : "src/main.c";
    const result = extractSourceStatements({ path, text: `// source\n${text}\n` });
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0]).toMatchObject({ path, line: 2, rawCall: expect.stringContaining(text.split("(")[0]) });
    expect(matchesStatementSkeleton(result.statements[0].skeleton, log)).toBe(true);
    expect(statementMatchKeys(log)).toContain(result.statements[0].matchKey);
  });

  it("escapes regex literals, preserves %% and handles format/interpolation fields", () => {
    const result = normalizeStatementFormat("[thermal] a.b(100%%)=%08.2f ${value} {} end");
    expect(result).not.toBeNull();
    expect(matchesStatementSkeleton(result!.skeleton, "[thermal] a.b(100%)=71.00 yes field end")).toBe(true);
    expect(matchesStatementSkeleton(result!.skeleton, "XthermalX axb100%=71.00 yes field end")).toBe(false);
    expect(matchesStatementSkeleton(normalizeStatementFormat("thermal %%pM")!.skeleton, "thermal %pM")).toBe(true);
    expect(normalizeStatementFormat("%d {} ${value}")).toBeNull();
  });

  it("ignores quoted calls/comments and supports multi-line adjacent C literals", () => {
    const text = '// pr_warn("fake");\nconst char *x = "pr_warn(\\\"fake\\\")";\n/* pr_warn("fake"); */\npr_warn(\n "thermal "\n "foldback: temp=%d", temp\n);';
    const result = extractSourceStatements({ path: "a.c", text });
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].line).toBe(4);
    expect(matchesStatementSkeleton(result.statements[0].skeleton, "thermal foldback: temp=71")).toBe(true);
  });

  it("matches values directly attached to literal text through the candidate key", () => {
    const statement = extractSourceStatements({ path: "a.c", text: 'pr_warn("temperature%d", value);' }).statements[0];
    expect(statementMatchKeys("temperature71")).toContain(statement.matchKey);
    expect(matchesStatementSkeleton(statement.skeleton, "temperature71")).toBe(true);
  });

  it("keeps literal braces in C and escaped interpolation braces in Python", () => {
    const c = extractSourceStatements({ path: "a.c", text: 'pr_warn("thermal {state}=%d", value);' }).statements[0];
    expect(matchesStatementSkeleton(c.skeleton, "thermal {state}=71")).toBe(true);
    expect(matchesStatementSkeleton(c.skeleton, "thermal other=71")).toBe(false);
    const literal = extractSourceStatements({ path: "a.c", text: 'pr_warn("payload={} temp=%d", value);' }).statements[0];
    expect(matchesStatementSkeleton(literal.skeleton, "payload={} temp=71")).toBe(true);
    expect(matchesStatementSkeleton(literal.skeleton, "payload=not-braces temp=71")).toBe(false);
    const embedded = extractSourceStatements({ path: "a.c", text: 'pr_warn("${thermal %d}", value);' }).statements[0];
    expect(matchesStatementSkeleton(embedded.skeleton, "${thermal 71}")).toBe(true);
    const kotlin = extractSourceStatements({ path: "a.kt", text: 'Log.w(TAG, "literal: \\$temperature");' }).statements[0];
    expect(matchesStatementSkeleton(kotlin.skeleton, "literal: $temperature")).toBe(true);
    expect(matchesStatementSkeleton(kotlin.skeleton, "literal: 71")).toBe(false);
    const py = extractSourceStatements({ path: "a.py", text: 'logging.warning(f"thermal {{state}}={value}")' }).statements[0];
    expect(matchesStatementSkeleton(py.skeleton, "thermal {state}=71")).toBe(true);
    expect(matchesStatementSkeleton(py.skeleton, "thermal other=71")).toBe(false);
    const dollar = extractSourceStatements({ path: "a.py", text: 'logging.warning(f"thermal ${value}")' }).statements[0];
    expect(matchesStatementSkeleton(dollar.skeleton, "thermal $71")).toBe(true);
  });

  it("does not treat logger construction, value helpers or formatting helpers as output statements", () => {
    const text = ['logging.getLogger("thermal")', 'slog.String("thermal", "foldback")', 'Log.getStackTraceString("thermal")', 'log.SetPrefix("thermal")', 'pr_fmt("thermal")'].join("\n");
    expect(extractSourceStatements({ path: "a.py", text }).statements).toEqual([]);
  });

  it("caps statements and individual calls, rejecting logs above the matcher input cap", () => {
    const text = 'pr_warn("thermal %d", value);\n'.repeat(4);
    expect(extractSourceStatements({ path: "a.c", text, maxStatements: 2 })).toMatchObject({ statements: [expect.anything(), expect.anything()], truncated: true });
    expect(extractSourceStatements({ path: "a.c", text, maxStatements: 0 })).toEqual({ statements: [], truncated: true });
    expect(extractSourceStatements({ path: "a.c", text: `pr_warn("${"x".repeat(5000)}");` }).statements).toEqual([]);
    expect(matchesStatementSkeleton("thermal", "thermal" + "x".repeat(8192))).toBe(false);
    expect(getSourceStatementLimits({ LOG_SOURCE_MAX_STATEMENTS: "5", LOG_SOURCE_MAX_STATEMENTS_PER_FILE: "2" })).toEqual({ maxPerSnapshot: 5, maxPerFile: 2 });
    expect(() => getSourceStatementLimits({ LOG_SOURCE_MAX_STATEMENTS: "0" })).toThrow();
    expect(extractSourceStatements({ path: "a.c", text: 'CUSTOM("thermal");'.repeat(3000), patterns: ["\\("], maxStatements: 5000 }))
      .toMatchObject({ truncated: true });
  });

  it("appends bounded RE2 custom emitter patterns in skill/v1", () => {
    const source = { statementPatterns: ["\\bTHERM_LOG\\s*\\("] };
    expect(logSkillSpecSchema.parse({ schemaVersion: "skill/v1", source }).source).toEqual(source);
    expect(extractSourceStatements({ path: "a.c", text: 'THERM_LOG("thermal %d", value);', patterns: source.statementPatterns }).statements).toHaveLength(1);
    for (const statementPatterns of [["(?=bad)"], ["x".repeat(4097)], Array(21).fill("valid")]) {
      expect(logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", source: { statementPatterns } }).success).toBe(false);
    }
  });
});
