# ADR-0026: Design tokens are the single visual source

- Status: Accepted
- Date: 2026-08-12

## Context

The 2026-08-12 frontend aesthetics audit found two disconnected palettes answering the same questions (shadcn oklch keys vs handwritten brand tokens, so the two button systems rendered different primary colors), a 10.8% token penetration rate across 16,578 declarations in `src/styles.css`, 669 distinct color literals, 26 `var()` references to tokens that were never defined, and no scales at all for type, spacing, motion, or elevation. Every new surface invented its own values, which is why the product could not converge on one visual language.

## Decision

The single `:root` token block in `src/styles.css` is the **only** place raw visual literals (colors, radii, shadows, z-index layers, font sizes, durations/easings) may appear. Everything else consumes `var()` or `color-mix()` over those tokens. The shadcn/Tailwind `@theme inline` keys alias the same semantic tokens — there is one palette, with the brand blue family (`--accent`, `#0052cc` / pressed `#003d9b`) as the only interactive accent. Fonts are self-hosted only: `--font-sans` is Geist Variable with a CJK system fallback chain, `--font-mono` is one shared mono stack, and weights are limited to 400/500/600/700. Authoritative scale values live in `docs/design-docs/ui-design-system.md`; token changes must update that document in the same change.

## Consequences

- New CSS carrying raw visual literals outside the token block is a defect; phase P4 of `docs/exec-plans/completed/2026-08-12-frontend-aesthetics-uplift.md` added the `ui:check` CI gate that fails on them.
- Legacy literals migrate to tokens phase by phase (not big-bang); legacy token names bridge to semantic tokens via same-value aliases so history stays reviewable.
- Style contracts in tests assert token structure through `src/test/cssAssertions.ts` instead of regexing CSS source text, so tokenization refactors no longer break tests by formatting.
- The shadcn `.dark` block predates this decision and still overrides `--accent` with grayscale values; it must be re-derived from the semantic tokens before any dark-mode work ships (tracked in the uplift plan, phase P3).
