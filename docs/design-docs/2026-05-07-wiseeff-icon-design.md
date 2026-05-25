# WiseEff Icon Design

## Goal

Create a WiseEff icon system that works across three usage levels:

- Browser favicon and other small-size brand surfaces.
- In-app brand mark for the sidebar, header, and future login or launch surfaces.
- README, demo, and presentation materials where the mark appears with the WiseEff wordmark.

The icon should feel native to the current WiseEff prototype: light enterprise software, AI-assisted operational efficiency, and governed workflows across parameters, logs, and debugging.

## Approved Direction

Use the approved A2a direction: an elastic-path W.

The mark uses a rounded blue container and a flowing W-shaped path. The W is deliberately asymmetric, so it reads less like a static letter and more like an intelligent route moving through business nodes. This keeps the WiseEff initial visible while adding the playful, adaptive quality requested during brainstorming.

The concept is:

- W: WiseEff identity and the primary shape.
- Elastic path: AI dynamically routes work across business contexts.
- Nodes on the path: parameters, logs, debugging states, and review handoffs.
- Spark in the upper right: AI insight and assisted decision-making.
- Rounded blue container: enterprise product reliability and compatibility with the existing app brand mark.

## Visual Requirements

### Shape

The primary mark is a rounded square icon with a W-shaped continuous stroke.

The W should:

- Be recognizable at 32 px and 40 px.
- Use uneven rhythm rather than symmetrical letter geometry.
- Lean slightly toward a forward-moving path without becoming an arrow.
- Keep stroke terminals rounded.
- Include one central cyan node and one smaller light node when size allows.

The W should not:

- Become a plain typed W.
- Depend on thin details that disappear in favicon sizes.
- Add too many orbit, shield, or speed-line elements.
- Look like a generic analytics chart.

### Spark

The spark is optional by size.

- Use the spark in app mark, README, and presentation sizes.
- Remove or simplify the spark below 32 px if it reduces legibility.
- Keep the spark white, not yellow or decorative.

### Container

Use the existing WiseEff visual language:

- Rounded square, approximately 22 percent corner radius.
- Blue gradient fill.
- No hard black shadow inside the asset.
- External soft shadow may be applied by CSS in application UI, not baked into the SVG when possible.

## Color System

Use colors already close to the WiseEff interface palette.

- Primary deep blue: `#003D9B`
- Primary blue: `#0052CC`
- Enterprise teal: `#00687B`
- AI cyan: `#50DCFF`
- White stroke: `#FFFFFF`
- Light surface: `#F9F9FF`
- Dark text for wordmark: `#101C2D`

Recommended gradient:

- Container: `#003D9B` to `#0052CC` to `#00687B`
- W stroke: `#FFFFFF` to `#E9F9FF` to `#50DCFF`

## Size Variants

### Full Mark

Use for README, presentation material, app loading surfaces, and larger brand placements.

Includes:

- Gradient rounded square.
- Elastic W path.
- Central cyan node.
- Secondary white node.
- Upper-right spark.

### App Mark

Use for the WiseEff sidebar brand block and future in-app product surfaces.

Includes:

- Gradient rounded square.
- Elastic W path.
- Upper-right spark if the rendered size is at least 36 px.
- CSS-controlled shadow matching the existing `.brand-mark` style.

### Favicon Mark

Use for `favicon.svg`, `favicon.ico`, and browser tab surfaces.

Includes:

- Solid or simplified gradient blue container.
- Thicker white W path.
- Optional cyan node only if it remains crisp.
- No spark at 16 px.

The favicon version should be tested at 16 px, 20 px, 24 px, and 32 px.

### Single-Color Mark

Use for documentation, monochrome exports, or future print-like contexts.

Includes:

- Blue outline or solid blue mark.
- Single-color W path.
- No gradient-dependent details.

## Wordmark Pairing

When shown with text, pair the icon with the existing product name:

- Primary wordmark: `WiseEff`
- Optional Chinese name: `智效`
- Optional descriptor: `AI 业务效率平台`

The wordmark should use the project’s existing Inter/system UI stack and dark text color. Do not create a custom display font for this iteration.

## Application Integration Scope

Implementation should create reusable assets and update only the obvious brand entry points.

Expected outputs:

- `public/wiseeff-icon.svg` or equivalent source SVG.
- `public/favicon.svg`.
- Optional PNG exports for 192 px and 512 px if needed for app metadata.
- App brand mark update in the existing sidebar/header brand area.

Implementation should not redesign navigation, homepage layout, or the broader design system. This is an icon asset task.

## Testing And Review

Review the implementation with:

- Visual inspection at 16 px, 24 px, 32 px, 40 px, and 128 px.
- Browser favicon check in local dev.
- In-app sidebar/header check on desktop and mobile widths.
- Build verification with the existing project scripts.

The icon is successful if users can read it as a distinctive WiseEff W at small sizes, while the larger version still communicates AI-assisted efficiency rather than only a static corporate monogram.
