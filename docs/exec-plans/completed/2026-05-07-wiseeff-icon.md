# WiseEff Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved elastic-path W icon system to WiseEff and use it for favicon, workbench brand, and homepage brand surfaces.

**Architecture:** Store canonical SVG assets in `public/` for browser and documentation use, and create a focused React component in `src/components/WiseEffIcon.tsx` for in-app rendering. Replace the existing lucide/network and Linear-inspired logo entry points with the shared component while keeping layout and visual system unchanged.

**Tech Stack:** Vite, React 19, TypeScript, Vitest, Testing Library, SVG.

---

## File Structure

- Create `public/wiseeff-icon.svg`: full approved elastic-path W mark with gradient container, nodes, and spark.
- Create `public/favicon.svg`: simplified small-size mark with thicker W path and no spark.
- Create `src/components/WiseEffIcon.tsx`: reusable inline SVG React component with `full`, `favicon`, and `mono` variants.
- Create `src/components/WiseEffIcon.test.tsx`: DOM tests for the icon component variants and accessibility behavior.
- Modify `index.html`: add favicon links and theme metadata.
- Modify `src/App.tsx`: replace the workbench sidebar `Network` brand icon with `WiseEffIcon`.
- Modify `src/App.test.tsx`: assert the workbench brand mark uses the WiseEff icon.
- Modify `src/linear-template/LinearTemplateHome.tsx`: replace `LinearLogo` internals/usages with the new WiseEff icon component.
- Modify `src/linear-template/lightHomepageTheme.test.ts`: update CSS-oriented expectations from `.linear-logo` to the WiseEff icon class where needed.
- Modify `src/styles.css`: keep the existing `.brand-mark` dimensions/shadow and add SVG sizing for `.wiseeff-icon`.
- Modify `src/linear-template/linear-template.css`: update logo sizing selectors to target `.wiseeff-icon`.

## Task 1: Add SVG Assets And Favicon Metadata

**Files:**

- Create: `public/wiseeff-icon.svg`
- Create: `public/favicon.svg`
- Modify: `index.html`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Write failing tests for favicon metadata and SVG assets**

  Add these imports at the top of `src/App.test.tsx` after the existing imports:

  ```tsx
  import { existsSync, readFileSync } from "node:fs";
  ```

  Add this test near the start of `describe("WiseEff app shell", () => {`:

  ```tsx
    it("declares the WiseEff favicon assets in the document shell", () => {
      const indexHtml = readFileSync("index.html", "utf8");

      expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
      expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/wiseeff-icon.svg" />');
      expect(indexHtml).toContain('<meta name="theme-color" content="#003D9B" />');
      expect(existsSync("public/favicon.svg")).toBe(true);
      expect(existsSync("public/wiseeff-icon.svg")).toBe(true);

      const favicon = readFileSync("public/favicon.svg", "utf8");
      const fullIcon = readFileSync("public/wiseeff-icon.svg", "utf8");

      expect(favicon).toContain('aria-label="WiseEff favicon"');
      expect(favicon).toContain("#003D9B");
      expect(favicon).toContain("stroke-linecap=\"round\"");
      expect(favicon).not.toContain("wiseeff-icon-spark");

      expect(fullIcon).toContain('aria-label="WiseEff elastic path W icon"');
      expect(fullIcon).toContain("wiseeff-icon-spark");
      expect(fullIcon).toContain("#50DCFF");
    });
  ```

- [ ] **Step 2: Run the targeted test and verify it fails**

  Run:

  ```bash
  npm test -- src/App.test.tsx --runInBand
  ```

  Expected: FAIL because `public/favicon.svg`, `public/wiseeff-icon.svg`, and favicon links do not exist yet. If Vitest rejects `--runInBand`, run `npm test -- src/App.test.tsx` instead and expect the same failure.

