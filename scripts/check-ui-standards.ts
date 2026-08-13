import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/*
 * UI standards ratchet gate (`npm run ui:check`).
 *
 * Counts design-system violations per rule and compares each count against
 * scripts/ui-standards-baseline.json:
 *   - count > baseline  → fail (new debt is forbidden),
 *   - count < baseline  → pass, with a hint to ratchet the baseline down,
 *   - count = baseline  → pass.
 * `--update-baseline` rewrites the baseline with the current honest counts.
 *
 * The baseline model exists because P3 (motion/chart/dark-theme) keeps
 * reducing the literal stock on parallel branches: the gate locks the stock,
 * forbids additions, and encourages decreases — it does not assume zero.
 *
 * Spec: docs/design-docs/ui-design-system.md (§Non-Negotiables, §Anti-Patterns)
 */

export const baselineRelativePath = "scripts/ui-standards-baseline.json";

export type UiRuleId =
  | "raw-color"
  | "raw-z-index"
  | "raw-font-size"
  | "raw-shadow"
  | "ease-keyword"
  | "window-confirm"
  | "hand-rolled-backdrop"
  | "english-chrome";

export const uiRuleIds: UiRuleId[] = [
  "raw-color",
  "raw-z-index",
  "raw-font-size",
  "raw-shadow",
  "ease-keyword",
  "window-confirm",
  "hand-rolled-backdrop",
  "english-chrome"
];

export const ruleGuidance: Record<UiRuleId, string> = {
  "raw-color":
    "Use var(--...) semantic tokens or color-mix() over tokens. Raw hex/rgb()/rgba()/hsl()/oklch() literals live only in the token block. See docs/design-docs/ui-design-system.md §Design Tokens / Color.",
  "raw-z-index":
    "Use the declared ladder: z-index: var(--z-...). Raw numbers and +1 escape hatches are defects. See docs/design-docs/ui-design-system.md §Z-Index.",
  "raw-font-size":
    "Use the type scale: font-size: var(--text-xs..2xl). No other font sizes exist. See docs/design-docs/ui-design-system.md §Typography.",
  "raw-shadow":
    "Use the elevation tokens: box-shadow: var(--shadow-1..3) and var(--ring). Shadows are never invented inline. See docs/design-docs/ui-design-system.md §Elevation.",
  "ease-keyword":
    "Use motion tokens: var(--ease-out) / var(--ease-in-out) with var(--duration-*). The bare ease/ease-in/ease-out/ease-in-out keywords are forbidden. See docs/design-docs/ui-design-system.md §Motion.",
  "window-confirm":
    "Use ConfirmDialog / ModalDialog (src/components/common). window.confirm and window.alert are forbidden. See docs/design-docs/ui-design-system.md §Component Standards / Dialogs.",
  "hand-rolled-backdrop":
    "All dialogs go through ModalDialog/ConfirmDialog; never hand-roll a modal-backdrop div. See docs/design-docs/ui-design-system.md §Component Standards / Dialogs.",
  "english-chrome":
    "UI copy is Chinese-first; table chrome and relative times go through shared formatters and product language. See docs/design-docs/ui-design-system.md §Content and Language."
};

export interface UiViolation {
  rule: UiRuleId;
  file: string;
  line: number;
  detail: string;
}

export interface RuleBaselineEntry {
  count: number;
  note?: string;
  files?: Record<string, number>;
}

export interface UiStandardsBaseline {
  description?: string;
  rules: Partial<Record<UiRuleId, RuleBaselineEntry>>;
}

const backdropExemptFiles = new Set(["src/components/common/ModalDialog.tsx"]);

/*
 * english-chrome is a fixed list of already-zeroed English residues (FA-18),
 * matched precisely against JSX-text-ish content (quoted strings stripped so
 * data-layer values such as `lastActive: "just now"` do not count). Extend the
 * list only with residues that are already at zero.
 */
