/*
 * ESLint flat config (FA-24): jsx-a11y + react-hooks over src/**\/*.{ts,tsx}.
 *
 * Grading model (2026-08-13 census, `npx eslint src` on this commit):
 *   - rules with zero violations run at "error" (new debt is blocked),
 *   - rules with existing stock run at "warn" with the census count recorded
 *     next to them, so later waves can ratchet them to "error" as the stock
 *     burns down (same ratchet spirit as `npm run ui:check`).
 * Test files are included on purpose: they currently contribute one warning
 * (react-hooks/refs) and zero error-level findings.
 *
 * `npm run lint` fails on errors only; warnings do not block.
 */
import tsParser from "@typescript-eslint/parser";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

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

      // Existing stock (count on 2026-08-13); burn down, then promote to "error".
      "jsx-a11y/label-has-associated-control": "warn", // 27
      "jsx-a11y/no-redundant-roles": "warn", // 12
      "jsx-a11y/no-noninteractive-tabindex": "warn", // 11
      "jsx-a11y/no-noninteractive-element-to-interactive-role": "warn", // 9
      "jsx-a11y/no-autofocus": "warn", // 7
      "jsx-a11y/no-noninteractive-element-interactions": "warn", // 3
      "jsx-a11y/no-static-element-interactions": "warn", // 2
      "jsx-a11y/interactive-supports-focus": "warn", // 2
      "jsx-a11y/no-interactive-element-to-noninteractive-role": "warn", // 1
      "jsx-a11y/role-has-required-aria-props": "warn", // 1
      "jsx-a11y/role-supports-aria-props": "warn", // 1
      "jsx-a11y/anchor-is-valid": "warn", // 1
      "react-hooks/set-state-in-effect": "warn", // 135
      "react-hooks/refs": "warn", // 32 (31 prod + 1 test)
      "react-hooks/preserve-manual-memoization": "warn", // 25
      "react-hooks/exhaustive-deps": "warn", // 23
      "react-hooks/rules-of-hooks": "warn", // 3 — correctness rule; clear these first
      "react-hooks/immutability": "warn", // 1
      "react-hooks/purity": "warn" // 1
    }
  }
];