- [ ] **Step 3: Create `public/wiseeff-icon.svg`**

  Create `public/wiseeff-icon.svg` with:

  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260" role="img" aria-label="WiseEff elastic path W icon">
    <defs>
      <linearGradient id="wiseeff-icon-bg" x1="24" y1="22" x2="236" y2="240" gradientUnits="userSpaceOnUse">
        <stop stop-color="#003D9B" />
        <stop offset="0.56" stop-color="#0052CC" />
        <stop offset="1" stop-color="#00687B" />
      </linearGradient>
      <linearGradient id="wiseeff-icon-path" x1="60" y1="106" x2="202" y2="158" gradientUnits="userSpaceOnUse">
        <stop stop-color="#FFFFFF" />
        <stop offset="0.58" stop-color="#E9F9FF" />
        <stop offset="1" stop-color="#50DCFF" />
      </linearGradient>
    </defs>
    <rect x="30" y="30" width="200" height="200" rx="48" fill="url(#wiseeff-icon-bg)" />
    <path d="M59 112C70 164 82 188 102 184C119 181 118 127 138 118C161 108 156 181 176 180C197 179 204 136 208 94" fill="none" stroke="url(#wiseeff-icon-path)" stroke-width="22" stroke-linecap="round" />
    <path d="M59 112C70 164 82 188 102 184C119 181 118 127 138 118C161 108 156 181 176 180C197 179 204 136 208 94" fill="none" stroke="#FFFFFF" stroke-opacity="0.24" stroke-width="7" stroke-linecap="round" />
    <circle cx="138" cy="118" r="10" fill="#50DCFF" />
    <circle cx="176" cy="180" r="7" fill="#FFFFFF" />
    <path class="wiseeff-icon-spark" d="M184 58L190 73L205 79L190 85L184 100L178 85L163 79L178 73Z" fill="#FFFFFF" />
  </svg>
  ```

- [ ] **Step 4: Create `public/favicon.svg`**

  Create `public/favicon.svg` with:

  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" role="img" aria-label="WiseEff favicon">
    <rect width="40" height="40" rx="10" fill="#003D9B" />
    <path d="M8 16C10 28 14 31 17 30C20 29 20 18 23 17C27 15 27 30 31 29C34 29 35 22 36 14" fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" />
    <circle cx="23" cy="17" r="2.3" fill="#50DCFF" />
  </svg>
  ```

- [ ] **Step 5: Add favicon metadata to `index.html`**

  Change the `<head>` in `index.html` to include the icon links immediately after the viewport meta:

  ```html
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="theme-color" content="#003D9B" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <link rel="apple-touch-icon" href="/wiseeff-icon.svg" />
      <title>智效 WiseEff</title>
  ```

- [ ] **Step 6: Run the targeted test and verify it passes**

  Run:

  ```bash
  npm test -- src/App.test.tsx
  ```

  Expected: PASS for the new favicon asset test and existing app shell tests.

- [ ] **Step 7: Commit Task 1**

  ```bash
  git add index.html public/favicon.svg public/wiseeff-icon.svg src/App.test.tsx
  git commit -m "feat: add WiseEff icon assets"
  ```

## Task 2: Create Reusable WiseEff Icon Component

**Files:**

- Create: `src/components/WiseEffIcon.tsx`
- Create: `src/components/WiseEffIcon.test.tsx`

