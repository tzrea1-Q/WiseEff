/*
 * ESLint flat config (FA-24): jsx-a11y + react-hooks over src/**\/*.{ts,tsx}.
 *
 * Grading model (accessibility burn-down #1139):
 *   - rules with zero violations run at "error" (new debt is blocked),
 *   - rules with existing stock run at "warn" with the census count recorded
 *     next to them, so later waves can ratchet them to "error" as the stock
 *     burns down (same ratchet spirit as `npm run ui:check`).
 * Test files are included on purpose. Accessibility rules block new debt;
 * remaining react-hooks stock stays warning-level until its own burn-down.
 *
 * `npm run lint` fails on errors only; warnings do not block.
 */
import tsParser from "@typescript-eslint/parser";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import { noRawCssTextAssertions } from "./scripts/eslint/no-raw-css-text-assertions.js";

const wiseeffPlugin = {
  rules: {
    "no-raw-css-text-assertions": noRawCssTextAssertions
  }
};

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
      sourceType: "module"
    },
    plugins: { "jsx-a11y": jsxA11y, "react-hooks": reactHooks },
    rules: {
      // Recommended baselines: rules not overridden below keep their
      // recommended level ("error" for most; deprecated/ambiguous ones "off").
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // Zero violations today; promoted from recommended "warn" to "error".
      "react-hooks/incompatible-library": "error",
      "react-hooks/unsupported-syntax": "error",
      "react-hooks/rules-of-hooks": "error",

      "jsx-a11y/label-has-associated-control": ["error", {
        controlComponents: ["Input", "Textarea", "SearchField", "SelectControl", "DebugAdminSelectControl"],
        depth: 3
      }],
      // Existing react-hooks stock (2026-10-12); burn down, then promote to "error".
      "react-hooks/set-state-in-effect": "warn", // 160
      "react-hooks/refs": "warn", // 44
      "react-hooks/preserve-manual-memoization": "warn", // 32
      "react-hooks/exhaustive-deps": "warn", // 36
      "react-hooks/immutability": "warn", // 2
      "react-hooks/purity": "warn" // 1
    }
  },
  {
    files: ["{src,scripts}/**/*.{test,spec}.{ts,tsx}"],
    languageOptions: { parser: tsParser, sourceType: "module" },
    plugins: { wiseeff: wiseeffPlugin },
    rules: {
      "wiseeff/no-raw-css-text-assertions": "error"
    }
  }
];
