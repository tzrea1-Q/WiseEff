import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Structural CSS assertions for tests.
 *
 * Style tests used to regex the raw text of `src/styles.css`, which froze the
 * stylesheet's formatting (one-line rules, exact whitespace, declaration order)
 * and blocked refactoring. This helper parses a stylesheet into
 * (selector -> declarations) structures so tests can assert visual contracts
 * ("this selector exists", "this property resolves to this value/token")
 * independent of source formatting.
 *
 * The parser understands plain CSS plus nested at-rules (`@media`, `@layer`,
 * `@supports`, `@keyframes`, Tailwind's `@theme`). It is intentionally not a
 * full CSS parser; it is enough for the rule/declaration shapes used in this
 * repository's stylesheets.
 */

export interface CssRule {
  /** Normalized full selector list, e.g. `.a:hover, .b > span`. */
  selector: string;
  /** Individual normalized selectors from the comma-separated list. */
  selectors: string[];
  /** Enclosing at-rule preludes, outermost first, e.g. `["@media (max-width: 900px)"]`. */
  atRules: string[];
  /** Declarations with normalized values; for duplicated properties the last one wins. */
  declarations: Record<string, string>;
  /** Property names in source order (duplicates preserved). */
  properties: string[];
}

const sheetCache = new Map<string, string>();
const ruleCache = new Map<string, CssRule[]>();

/** Reads a stylesheet relative to the repository root (cached per test run). */
export function readStylesheet(relativePath: string): string {
  let text = sheetCache.get(relativePath);
  if (text === undefined) {
    text = readFileSync(resolve(process.cwd(), relativePath), "utf8");
    sheetCache.set(relativePath, text);
  }
  return text;
}

function stripComments(cssText: string): string {
  return cssText.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Splits a selector list on top-level commas only (`:is(.a, .b)` stays intact). */
function splitSelectorList(preludeText: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of preludeText) {
    if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth = Math.max(0, depth - 1);
    }
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => normalizeWhitespace(part)).filter(Boolean);
}

/** Parses stylesheet text into a flat list of rules (cached by content). */
export function parseCssRules(cssText: string): CssRule[] {
  const cached = ruleCache.get(cssText);
  if (cached) {
    return cached;
  }

  const source = stripComments(cssText);
  const rules: CssRule[] = [];
  const atRuleStack: string[] = [];

  // Tokenizer state shared by the top-level scan and block parsing: `{`, `}`,
  // `;` and `,` are only structural outside quoted strings and parentheses
  // (base64 URLs and quoted content may contain any of them).
  let index = 0;
  let quote: '"' | "'" | null = null;
  let parenDepth = 0;

  const step = (char: string): boolean => {
    // Returns true when the character is inert (inside quotes/parens/escape).
    if (quote) {
      if (char === "\\") {
        index += 1; // Skip the escaped character too.
      } else if (char === quote) {
        quote = null;
      }
      return true;
    }
    if (char === '"' || char === "'") {
      quote = char;
      return true;
    }
    if (char === "(") {
      parenDepth += 1;
      return true;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      return true;
    }
    return parenDepth > 0;
  };

  const parseBlock = (): { declarations: Record<string, string>; properties: string[] } => {
    // Consumes from just after `{` to the matching `}` collecting declarations,
    // recursing into nested blocks (at-rules or keyframe steps).
    const declarations: Record<string, string> = {};
    const properties: string[] = [];
    let buffer = "";

    const flushDeclaration = () => {
      const text = buffer.trim();
      buffer = "";
      if (!text) {
        return;
      }
      const colon = text.indexOf(":");
      if (colon === -1) {
        return;
      }
      const property = text.slice(0, colon).trim();
      const value = normalizeWhitespace(text.slice(colon + 1));
      if (!property) {
        return;
      }
      declarations[property] = value;
      properties.push(property);
    };

    while (index < source.length) {
      const char = source[index];
      if (step(char)) {
        buffer += char;
        index += 1;
        continue;
      }
      if (char === "{") {
        const nestedPrelude = normalizeWhitespace(buffer);
        buffer = "";
        index += 1;
        if (isGroupingAtRule(nestedPrelude)) {
          atRuleStack.push(nestedPrelude);
          const nested = parseBlock();
          void nested;
          atRuleStack.pop();
          continue;
        }
        emitRule(nestedPrelude, parseBlock());
        continue;
      }
      if (char === "}") {
        flushDeclaration();
        index += 1;
        return { declarations, properties };
      }
      if (char === ";") {
        flushDeclaration();
        index += 1;
        continue;
      }
      buffer += char;
      index += 1;
    }

    flushDeclaration();
    return { declarations, properties };
  };

  const emitRule = (
    rulePrelude: string,
    block: { declarations: Record<string, string>; properties: string[] }
  ) => {
    if (!rulePrelude) {
      return;
    }
    if (rulePrelude.startsWith("@")) {
      // At-rules with declarations of their own (e.g. @theme, @font-face) are
      // recorded as rules keyed by the at-rule prelude itself.
      if (block.properties.length > 0) {
        rules.push({
          selector: rulePrelude,
          selectors: [rulePrelude],
          atRules: [...atRuleStack],
          declarations: block.declarations,
          properties: block.properties
        });
      }
      return;
    }
    const selectors = splitSelectorList(rulePrelude);
    if (selectors.length === 0) {
      return;
    }
    rules.push({
      selector: selectors.join(", "),
      selectors,
      atRules: [...atRuleStack],
      declarations: block.declarations,
      properties: block.properties
    });
  };

  let prelude = "";
  while (index < source.length) {
    const char = source[index];
    if (step(char)) {
      prelude += char;
      index += 1;
      continue;
    }
    if (char === "{") {
      const currentPrelude = normalizeWhitespace(prelude);
      prelude = "";
      index += 1;
      if (currentPrelude.startsWith("@") && isGroupingAtRule(currentPrelude)) {
        atRuleStack.push(currentPrelude);
        continue;
      }
      emitRule(currentPrelude, parseBlock());
      continue;
    }
    if (char === "}") {
      // Close of a grouping at-rule block.
      atRuleStack.pop();
      prelude = "";
      index += 1;
      continue;
    }
    if (char === ";") {
      // Statement at-rule such as @import; discard.
      prelude = "";
      index += 1;
      continue;
    }
    prelude += char;
    index += 1;
  }

  ruleCache.set(cssText, rules);
  return rules;
}