- [ ] **Step 1: Write failing component tests**

  Create `src/components/WiseEffIcon.test.tsx`:

  ```tsx
  import { render, screen } from "@testing-library/react";
  import { describe, expect, it } from "vitest";
  import { WiseEffIcon } from "./WiseEffIcon";

  describe("WiseEffIcon", () => {
    it("renders the full elastic-path W mark with accessible title", () => {
      render(<WiseEffIcon title="WiseEff brand icon" />);

      const icon = screen.getByRole("img", { name: "WiseEff brand icon" });

      expect(icon).toHaveClass("wiseeff-icon");
      expect(icon).toHaveAttribute("viewBox", "0 0 260 260");
      expect(icon.querySelector(".wiseeff-icon-spark")).toBeInTheDocument();
      expect(icon.querySelector(".wiseeff-icon-node-primary")).toBeInTheDocument();
      expect(icon.querySelector(".wiseeff-icon-node-secondary")).toBeInTheDocument();
    });

    it("renders a compact favicon variant without the spark", () => {
      render(<WiseEffIcon variant="favicon" title="WiseEff favicon icon" />);

      const icon = screen.getByRole("img", { name: "WiseEff favicon icon" });

      expect(icon).toHaveAttribute("viewBox", "0 0 40 40");
      expect(icon.querySelector(".wiseeff-icon-spark")).not.toBeInTheDocument();
      expect(icon.querySelector(".wiseeff-icon-node-secondary")).not.toBeInTheDocument();
      expect(icon.querySelector(".wiseeff-icon-node-primary")).toBeInTheDocument();
    });

    it("hides decorative icons from assistive technology", () => {
      const { container } = render(<WiseEffIcon decorative />);
      const svg = container.querySelector("svg");

      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).not.toHaveAttribute("role");
      expect(svg?.querySelector("title")).not.toBeInTheDocument();
    });

    it("renders a single-color mark for monochrome contexts", () => {
      render(<WiseEffIcon variant="mono" title="WiseEff monochrome icon" />);

      const icon = screen.getByRole("img", { name: "WiseEff monochrome icon" });

      expect(icon.querySelector(".wiseeff-icon-container")).toHaveAttribute("fill", "none");
      expect(icon.querySelector(".wiseeff-icon-container")).toHaveAttribute("stroke", "currentColor");
      expect(icon.querySelector(".wiseeff-icon-path")).toHaveAttribute("stroke", "currentColor");
      expect(icon.querySelector(".wiseeff-icon-spark")).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run the component test and verify it fails**

  Run:

  ```bash
  npm test -- src/components/WiseEffIcon.test.tsx
  ```

  Expected: FAIL with module not found for `./WiseEffIcon`.

- [ ] **Step 3: Implement `src/components/WiseEffIcon.tsx`**

  Create `src/components/WiseEffIcon.tsx`:

  ```tsx
  import type { SVGProps } from "react";

  type WiseEffIconVariant = "full" | "favicon" | "mono";

  type WiseEffIconProps = Omit<SVGProps<SVGSVGElement>, "role"> & {
    decorative?: boolean;
    title?: string;
    variant?: WiseEffIconVariant;
  };

  export function WiseEffIcon({
    decorative = false,
    title = "WiseEff icon",
    variant = "full",
    className,
    ...props
  }: WiseEffIconProps) {
    const classes = ["wiseeff-icon", `wiseeff-icon-${variant}`, className].filter(Boolean).join(" ");
    const accessibilityProps = decorative
      ? { "aria-hidden": true }
      : {
          role: "img",
          "aria-label": title
        };

    if (variant === "favicon") {
      return (
        <svg viewBox="0 0 40 40" className={classes} {...accessibilityProps} {...props}>
          {!decorative ? <title>{title}</title> : null}
          <rect className="wiseeff-icon-container" width="40" height="40" rx="10" fill="#003D9B" />
          <path
            className="wiseeff-icon-path"
            d="M8 16C10 28 14 31 17 30C20 29 20 18 23 17C27 15 27 30 31 29C34 29 35 22 36 14"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <circle className="wiseeff-icon-node-primary" cx="23" cy="17" r="2.3" fill="#50DCFF" />
        </svg>
      );
    }

    if (variant === "mono") {
      return (
        <svg viewBox="0 0 260 260" className={classes} {...accessibilityProps} {...props}>
          {!decorative ? <title>{title}</title> : null}
          <rect
            className="wiseeff-icon-container"
            x="30"
            y="30"
            width="200"
            height="200"
            rx="48"
            fill="none"
            stroke="currentColor"
            strokeWidth="14"
          />
          <path
            className="wiseeff-icon-path"
            d="M59 112C70 164 82 188 102 184C119 181 118 127 138 118C161 108 156 181 176 180C197 179 204 136 208 94"
            fill="none"
            stroke="currentColor"
            strokeWidth="22"
            strokeLinecap="round"
          />
          <circle className="wiseeff-icon-node-primary" cx="138" cy="118" r="10" fill="currentColor" />
        </svg>
      );
    }

    return (
      <svg viewBox="0 0 260 260" className={classes} {...accessibilityProps} {...props}>
        {!decorative ? <title>{title}</title> : null}
        <defs>
          <linearGradient id="wiseeff-component-bg" x1="24" y1="22" x2="236" y2="240" gradientUnits="userSpaceOnUse">
            <stop stopColor="#003D9B" />
            <stop offset="0.56" stopColor="#0052CC" />
            <stop offset="1" stopColor="#00687B" />
          </linearGradient>
          <linearGradient id="wiseeff-component-path" x1="60" y1="106" x2="202" y2="158" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" />
            <stop offset="0.58" stopColor="#E9F9FF" />
            <stop offset="1" stopColor="#50DCFF" />
          </linearGradient>
        </defs>
        <rect
          className="wiseeff-icon-container"
          x="30"
          y="30"
          width="200"
          height="200"
          rx="48"
          fill="url(#wiseeff-component-bg)"
        />
        <path
          className="wiseeff-icon-path"
          d="M59 112C70 164 82 188 102 184C119 181 118 127 138 118C161 108 156 181 176 180C197 179 204 136 208 94"
          fill="none"
          stroke="url(#wiseeff-component-path)"
          strokeWidth="22"
          strokeLinecap="round"
        />
        <path
          className="wiseeff-icon-path-highlight"
          d="M59 112C70 164 82 188 102 184C119 181 118 127 138 118C161 108 156 181 176 180C197 179 204 136 208 94"
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.24"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <circle className="wiseeff-icon-node-primary" cx="138" cy="118" r="10" fill="#50DCFF" />
        <circle className="wiseeff-icon-node-secondary" cx="176" cy="180" r="7" fill="#FFFFFF" />
        <path
          className="wiseeff-icon-spark"
          d="M184 58L190 73L205 79L190 85L184 100L178 85L163 79L178 73Z"
          fill="#FFFFFF"
        />
      </svg>
    );
  }
  ```

- [ ] **Step 4: Run the component test and verify it passes**

  Run:

  ```bash
  npm test -- src/components/WiseEffIcon.test.tsx
  ```

  Expected: PASS.

- [ ] **Step 5: Commit Task 2**

  ```bash
  git add src/components/WiseEffIcon.tsx src/components/WiseEffIcon.test.tsx
  git commit -m "feat: add WiseEff icon component"
  ```

## Task 3: Replace Workbench And Homepage Brand Marks

**Files:**

- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/linear-template/LinearTemplateHome.tsx`
- Modify: `src/linear-template/lightHomepageTheme.test.ts`
- Modify: `src/linear-template/linear-template.css`

