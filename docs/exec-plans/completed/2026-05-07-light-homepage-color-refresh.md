# Light Homepage Color Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the WiseEff homepage from a dark Linear-style presentation into a light, workbench-adjacent homepage with a softened ink-blue focus panel.

**Architecture:** Keep the homepage isolated inside `src/linear-template`. Add explicit light-home theme hooks in `LinearTemplateHome.tsx`, then update scoped CSS so the page foundation, header, proof strip, product sections, and footer become light while the hero main preview uses a slate/ink-blue focus panel. Protect the change with CSS regression tests plus a DOM-level homepage shell assertion.

**Tech Stack:** React 19, TypeScript, Vite, plain scoped CSS, Vitest, Testing Library, Playwright or the Codex Browser plugin for visual QA.

---

## Current Worktree Note

The working tree already contains unrelated or pre-existing uncommitted changes, including the current untracked `src/linear-template/` homepage module and `public/linear-template/` assets. Do not revert those changes. When committing implementation work, stage only the files touched for this feature and inspect `git diff --cached --name-status` before each commit.

## File Structure

- Modify `src/linear-template/LinearTemplateHome.tsx`: add a stable light theme hook to the homepage root. Keep the current content, carousel behavior, and route links unchanged unless a class hook is needed.
- Modify `src/linear-template/linear-template.css`: replace the dark global Linear palette with a light foundation; soften header, hero, proof strip, feature cards, product sections, previews, footer, and mobile menu; keep animation names and carousel behavior stable.
- Create `src/linear-template/lightHomepageTheme.test.ts`: CSS regression tests for the light foundation and ink-blue focus panel.
- Modify `src/App.test.tsx`: add a DOM assertion that the home route renders the light theme hook while non-home workbench chrome remains unchanged.

## Task 1: Add CSS Regression Tests

**Files:**
- Create: `src/linear-template/lightHomepageTheme.test.ts`

- [ ] **Step 1: Create the failing CSS theme test file**

Add this file:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const cssText = readFileSync("src/linear-template/linear-template.css", "utf8");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCssRule(selector: string) {
  const match = cssText.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "s"));
  if (!match) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return match[1];
}

describe("WiseEff light homepage theme", () => {
  it("defines a light page foundation instead of a dark Linear background", () => {
    const root = getCssRule(".linear-template-home");
    const page = getCssRule(".linear-page-gradient");

    expect(root).toContain("--linear-bg: #fbfcff");
    expect(root).toContain("--linear-surface: #ffffff");
    expect(root).toContain("--linear-soft-surface: #f0f3ff");
    expect(root).toContain("--linear-ink-panel: #172033");
    expect(root).not.toContain("--linear-bg: #000212");
    expect(page).toContain("#fbfcff");
    expect(page).toContain("#edf4ff");
    expect(page).not.toContain("var(--linear-bg)");
  });

  it("keeps dark color limited to the softened hero focus panel", () => {
    const heroShell = getCssRule(".linear-hero-image-shell");
    const stageRail = getCssRule(".wiseeff-stage-rail");
    const stageMain = getCssRule(".wiseeff-stage-main");
    const boundaryPanel = getCssRule(".wiseeff-boundary-panel");

    expect(heroShell).toContain("rgba(255, 255, 255, 0.84)");
    expect(stageRail).toContain("#f5f8ff");
    expect(stageMain).toContain("#22304a");
    expect(stageMain).toContain("#172033");
    expect(stageMain).not.toContain("#050718");
    expect(boundaryPanel).toContain("#f5f8ff");
  });

  it("uses light surfaces for proof, feature, product, and footer sections", () => {
    expect(getCssRule(".linear-proof-grid > div")).toContain("#ffffff");
    expect(getCssRule(".linear-unlike")).toContain("#101c2d");
    expect(getCssRule(".linear-tool-card")).toContain("#ffffff");
    expect(getCssRule(".linear-product-section")).toContain("#fbfcff");
    expect(getCssRule(".wiseeff-preview")).toContain("#ffffff");
    expect(getCssRule(".linear-feature-card")).toContain("#ffffff");
    expect(getCssRule(".linear-footer")).toContain("#ffffff");
  });
});
```

- [ ] **Step 2: Run the new CSS tests to verify RED**

Run:

```bash
npm test -- src/linear-template/lightHomepageTheme.test.ts
```

Expected: FAIL. The current CSS still defines `--linear-bg: #000212`, the page gradient uses the dark variable, and the hero/product sections still use dark backgrounds.