const englishChromePatterns: { label: string; pattern: RegExp }[] = [
  { label: "Showing X of Y table chrome", pattern: /(?<![\w-])Showing\s+(?:\d|\{|\$)/ },
  { label: "Report ID header", pattern: /(?<![\w-])Report ID(?![\w-])/ },
  { label: "English relative time (Nh ago)", pattern: /\b\d+h ago\b/ },
  { label: "English relative time (just now)", pattern: /(?<![\w-])just now(?![\w-])/ }
];

const hexColorPattern = /#[0-9a-fA-F]{3,8}\b/g;
const colorFunctionPattern = /(?<![\w-])(?:rgba?|hsla?|oklch)\s*\(/g;
const easeKeywordPattern = /(?<![\w-])ease(?:-in-out|-in|-out)?(?![\w-])/g;
/* `modal-backdrop` must appear as a standalone class token inside a className
 * value; scoped names like `param-admin-modal-backdrop` passed through
 * ModalDialog's backdropClassName prop do not match. */
const handRolledBackdropPattern =
  /(?<!\w)className\s*=\s*(?:"[^"]*(?<![\w-])modal-backdrop(?![\w-])|'[^']*(?<![\w-])modal-backdrop(?![\w-])|`[^`]*(?<![\w-])modal-backdrop(?![\w-])|\{.*?(?<![\w-])modal-backdrop(?![\w-]))/;

function isTokenBlockSelector(selector: string): boolean {
  const trimmed = selector.trim();
  return trimmed === ":root" || trimmed === ".dark" || trimmed.startsWith("@theme");
}

interface CssBlock {
  isTokenBlock: boolean;
}

/**
 * Line-by-line CSS state machine: strips comments and string contents, tracks
 * the token-block stack (:root / .dark / @theme), and flushes one logical
 * declaration at a time (declarations may span lines). One pass per file.
 */
export function scanCssContent(filePath: string, content: string): UiViolation[] {
  const violations: UiViolation[] = [];
  const blockStack: CssBlock[] = [];
  let inComment = false;
  let stringDelimiter: '"' | "'" | null = null;
  let pending = "";
  let pendingStartLine = 1;

  const lines = content.split(/\r?\n/);

  const flushDeclaration = (): void => {
    const declaration = pending.trim();
    pending = "";
    if (declaration.length === 0 || blockStack.length === 0) {
      return;
    }

    const colonIndex = declaration.indexOf(":");
    if (colonIndex <= 0) {
      return;
    }

    const property = declaration.slice(0, colonIndex).trim().toLowerCase();
    const value = declaration.slice(colonIndex + 1).trim();
    const inTokenBlock = blockStack.some((block) => block.isTokenBlock);
    const line = pendingStartLine;

    if (!inTokenBlock) {
      for (const match of value.matchAll(hexColorPattern)) {
        violations.push({ rule: "raw-color", file: filePath, line, detail: `${property}: … ${match[0]} …` });
      }
      for (const match of value.matchAll(colorFunctionPattern)) {
        violations.push({ rule: "raw-color", file: filePath, line, detail: `${property}: … ${match[0]}…)` });
      }

      if (property === "font-size" && /(?:\d|\.\d)[\d.]*(?:px|rem|em)\b/.test(value)) {
        violations.push({ rule: "raw-font-size", file: filePath, line, detail: `font-size: ${value}` });
      }

      if (property === "box-shadow") {
        const residue = value
          .replace(/var\(--shadow-[\w-]*\)/g, "")
          .replace(/var\(--ring[\w-]*\)/g, "")
          .replace(/\b(?:inset|none)\b/g, "")
          .replace(/[,\s]/g, "");
        if (residue.length > 0) {
          violations.push({ rule: "raw-shadow", file: filePath, line, detail: `box-shadow: ${value}` });
        }
      }
    }

    if (property === "z-index") {
      const residue = value.replace(/var\(--z-[\w-]*\)/g, "");
      if (/-?\d/.test(residue)) {
        violations.push({ rule: "raw-z-index", file: filePath, line, detail: `z-index: ${value}` });
      }
    }

    if (property.startsWith("transition") || property.startsWith("animation")) {
      for (const match of value.matchAll(easeKeywordPattern)) {
        violations.push({ rule: "ease-keyword", file: filePath, line, detail: `${property}: … ${match[0]} …` });
      }
    }
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];

      if (inComment) {
        if (char === "*" && line[i + 1] === "/") {
          inComment = false;
          i += 1;
        }
        continue;
      }

      if (stringDelimiter !== null) {
        if (char === "\\") {
          i += 1;
        } else if (char === stringDelimiter) {
          stringDelimiter = null;
        }
        continue;
      }

      if (char === "/" && line[i + 1] === "*") {
        inComment = true;
        i += 1;
        continue;
      }

      if (char === '"' || char === "'") {
        stringDelimiter = char;
        continue;
      }

      if (char === "{") {
        const selector = pending;
        const parentIsToken = blockStack.some((block) => block.isTokenBlock);
        blockStack.push({ isTokenBlock: parentIsToken || isTokenBlockSelector(selector) });
        pending = "";
        continue;
      }

      if (char === "}") {
        flushDeclaration();
        blockStack.pop();
        continue;
      }

      if (char === ";") {
        flushDeclaration();
        continue;
      }

      if (pending.trim().length === 0 && !/\s/.test(char)) {
        pendingStartLine = lineNumber;
      }
      pending += char;
    }

    // Strings do not span CSS lines; unterminated ones are treated as closed.
    stringDelimiter = null;
    pending += " ";
  }

  return violations;
}