- [ ] **Step 1: Write failing tests for brand mark usage**

  In `src/App.test.tsx`, add this assertion inside `it("keeps the WiseEff workbench shell on non-home routes", () => {` after `render(<App />);`:

  ```tsx
      const workbenchBrand = document.querySelector(".brand-mark .wiseeff-icon");
      expect(workbenchBrand).toBeInTheDocument();
      expect(workbenchBrand).toHaveAttribute("aria-hidden", "true");
  ```

  In `src/App.test.tsx`, add these assertions inside `it("renders the localized WiseEff homepage on the home route", () => {` after the `homeRoot` assertions:

  ```tsx
      expect(homeRoot?.querySelector(".linear-logo-link .wiseeff-icon")).toBeInTheDocument();
      expect(homeRoot?.querySelector(".linear-logo-link .wiseeff-icon-spark")).toBeInTheDocument();
  ```

  In `src/linear-template/lightHomepageTheme.test.ts`, change the final test to:

  ```tsx
    it("keeps the Agent card emblem visually anchored inside the card", () => {
      const logoMock = getCssRule(".linear-logo-light-mock");
      const logo = getCssRule(".linear-logo-light-mock .wiseeff-icon");

      expect(logoMock).toContain("top: -36px");
      expect(logo).toContain("top: 88px");
    });
  ```

- [ ] **Step 2: Run targeted tests and verify they fail**

  Run:

  ```bash
  npm test -- src/App.test.tsx src/linear-template/lightHomepageTheme.test.ts
  ```

  Expected: FAIL because the app still renders `Network` and `.linear-logo`, not `.wiseeff-icon`.

- [ ] **Step 3: Update `src/App.tsx` imports**

  Remove `Network` from the `lucide-react` import list.

  Add this import after the React imports:

  ```tsx
  import { WiseEffIcon } from "./components/WiseEffIcon";
  ```

- [ ] **Step 4: Update the workbench sidebar brand mark**

  Replace the existing brand mark in `Sidebar`:

  ```tsx
        <div className="brand-mark">
          <Network size={19} />
        </div>
  ```

  with:

  ```tsx
        <div className="brand-mark">
          <WiseEffIcon decorative />
        </div>
  ```

- [ ] **Step 5: Update `src/styles.css` SVG sizing**

  Add this rule after the existing `.brand-mark` rule:

  ```css
  .brand-mark .wiseeff-icon {
    width: 36px;
    height: 36px;
    display: block;
  }
  ```