- [ ] **Step 3: Commit nothing yet**

Do not commit the failing test alone. Keep it staged only after the implementation in later tasks passes.

## Task 2: Add A Stable Light Theme Hook

**Files:**
- Modify: `src/linear-template/LinearTemplateHome.tsx`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add a failing DOM assertion to the homepage shell test**

In `src/App.test.tsx`, inside the existing test named `renders the localized WiseEff homepage on the home route`, add these assertions after `render(<App />);`:

```tsx
    const homeRoot = document.querySelector(".linear-template-home");
    expect(homeRoot).toBeInTheDocument();
    expect(homeRoot).toHaveClass("light-homepage");
    expect(homeRoot).toHaveAttribute("data-theme", "light");
```

- [ ] **Step 2: Run the focused home test to verify RED**

Run:

```bash
npm test -- src/App.test.tsx -t "renders the localized WiseEff homepage on the home route"
```

Expected: FAIL because `.linear-template-home` does not yet have the `light-homepage` class or `data-theme="light"`.

- [ ] **Step 3: Add the light theme hook**

In `src/linear-template/LinearTemplateHome.tsx`, change the homepage root:

```tsx
export function LinearTemplateHome() {
  return (
    <div className="linear-template-home light-homepage" data-theme="light">
      <TemplateHeader />
      <main className="linear-page-gradient" aria-label="WiseEff homepage">
```

Leave the rest of the component unchanged.

- [ ] **Step 4: Run the focused home test to verify GREEN**

Run:

```bash
npm test -- src/App.test.tsx -t "renders the localized WiseEff homepage on the home route"
```

Expected: PASS.

## Task 3: Convert The Page Foundation, Header, Hero, And Footer To Light

**Files:**
- Modify: `src/linear-template/linear-template.css`

- [ ] **Step 1: Replace the root theme variables**

Replace the `.linear-template-home` rule with this version:

```css
.linear-template-home {
  --linear-bg: #fbfcff;
  --linear-white: #ffffff;
  --linear-off-white: #101c2d;
  --linear-primary-text: #566070;
  --linear-grey: #6b7280;
  --linear-grey-dark: #dfe5f3;
  --linear-transparent-white: rgba(16, 28, 45, 0.1);
  --linear-surface: #ffffff;
  --linear-soft-surface: #f0f3ff;
  --linear-surface-high: #d7e3fb;
  --linear-ink-panel: #172033;
  --linear-ink-panel-top: #22304a;
  --linear-primary-blue: #003d9b;
  --linear-cyan: #00687b;
  --linear-shadow-soft: 0 18px 48px rgba(16, 28, 45, 0.08);
  --linear-shadow-stage: 0 28px 70px rgba(33, 65, 110, 0.14);
  --linear-nav-height: 64px;
  min-height: 100vh;
  width: 100%;
  overflow-x: clip;
  background: var(--linear-bg);
  color: var(--linear-off-white);
  font-family:
    "SF Pro Display",
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Oxygen,
    Ubuntu,
    Cantarell,
    "Open Sans",
    "Helvetica Neue",
    sans-serif;
  letter-spacing: 0;
}
```

- [ ] **Step 2: Replace the page gradient**

Replace `.linear-page-gradient` with:

```css
.linear-page-gradient {
  min-height: 100vh;
  padding-top: var(--linear-nav-height);
  background:
    radial-gradient(ellipse 72% 42% at 50% -12%, rgba(49, 87, 255, 0.14), transparent),
    radial-gradient(circle at 72% 8%, rgba(80, 220, 255, 0.12), transparent 30%),
    linear-gradient(180deg, #fbfcff 0%, #edf4ff 56%, #fbfcff 100%);
}
```

- [ ] **Step 3: Replace header and navigation colors**

Update these rules:

```css
.linear-header {
  position: fixed;
  inset: 0 0 auto;
  z-index: 50;
  border-bottom: 1px solid rgba(90, 115, 160, 0.16);
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(16px);
}

.linear-logo-link,
.linear-footer-brand > div:first-child {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #101c2d;
  font-size: 14px;
  font-weight: 700;
}

.linear-logo circle {
  fill: var(--linear-primary-blue);
}

.linear-logo path {
  fill: #ffffff;
}

.linear-nav a,
.linear-login {
  color: #566070;
  font-size: 14px;
  transition: color 180ms ease;
}

.linear-nav a:hover,
.linear-login:hover,
.linear-footer a:hover {
  color: var(--linear-primary-blue);
}
```

- [ ] **Step 4: Replace button and hero text styling**

Update the button and heading rules:

```css
.linear-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px solid rgba(0, 61, 155, 0.18);
  border-radius: 999px;
  background: var(--linear-primary-blue);
  box-shadow: 0 12px 28px rgba(0, 61, 155, 0.18);
  color: #ffffff;
  font-weight: 700;
  white-space: nowrap;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    background 180ms ease,
    box-shadow 180ms ease;
}

.linear-button:hover {
  transform: translateY(-1px);
  border-color: rgba(0, 61, 155, 0.28);
  background: #0052cc;
  box-shadow: 0 16px 32px rgba(0, 61, 155, 0.2);
}

.linear-button.secondary {
  background: rgba(255, 255, 255, 0.72);
  color: var(--linear-primary-blue);
  border-color: rgba(0, 61, 155, 0.16);
  box-shadow: 0 10px 24px rgba(16, 28, 45, 0.06);
}

.linear-hero h1,
.linear-section-heading h2,
.linear-feature-main h2 {
  margin: 24px 0;
  background: none;
  background-clip: border-box;
  color: #101c2d;
  font-weight: 700;
  line-height: 1.08;
  letter-spacing: 0;
}

.linear-hero-subtitle {
  margin: 0 0 48px;
  color: #566070;
  font-size: clamp(18px, 2vw, 22px);
  line-height: 1.45;
}
```

- [ ] **Step 5: Convert the footer to a light surface**

Replace footer rules with:

```css
.linear-footer {
  border-top: 1px solid rgba(90, 115, 160, 0.16);
  background: #ffffff;
  padding: 56px 0;
  color: #101c2d;
  font-size: 14px;
}

.linear-footer h3 {
  margin: 0 0 12px;
  color: #101c2d;
  font-size: 14px;
  font-weight: 700;
}

.linear-footer a {
  color: #6b7280;
  transition: color 180ms ease;
}
```

- [ ] **Step 6: Run the CSS tests**

Run:

```bash
npm test -- src/linear-template/lightHomepageTheme.test.ts
```

Expected: Still FAIL until hero stage and product sections are converted in the next tasks.

## Task 4: Soften The Hero Product Stage To A2/V2

**Files:**
- Modify: `src/linear-template/linear-template.css`

- [ ] **Step 1: Replace the hero image shell and glow**

Update these rules:

```css
.linear-hero-image-shell {
  position: relative;
  margin-top: 128px;
  overflow: hidden;
  border: 1px solid rgba(90, 115, 160, 0.18);
  border-radius: 18px;
  background:
    radial-gradient(ellipse 60% 70% at 28% 30%, rgba(49, 87, 255, 0.1), transparent),
    rgba(255, 255, 255, 0.84);
  box-shadow: var(--linear-shadow-stage);
  transform: rotateX(25deg);
  transform-origin: center top;
  animation: linearImageRotate 1400ms 600ms ease forwards;
  perspective: 2000px;
}

.linear-hero-glow {
  position: absolute;
  inset: -20%;
  background:
    radial-gradient(circle at 42% 34%, rgba(49, 87, 255, 0.18), transparent 36%),
    radial-gradient(circle at 70% 62%, rgba(80, 220, 255, 0.14), transparent 34%);
  filter: blur(54px);
  opacity: 0;
  animation: linearImageGlow 4100ms 900ms ease-out forwards;
}
```

- [ ] **Step 2: Replace arrow styling so controls work on light backgrounds**

Update arrow rules:

```css
.wiseeff-stage-arrow {
  position: absolute;
  top: 260px;
  z-index: 6;
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border: 1px solid rgba(90, 115, 160, 0.2);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 18px 40px rgba(16, 28, 45, 0.12);
  color: #22304a;
  cursor: pointer;
  transform: translateY(-50%);
  transition:
    border-color 180ms ease,
    background 180ms ease,
    color 180ms ease,
    transform 180ms ease;
  backdrop-filter: blur(16px);
}

.wiseeff-stage-arrow:hover {
  border-color: rgba(0, 61, 155, 0.28);
  background: #ffffff;
  color: var(--linear-primary-blue);
}

.wiseeff-stage-arrow:focus-visible {
  outline: 2px solid rgba(0, 82, 204, 0.52);
  outline-offset: 4px;
}
```

- [ ] **Step 3: Split and replace the stage panel rules**

Replace the grouped `.wiseeff-stage-rail, .wiseeff-stage-main, .wiseeff-boundary-panel` rule and related colors with these explicit rules:

```css
.wiseeff-stage-frame {
  position: relative;
  z-index: 3;
  display: grid;
  height: 520px;
  grid-template-columns: 170px minmax(0, 1fr) 280px;
  gap: 18px;
  padding: 26px;
  opacity: 1;
  will-change: opacity, transform;
}

.wiseeff-stage-rail,
.wiseeff-boundary-panel {
  border: 1px solid rgba(90, 115, 160, 0.14);
  border-radius: 18px;
  background: #f5f8ff;
  box-shadow: 0 18px 38px rgba(16, 28, 45, 0.06);
}

.wiseeff-stage-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(94, 117, 156, 0.36);
  border-radius: 18px;
  background:
    radial-gradient(circle at 18% 18%, rgba(125, 211, 252, 0.16), transparent 34%),
    linear-gradient(180deg, #22304a 0%, #172033 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 24px 58px rgba(23, 32, 51, 0.22);
  backdrop-filter: blur(16px);
}
```

- [ ] **Step 4: Replace stage rail, toolbar, text, and evidence colors**

Update these rules:

```css
.wiseeff-stage-rail > div {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  border-radius: 12px;
  color: #566070;
  padding: 0 12px;
  font-size: 14px;
}

.wiseeff-stage-rail > div span {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 1px solid rgba(90, 115, 160, 0.16);
  border-radius: 8px;
  color: #6b7280;
  background: #ffffff;
  font-size: 11px;
}

.wiseeff-stage-rail > div.active {
  background: #dbe8ff;
  color: var(--linear-primary-blue);
}

.wiseeff-stage-toolbar,
.wiseeff-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 58px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding: 0 20px;
  color: #d8e2f3;
  font-size: 14px;
}

.wiseeff-stage-toolbar strong,
.wiseeff-preview-header strong {
  color: #ffffff;
  font-weight: 600;
}

.wiseeff-stage-kicker,
.wiseeff-boundary-panel > span {
  color: var(--linear-primary-blue);
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}

.wiseeff-stage-content h2 {
  margin: 14px 0 16px;
  color: #ffffff;
  font-size: clamp(32px, 4vw, 58px);
  font-weight: 650;
  line-height: 1.08;
}

.wiseeff-stage-content p {
  margin: 0;
  color: #d8e2f3;
  font-size: 16px;
  line-height: 1.55;
}

.wiseeff-boundary-panel p {
  margin: 0;
  color: #566070;
  font-size: 16px;
  line-height: 1.55;
}

.wiseeff-evidence-grid div {
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.09);
  padding: 14px;
}

.wiseeff-evidence-grid span {
  display: block;
  margin-bottom: 6px;
  color: rgba(255, 255, 255, 0.56);
  font-size: 12px;
}

.wiseeff-evidence-grid strong {
  display: block;
  overflow-wrap: anywhere;
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
}

.wiseeff-boundary-panel h3 {
  margin: 12px 0 14px;
  color: #101c2d;
  font-size: 28px;
  font-weight: 650;
  line-height: 1.15;
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/linear-template/lightHomepageTheme.test.ts src/linear-template/heroStageAnimation.test.ts
```

Expected: `heroStageAnimation.test.ts` stays PASS because animation names and timing remain unchanged. `lightHomepageTheme.test.ts` may still fail until product sections are converted.

## Task 5: Convert Proof Strip, Agent Cards, Product Sections, Previews, And Feature Cards

**Files:**
- Modify: `src/linear-template/linear-template.css`

- [ ] **Step 1: Convert the proof strip**

Replace proof rules with:

```css
.linear-proof-strip {
  text-align: center;
}

.linear-proof-strip p {
  margin: 0 0 48px;
  color: #101c2d;
  font-size: clamp(18px, 2vw, 22px);
  line-height: 1.45;
}

.linear-proof-strip p span {
  color: #566070;
}

.linear-proof-grid > div {
  min-width: 0;
  border: 1px solid rgba(90, 115, 160, 0.14);
  border-radius: 18px;
  background: #ffffff;
  box-shadow: var(--linear-shadow-soft);
  padding: 22px;
}

.linear-proof-grid strong {
  display: block;
  color: var(--linear-primary-blue);
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.linear-proof-grid span {
  display: block;
  margin-top: 10px;
  color: #101c2d;
  font-size: 15px;
}

.linear-proof-grid small {
  display: block;
  margin-top: 6px;
  color: #566070;
  font-size: 13px;
  line-height: 1.35;
}
```

- [ ] **Step 2: Soften the stars divider**

Replace divider rules that use `var(--linear-bg)` with:

```css
.linear-stars-divider::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at bottom center, rgba(49, 87, 255, 0.16), transparent 70%);
}

.linear-stars-divider::after {
  content: "";
  position: absolute;
  top: 50%;
  left: -50%;
  width: 200%;
  height: 142%;
  border-top: 1px solid rgba(49, 87, 255, 0.16);
  border-radius: 50%;
  background: #fbfcff;
}

.linear-stars span {
  position: absolute;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: rgba(0, 82, 204, 0.28);
  box-shadow: 0 0 12px rgba(80, 220, 255, 0.32);
}
```

- [ ] **Step 3: Convert the Agent differentiator area**

Update section and card rules:

```css
.linear-unlike {
  position: relative;
  z-index: 2;
  color: #101c2d;
}

.linear-section-heading p {
  width: min(680px, 100%);
  margin: 0 auto 72px;
  color: #566070;
  font-size: clamp(18px, 2vw, 22px);
  line-height: 1.45;
}

.linear-tool-card {
  position: relative;
  display: flex;
  min-height: 480px;
  flex: 1 1 calc(33.333% - 16px);
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
  border: 1px solid rgba(90, 115, 160, 0.14);
  border-radius: 48px;
  background:
    radial-gradient(circle at 50% 0%, rgba(49, 87, 255, 0.08), transparent 42%),
    #ffffff;
  box-shadow: var(--linear-shadow-soft);
  padding: 56px;
  text-align: center;
}

.linear-tool-card h3 {
  position: relative;
  z-index: 2;
  margin: 0 0 16px;
  color: #101c2d;
  font-size: clamp(24px, 3vw, 32px);
  font-weight: 650;
  line-height: 1.2;
}

.linear-tool-card p {
  position: relative;
  z-index: 2;
  margin: 0;
  color: #566070;
  font-size: 16px;
  line-height: 1.45;
}
```