interface TsxLineViews {
  /** Comments removed, string literals kept. */
  code: string;
  /** Comments removed and '…'/"…" contents removed; template contents kept. */
  codeWithoutStrings: string;
}

/**
 * Lightweight stateful tokenizer for TS/TSX: strips // and block comments,
 * and produces a parallel view with quoted-string contents removed (template
 * literal contents are kept, since UI chrome is often built via templates).
 */
export function extractTsxLineViews(content: string): TsxLineViews[] {
  const views: TsxLineViews[] = [];
  type State = "code" | "blockComment" | "single" | "double" | "template";
  let state: State = "code";

  for (const line of content.split(/\r?\n/)) {
    let code = "";
    let codeWithoutStrings = "";

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];

      if (state === "blockComment") {
        if (char === "*" && line[i + 1] === "/") {
          state = "code";
          i += 1;
        }
        continue;
      }

      if (state === "single" || state === "double") {
        const delimiter = state === "single" ? "'" : '"';
        if (char === "\\") {
          code += char + (line[i + 1] ?? "");
          i += 1;
          continue;
        }
        if (char === delimiter) {
          state = "code";
          code += char;
          codeWithoutStrings += char;
          continue;
        }
        code += char;
        continue;
      }

      if (state === "template") {
        if (char === "\\") {
          code += char + (line[i + 1] ?? "");
          codeWithoutStrings += char + (line[i + 1] ?? "");
          i += 1;
          continue;
        }
        if (char === "`") {
          state = "code";
        }
        code += char;
        codeWithoutStrings += char;
        continue;
      }

      if (char === "/" && line[i + 1] === "/") {
        break;
      }
      if (char === "/" && line[i + 1] === "*") {
        state = "blockComment";
        i += 1;
        continue;
      }
      if (char === "'") {
        state = "single";
        code += char;
        codeWithoutStrings += char;
        continue;
      }
      if (char === '"') {
        state = "double";
        code += char;
        codeWithoutStrings += char;
        continue;
      }
      if (char === "`") {
        state = "template";
        code += char;
        codeWithoutStrings += char;
        continue;
      }

      code += char;
      codeWithoutStrings += char;
    }

    // Single/double-quoted strings do not legally span lines.
    if (state === "single" || state === "double") {
      state = "code";
    }

    views.push({ code, codeWithoutStrings });
  }

  return views;
}

export function scanTsContent(filePath: string, content: string): UiViolation[] {
  const violations: UiViolation[] = [];
  const isTsx = filePath.endsWith(".tsx");
  const views = extractTsxLineViews(content);

  for (let index = 0; index < views.length; index += 1) {
    const { code, codeWithoutStrings } = views[index];
    const line = index + 1;

    for (const match of codeWithoutStrings.matchAll(/window\s*\.\s*(confirm|alert)\s*\(/g)) {
      violations.push({ rule: "window-confirm", file: filePath, line, detail: `window.${match[1]}(…)` });
    }

    if (!isTsx) {
      continue;
    }

    for (const match of codeWithoutStrings.matchAll(/zIndex:\s*-?\d+/g)) {
      violations.push({ rule: "raw-z-index", file: filePath, line, detail: match[0] });
    }

    if (!backdropExemptFiles.has(filePath) && handRolledBackdropPattern.test(code)) {
      violations.push({ rule: "hand-rolled-backdrop", file: filePath, line, detail: "className with modal-backdrop" });
    }

    for (const { label, pattern } of englishChromePatterns) {
      if (pattern.test(codeWithoutStrings)) {
        violations.push({ rule: "english-chrome", file: filePath, line, detail: label });
      }
    }
  }

  return violations;
}

async function collectFiles(root: string, directory: string, extensions: string[]): Promise<string[]> {
  const files: string[] = [];

  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") {
            await visit(entryPath);
          }
          return;
        }
        if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) {
          files.push(entryPath);
        }
      })
    );
  }

  await visit(path.join(root, directory));
  return files.sort();
}