function isGroupingAtRule(preludeText: string): boolean {
  return /^@(media|supports|layer|scope|container|keyframes|custom-media)\b/.test(preludeText);
}

export interface RuleQuery {
  /**
   * Requires the rule to sit inside an at-rule whose prelude contains this
   * substring, e.g. `@media (max-width: 900px)`.
   */
  within?: string;
  /** Requires the rule to sit at the top level (no enclosing at-rules). */
  topLevel?: boolean;
}

function isConditionalAtRule(preludeText: string): boolean {
  return /^@(media|supports|container)\b/.test(preludeText);
}

function matchesQuery(rule: CssRule, query: RuleQuery | undefined): boolean {
  if (!query) {
    // Default view: unconditional rules only. Conditional overrides (media/
    // supports/container) must be requested explicitly via `within`, so that
    // base-value assertions are not silently overridden by breakpoints.
    return !rule.atRules.some(isConditionalAtRule);
  }
  if (query.topLevel && rule.atRules.length > 0) {
    return false;
  }
  if (query.within !== undefined) {
    const target = normalizeWhitespace(query.within);
    if (!rule.atRules.some((atRule) => atRule.includes(target))) {
      return false;
    }
  }
  return true;
}

/** All rules whose selector list contains the given selector (normalized exact match). */
export function rulesFor(cssText: string, selector: string, query?: RuleQuery): CssRule[] {
  const target = normalizeWhitespace(selector);
  return parseCssRules(cssText).filter(
    (rule) => rule.selectors.includes(target) && matchesQuery(rule, query)
  );
}

/** True when at least one rule targets the given selector. */
export function hasRule(cssText: string, selector: string, query?: RuleQuery): boolean {
  return rulesFor(cssText, selector, query).length > 0;
}

/**
 * Declarations merged across every rule that targets the selector, in source
 * order (later rules override earlier ones), so tests assert the effective
 * value for the selector without depending on rule layout.
 */
export function declarationsFor(
  cssText: string,
  selector: string,
  query?: RuleQuery
): Record<string, string> {
  const matched = rulesFor(cssText, selector, query);
  if (matched.length === 0) {
    throw new Error(`Missing CSS rule for selector: ${selector}`);
  }
  const merged: Record<string, string> = {};
  for (const rule of matched) {
    Object.assign(merged, rule.declarations);
  }
  return merged;
}

/** The effective value of one property for a selector, or undefined when absent. */
export function declarationFor(
  cssText: string,
  selector: string,
  property: string,
  query?: RuleQuery
): string | undefined {
  return declarationsFor(cssText, selector, query)[property];
}

/** Every individual selector defined in the stylesheet (deduplicated, source order). */
export function allSelectors(cssText: string): string[] {
  const seen = new Set<string>();
  for (const rule of parseCssRules(cssText)) {
    for (const selector of rule.selectors) {
      seen.add(selector);
    }
  }
  return [...seen];
}

/** True when any rule sits inside an at-rule whose prelude contains the substring. */
export function hasAtRule(cssText: string, preludeSubstring: string): boolean {
  const target = normalizeWhitespace(preludeSubstring);
  return parseCssRules(cssText).some((rule) =>
    rule.atRules.some((atRule) => atRule.includes(target))
  );
}