- [ ] **Step 4: Convert mock surfaces inside Agent cards**

Update these helper surfaces:

```css
.linear-keyboard-mock span {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 56px;
  border: 1px solid rgba(90, 115, 160, 0.14);
  border-radius: 14px;
  background:
    linear-gradient(180deg, #ffffff, #f5f8ff);
  box-shadow: 0 14px 28px rgba(16, 28, 45, 0.08);
  color: #566070;
}

.linear-command-menu-mock {
  position: absolute;
  top: 52px;
  left: 50%;
  z-index: 1;
  width: min(520px, 78%);
  overflow: hidden;
  border: 1px solid rgba(90, 115, 160, 0.14);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 30px 80px rgba(16, 28, 45, 0.14);
  transform: translateX(-50%);
  text-align: left;
}

.linear-command-input,
.linear-command-menu-mock div:not(.linear-command-input) {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  border-bottom: 1px solid rgba(90, 115, 160, 0.12);
  padding: 0 18px;
  color: #566070;
  font-size: 14px;
}

.linear-command-menu-mock .active {
  background: #dbe8ff;
  color: var(--linear-primary-blue);
}
```

- [ ] **Step 5: Convert product sections and feature previews**

Update product section rules:

```css
.linear-product-section {
  position: relative;
  overflow-x: clip;
  padding: 252px 0 0;
  background: #fbfcff;
  --feature-color: 49, 87, 255;
  --feature-color-dark: 215, 227, 251;
}

.linear-feature-aura {
  position: absolute;
  top: 130px;
  left: 50%;
  width: 100%;
  height: 400px;
  opacity: 0.8;
  pointer-events: none;
  transform: translateX(-50%) rotate(180deg) scale(1.7);
  mask-image: radial-gradient(100% 50% at center center, black, transparent);
  background:
    conic-gradient(from 90deg at 80% 50%, #fbfcff, rgba(var(--feature-color), 0.12)),
    conic-gradient(from 270deg at 20% 50%, rgba(var(--feature-color), 0.12), #fbfcff);
  background-position:
    1% 0,
    99% 0;
  background-repeat: no-repeat;
  background-size: 50% 100%, 50% 100%;
}

.linear-feature-summary p {
  width: min(100%, 560px);
  margin: 56px auto 64px;
  color: #101c2d;
  font-size: clamp(21px, 2vw, 30px);
  line-height: 1.36;
  text-wrap: balance;
}

.linear-feature-summary hr {
  height: 1px;
  margin: 0 0 72px;
  border: 0;
  background: linear-gradient(to right, transparent, rgba(90, 115, 160, 0.18) 50%, transparent);
}

.linear-feature-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 36px 48px;
  margin-bottom: 140px;
  color: #566070;
  font-size: 16px;
  line-height: 1.42;
}

.linear-feature-grid svg {
  width: 18px;
  height: 18px;
  margin-right: 6px;
  margin-bottom: 2px;
  vertical-align: text-bottom;
  fill: none;
  stroke: var(--linear-primary-blue);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.linear-feature-grid span {
  color: #101c2d;
}
```

- [ ] **Step 6: Convert preview and bottom feature cards**

Update preview and card rules:

```css
.linear-feature-image-frame {
  position: relative;
  z-index: 1;
  overflow: hidden;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: var(--linear-shadow-stage);
  backdrop-filter: blur(6px);
}

.linear-feature-image-frame::before {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px solid rgba(90, 115, 160, 0.18);
  border-radius: inherit;
  pointer-events: none;
}

.wiseeff-preview {
  position: relative;
  min-height: 430px;
  overflow: hidden;
  background:
    radial-gradient(ellipse at 20% 20%, rgba(var(--feature-color), 0.12), transparent 42%),
    #ffffff;
  color: #101c2d;
  text-align: left;
}

.wiseeff-preview-row {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(96px, 0.8fr) minmax(0, 1.4fr) minmax(100px, 0.8fr);
  gap: 18px;
  align-items: center;
  min-height: 72px;
  margin: 14px 22px;
  border: 1px solid rgba(90, 115, 160, 0.14);
  border-radius: 16px;
  background: #f5f8ff;
  padding: 16px 18px;
}

.wiseeff-preview-row span,
.wiseeff-preview-card span {
  display: block;
  margin-bottom: 6px;
  color: #6b7280;
  font-size: 12px;
}

.wiseeff-preview-row strong,
.wiseeff-preview-card strong {
  display: block;
  overflow-wrap: anywhere;
  color: #101c2d;
  font-size: 14px;
  font-weight: 650;
}

.linear-feature-card {
  position: relative;
  display: flex;
  min-height: 328px;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
  border: 1px solid rgba(90, 115, 160, 0.14);
  border-radius: 40px;
  background:
    linear-gradient(rgba(255, 255, 255, 0), rgba(49, 87, 255, 0.04)),
    #ffffff;
  box-shadow: var(--linear-shadow-soft);
  padding: 44px;
}

.linear-feature-card h3 {
  position: relative;
  z-index: 2;
  margin: 0 0 8px;
  color: #101c2d;
  font-size: 24px;
  font-weight: 650;
}

.linear-feature-card p {
  position: relative;
  z-index: 2;
  max-width: 360px;
  margin: 0;
  color: #566070;
  font-size: 16px;
  line-height: 1.45;
}
```

- [ ] **Step 7: Run CSS tests to verify GREEN**

Run:

```bash
npm test -- src/linear-template/lightHomepageTheme.test.ts
```

Expected: PASS.

## Task 6: Mobile And Reduced-Width Light Theme Adjustments

**Files:**
- Modify: `src/linear-template/linear-template.css`

- [ ] **Step 1: Convert mobile menu background and icon color**

Inside `@media (max-width: 760px)`, update the mobile nav rules:

```css
  .linear-menu-button {
    display: block;
    color: #101c2d;
  }

  .linear-nav {
    position: fixed;
    top: var(--linear-nav-height);
    left: 0;
    width: 100%;
    height: calc(100vh - var(--linear-nav-height));
    margin-left: 0;
    overflow: auto;
    background: #ffffff;
    opacity: 0;
    transform: translateX(-100vw);
    visibility: hidden;
    transition:
      opacity 300ms ease,
      transform 300ms ease,
      visibility 300ms ease;
  }

  .linear-nav li {
    display: block !important;
    margin-left: 24px;
    border-bottom: 1px solid #dfe5f3;
  }
```

- [ ] **Step 2: Keep the ink-blue panel from dominating mobile**

Inside `@media (max-width: 760px)`, add:

```css
  .wiseeff-stage-main {
    min-height: 320px;
  }

  .wiseeff-stage-content {
    padding: 28px;
  }

  .wiseeff-boundary-panel {
    background: #f5f8ff;
  }
```

Inside `@media (max-width: 520px)`, add:

```css
  .wiseeff-stage-main {
    min-height: 300px;
  }

  .wiseeff-stage-content h2 {
    font-size: 30px;
  }
```

- [ ] **Step 3: Run responsive-safe unit tests**

Run:

```bash
npm test -- src/App.test.tsx src/linear-template/heroStageAnimation.test.ts src/linear-template/lightHomepageTheme.test.ts
```

Expected: PASS.