export async function collectUiStandardsViolations(root = process.cwd()): Promise<UiViolation[]> {
  const [cssFiles, tsFiles] = await Promise.all([
    collectFiles(root, "src", [".css"]),
    collectFiles(root, "src", [".ts", ".tsx"])
  ]);

  const violations: UiViolation[] = [];

  await Promise.all(
    cssFiles.map(async (filePath) => {
      const content = await readFile(filePath, "utf8");
      violations.push(...scanCssContent(toPosix(path.relative(root, filePath)), content));
    })
  );

  await Promise.all(
    tsFiles.map(async (filePath) => {
      const content = await readFile(filePath, "utf8");
      violations.push(...scanTsContent(toPosix(path.relative(root, filePath)), content));
    })
  );

  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function countByRule(violations: UiViolation[]): Record<UiRuleId, { count: number; files: Record<string, number> }> {
  const summary = Object.fromEntries(
    uiRuleIds.map((rule) => [rule, { count: 0, files: {} as Record<string, number> }])
  ) as Record<UiRuleId, { count: number; files: Record<string, number> }>;

  for (const violation of violations) {
    const entry = summary[violation.rule];
    entry.count += 1;
    entry.files[violation.file] = (entry.files[violation.file] ?? 0) + 1;
  }

  return summary;
}

export interface RuleComparison {
  rule: UiRuleId;
  current: number;
  baseline: number;
  status: "ok" | "improved" | "exceeded";
  newViolations: UiViolation[];
}

export function compareWithBaseline(violations: UiViolation[], baseline: UiStandardsBaseline): RuleComparison[] {
  const summary = countByRule(violations);

  return uiRuleIds.map((rule) => {
    const current = summary[rule].count;
    const baselineEntry = baseline.rules[rule];
    const baselineCount = baselineEntry?.count ?? 0;

    let status: RuleComparison["status"] = "ok";
    if (current > baselineCount) {
      status = "exceeded";
    } else if (current < baselineCount) {
      status = "improved";
    }

    let newViolations: UiViolation[] = [];
    if (status === "exceeded") {
      const baselineFiles = baselineEntry?.files ?? {};
      const grownFiles = new Set(
        Object.entries(summary[rule].files)
          .filter(([file, count]) => count > (baselineFiles[file] ?? 0))
          .map(([file]) => file)
      );
      newViolations = violations.filter((violation) => violation.rule === rule && grownFiles.has(violation.file));
      if (newViolations.length === 0) {
        newViolations = violations.filter((violation) => violation.rule === rule);
      }
    }

    return { rule, current, baseline: baselineCount, status, newViolations };
  });
}

export async function loadBaseline(root = process.cwd()): Promise<UiStandardsBaseline | null> {
  try {
    const raw = await readFile(path.join(root, baselineRelativePath), "utf8");
    return JSON.parse(raw) as UiStandardsBaseline;
  } catch {
    return null;
  }
}

export function buildBaseline(violations: UiViolation[], previous: UiStandardsBaseline | null): UiStandardsBaseline {
  const summary = countByRule(violations);
  const rules: UiStandardsBaseline["rules"] = {};

  for (const rule of uiRuleIds) {
    const entry: RuleBaselineEntry = { count: summary[rule].count };
    const previousNote = previous?.rules[rule]?.note;
    if (previousNote) {
      entry.note = previousNote;
    }
    if (summary[rule].count > 0) {
      entry.files = Object.fromEntries(Object.entries(summary[rule].files).sort(([a], [b]) => a.localeCompare(b)));
    }
    rules[rule] = entry;
  }

  return {
    description:
      "Ratchet baseline for `npm run ui:check`. Counts may only go down: when a rule's live count drops below its baseline, run `npm run ui:check -- --update-baseline` in the same change. Rules at 0 are hard-forbidden and must never ratchet up. Structure: rule id -> { count, note?, files? }.",
    rules
  };
}

const maxPrintedViolationsPerRule = 40;

export function formatComparisonReport(comparisons: RuleComparison[]): { text: string; failed: boolean } {
  const lines: string[] = ["UI standards ratchet check (npm run ui:check)", ""];
  const width = Math.max(...uiRuleIds.map((rule) => rule.length));
  let failed = false;
  let improved = false;

  for (const comparison of comparisons) {
    const marker = comparison.status === "exceeded" ? "FAIL" : comparison.status === "improved" ? "improved" : "ok";
    lines.push(
      `  ${comparison.rule.padEnd(width)}  ${String(comparison.current).padStart(5)} / baseline ${String(
        comparison.baseline
      ).padStart(5)}  ${marker}`
    );
    if (comparison.status === "exceeded") {
      failed = true;
    }
    if (comparison.status === "improved") {
      improved = true;
    }
  }

  for (const comparison of comparisons) {
    if (comparison.status !== "exceeded") {
      continue;
    }
    lines.push("");
    lines.push(
      `${comparison.rule}: ${comparison.current} exceeds baseline ${comparison.baseline} (+${
        comparison.current - comparison.baseline
      }). New violations (files whose count grew vs baseline):`
    );
    for (const violation of comparison.newViolations.slice(0, maxPrintedViolationsPerRule)) {
      lines.push(`  ${violation.file}:${violation.line}  ${violation.detail}`);
    }
    if (comparison.newViolations.length > maxPrintedViolationsPerRule) {
      lines.push(`  … and ${comparison.newViolations.length - maxPrintedViolationsPerRule} more`);
    }
    lines.push(`  Fix: ${ruleGuidance[comparison.rule]}`);
  }

  if (!failed && improved) {
    lines.push("");
    lines.push(
      "Some counts dropped below their baseline. Ratchet down by running: npm run ui:check -- --update-baseline"
    );
  }

  lines.push("");
  lines.push(failed ? "UI standards check failed." : "UI standards check passed.");
  return { text: lines.join("\n"), failed };
}

async function runCheck(root: string): Promise<number> {
  const baseline = await loadBaseline(root);
  if (baseline === null) {
    console.error(
      `Missing ${baselineRelativePath}. Generate it with: npm run ui:check -- --update-baseline`
    );
    return 1;
  }

  const violations = await collectUiStandardsViolations(root);
  const comparisons = compareWithBaseline(violations, baseline);
  const { text, failed } = formatComparisonReport(comparisons);

  if (failed) {
    console.error(text);
    return 1;
  }
  console.log(text);
  return 0;
}

async function runUpdateBaseline(root: string): Promise<number> {
  const previous = await loadBaseline(root);
  const violations = await collectUiStandardsViolations(root);
  const nextBaseline = buildBaseline(violations, previous);

  console.log("Updating UI standards baseline:");
  const width = Math.max(...uiRuleIds.map((rule) => rule.length));
  for (const rule of uiRuleIds) {
    const before = previous?.rules[rule]?.count ?? 0;
    const after = nextBaseline.rules[rule]?.count ?? 0;
    const delta = after - before;
    const deltaLabel = delta === 0 ? "unchanged" : delta > 0 ? `+${delta}` : String(delta);
    console.log(`  ${rule.padEnd(width)}  ${String(before).padStart(5)} -> ${String(after).padStart(5)}  (${deltaLabel})`);
    if (previous !== null && delta > 0) {
      console.warn(
        `  WARNING: ${rule} count increased. The ratchet should only go down; justify any increase in the PR.`
      );
    }
  }

  await writeFile(path.join(root, baselineRelativePath), `${JSON.stringify(nextBaseline, null, 2)}\n`, "utf8");
  console.log(`Baseline written to ${baselineRelativePath}.`);
  return 0;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const updateBaseline = process.argv.includes("--update-baseline");
  const exitCode = updateBaseline ? await runUpdateBaseline(process.cwd()) : await runCheck(process.cwd());
  process.exit(exitCode);
}