- [ ] **Step 6: Update homepage component import**

  In `src/linear-template/LinearTemplateHome.tsx`, add:

  ```tsx
  import { WiseEffIcon } from "../components/WiseEffIcon";
  ```

  Keep existing imports unchanged otherwise.

- [ ] **Step 7: Replace `LinearLogo` implementation**

  Replace:

  ```tsx
  function LinearLogo() {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true" className="linear-logo">
        <circle cx="50" cy="50" r="48" />
        <path d="M24 62 62 24h14L38 62H24Zm0 16 54-54v12L36 78H24Zm24 0 30-30v14L62 78H48Z" />
      </svg>
    );
  }
  ```

  with:

  ```tsx
  function LinearLogo() {
    return <WiseEffIcon decorative className="linear-logo" />;
  }
  ```

- [ ] **Step 8: Update homepage logo CSS selectors**

  In `src/linear-template/linear-template.css`, keep the `.linear-logo` sizing rule:

  ```css
  .linear-logo {
    width: 18px;
    height: 18px;
    flex: none;
  }
  ```

  Remove these obsolete shape-fill rules:

  ```css
  .linear-logo circle {
    fill: var(--linear-primary-blue);
  }

  .linear-logo path {
    fill: #ffffff;
  }
  ```

  Change:

  ```css
  .linear-logo-light-mock .linear-logo {
  ```

  to:

  ```css
  .linear-logo-light-mock .wiseeff-icon {
  ```

  Keep the declarations inside that rule unchanged.

  Change:

  ```css
  .linear-footer-brand .linear-logo {
  ```

  to:

  ```css
  .linear-footer-brand .wiseeff-icon {
  ```

  Keep the declarations inside that rule unchanged.

- [ ] **Step 9: Run targeted tests and verify they pass**

  Run:

  ```bash
  npm test -- src/App.test.tsx src/linear-template/lightHomepageTheme.test.ts
  ```

  Expected: PASS.

- [ ] **Step 10: Commit Task 3**

  ```bash
  git add src/App.tsx src/App.test.tsx src/styles.css src/linear-template/LinearTemplateHome.tsx src/linear-template/lightHomepageTheme.test.ts src/linear-template/linear-template.css
  git commit -m "feat: use WiseEff icon in brand surfaces"
  ```

## Task 4: Verify Visual Output And Production Build

**Files:**

- No planned source changes unless verification reveals a concrete issue.

- [ ] **Step 1: Run the full test suite**

  Run:

  ```bash
  npm test
  ```

  Expected: PASS.

- [ ] **Step 2: Run the production build**

  Run:

  ```bash
  npm run build
  ```

  Expected: PASS and Vite build output in `dist/`.

- [ ] **Step 3: Start the dev server**

  Run:

  ```bash
  npm run dev -- --port 5173
  ```

  Expected: Vite prints a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 4: Inspect desktop homepage and workbench**

  Open `http://127.0.0.1:5173/` and `http://127.0.0.1:5173/parameters`.

  Verify:

  - Browser tab uses the WiseEff favicon.
  - Homepage header logo shows the elastic-path W, not the old Linear-inspired mark.
  - Workbench sidebar brand mark shows the same icon.
  - Icon remains crisp at the 18 px homepage header size and 36 px workbench size.
  - No text overlaps around the logo.

- [ ] **Step 5: Inspect mobile width**

  In browser responsive mode or Playwright, inspect widths around 390 px.

  Verify:

  - Homepage header logo remains visible.
  - Mobile nav button does not overlap the brand.
  - Workbench sidebar brand mark remains contained if the route is viewed in a narrow viewport.

- [ ] **Step 6: Commit any verification fixes**

  If visual verification required code or CSS changes, commit them:

  ```bash
  git add <changed-files>
  git commit -m "fix: polish WiseEff icon rendering"
  ```

  If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: The plan creates full and favicon SVG assets, adds browser favicon metadata, builds a reusable React component with full/favicon/mono variants, updates the workbench and homepage brand entry points, and includes visual checks at small and app sizes.
- Scope control: The plan does not redesign navigation, homepage layout, or the broader design system.
- Placeholder scan: The plan includes concrete file paths, code snippets, commands, and expected outcomes for each step.
- Type consistency: `WiseEffIcon` props and variants are defined in Task 2 and used consistently in Task 3.