## Task 7: Full Verification And Visual QA

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: TypeScript build and Vite production build pass.

- [ ] **Step 3: Start or reuse the local dev server**

If `http://localhost:5173/` is already serving the app, reuse it. Otherwise run:

```bash
npm run dev -- --port 5173
```

Expected: Vite serves the app on `http://127.0.0.1:5173/` or `http://localhost:5173/`.

- [ ] **Step 4: Browser QA for the homepage**

Use the Codex Browser plugin if it can connect to the in-app browser. If the plugin cannot discover the IAB backend, record that reason and use Playwright from the local environment.

Check `http://localhost:5173/` at desktop width around `1440x1000`:

- The first viewport reads as light, not dark.
- Header is translucent white.
- Hero headline and body are dark text.
- Hero product stage outer shell is light.
- The main hero preview panel is slate/ink-blue, not black.
- Proof strip and long-page sections use light cards.
- No horizontal overflow.

- [ ] **Step 5: Browser QA for mobile**

Check `http://localhost:5173/` at mobile width around `390x844`:

- Header and mobile menu are light.
- Hero text wraps without clipping.
- CTA text fits.
- Product stage stacks cleanly.
- The ink-blue panel does not occupy the whole visible mobile page before context appears.
- No horizontal overflow.

- [ ] **Step 6: Browser QA for workbench continuity**

Check `http://localhost:5173/parameters`:

- Workbench shell still renders with sidebar, topbar, tables, and WiseAgent.
- `.linear-template-home` is absent from the workbench route.
- The transition from home to `/parameters` feels continuous because both use light foundations.

## Task 8: Commit The Implementation

**Files:**
- Stage only implementation files that changed for this feature.

- [ ] **Step 1: Inspect changed files**

Run:

```bash
git status --short
```

Expected: existing unrelated changes may still be present. The intended implementation files are:

```text
src/App.test.tsx
src/linear-template/LinearTemplateHome.tsx
src/linear-template/linear-template.css
src/linear-template/lightHomepageTheme.test.ts
```

- [ ] **Step 2: Review implementation diffs**

Run:

```bash
git diff -- src/App.test.tsx src/linear-template/LinearTemplateHome.tsx src/linear-template/linear-template.css src/linear-template/lightHomepageTheme.test.ts
```

Expected: diff only contains the light homepage theme hook, tests, and CSS color refresh.

- [ ] **Step 3: Stage only implementation files**

Run:

```bash
git add src/App.test.tsx src/linear-template/LinearTemplateHome.tsx src/linear-template/linear-template.css src/linear-template/lightHomepageTheme.test.ts
git diff --cached --name-status
```

Expected staged paths:

```text
M	src/App.test.tsx
M	src/linear-template/LinearTemplateHome.tsx
M	src/linear-template/linear-template.css
A	src/linear-template/lightHomepageTheme.test.ts
```

If `src/linear-template/LinearTemplateHome.tsx` or `src/linear-template/linear-template.css` are still untracked at execution time, Git will show them as `A` instead of `M`; verify their full content belongs to the homepage module before committing.

- [ ] **Step 4: Commit**

Run:

```bash
git commit -m "feat: refresh homepage light color system"
```

Expected: commit succeeds after tests and build have passed.

## Self-Review

Spec coverage:

- Light first viewport: Tasks 3 and 4.
- Softened ink-blue focus panel: Task 4.
- Light proof, sections, previews, and footer: Task 5.
- Workbench unchanged: Task 7 Step 6.
- Responsive behavior: Task 6 and Task 7 Step 5.
- Tests and build: Task 7.

Placeholder scan:

- The plan contains no `TBD`, `TODO`, or open-ended implementation placeholders.

Type and selector consistency:

- The new class hook is `light-homepage`.
- The theme attribute is `data-theme="light"`.
- The CSS regression file reads `src/linear-template/linear-template.css`, matching the existing test pattern in `heroStageAnimation.test.ts`.
