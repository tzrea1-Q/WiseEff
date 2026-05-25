# WiseEff Light Homepage Color Refresh Design

## Goal

Change the current WiseEff homepage from a dark Linear-style presentation into a light visual system that transitions naturally into the existing light workbench.

The page should still feel premium, product-led, and designed. This is not a plain white simplification. The target direction is a light homepage with a controlled ink-blue focus panel in the hero product stage.

## Approved Direction

Use a light foundation with a softened dark accent:

- Page foundation: cloud white and pale blue surfaces close to the current workbench palette.
- Hero product stage shell: white or translucent white with soft blue shadow.
- Hero main preview panel: ink-blue/slate-blue, not black.
- Workflow rail, Agent boundary panel, proof strip, and long-page sections: light surfaces.
- Dark color usage: limited to focus panels, code/evidence snippets, or status emphasis.

This keeps the homepage visually rich while avoiding the abrupt shift from a black homepage to a light operational workspace.

## Design Principles

1. The homepage should read as light within the first viewport.
2. Dark surfaces should be accents, not the page theme.
3. The workbench color system should be recognizable from the homepage.
4. The current Linear-inspired hierarchy should remain: restrained nav, large centered hero, product stage, proof strip, broad section rhythm, and premium spacing.
5. No fake claims, customers, or inflated metrics should be added.
6. Existing WiseEff proof objects should remain visible: Aurora, Nebula, Atlas, `fast_charge_current_limit_ma`, `battery_pack_temp=46.8C`, `PRQ-9102`, and `ChargeLab_X01`.

## Visual System

### Foundation

Use a light background similar to the existing app shell:

- Base: `#fbfcff` or current `#f9f9ff`
- Lower band: `#f4f7ff`
- Surface: `#ffffff`
- Soft surface: `#f0f3ff`
- Border: existing `#dfe5f3` / `#c3c6d6`
- Primary text: `#101c2d`
- Muted text: existing `#434654` / `#566070`

The homepage may use subtle radial glows, but they should be pale blue/cyan and never create a dark page impression.

### Accent And Focus

Replace pure black or near-black homepage panels with ink-blue/slate-blue:

- Ink panel top: approximately `#22304a`
- Ink panel bottom: approximately `#172033`
- Ink text: `#ffffff`
- Ink muted text: `#d8e2f3`
- Ink border: translucent blue-gray, not stark white

This panel should feel like a focused analysis or evidence surface inside a light product interface.

### Transition To Workbench

The first viewport should visually foreshadow the workbench:

- Header uses a translucent white background with light borders.
- Primary CTA uses the existing WiseEff primary blue.
- Secondary CTA uses white or pale-blue styling.
- Product stage outer shell uses the same rounded, bordered, shadowed language as workbench cards.
- Long-page cards and preview panels use light surfaces and workbench-adjacent tokens.

## Page Structure

The content architecture stays the same as the current localized Linear-style homepage:

1. Header
2. Hero
3. Product stage
4. Proof strip
5. Agent/workflow differentiator section
6. Parameter management section
7. Log analysis section
8. Parameter debugging section
9. Governance and reuse section
10. Footer

No workbench routes are redesigned in this change.

## Section Design

### Header

The header should stop reading as a dark marketing nav.

- Background: translucent white with blur.
- Border: pale blue-gray.
- Brand: dark text with blue mark.
- Nav labels: muted gray, active/hover in primary blue.
- CTA: primary blue button for `进入工作台`; subtle link for `查看演示`.

### Hero

The hero should be light, spacious, and product-led.

- Background: pale cloud gradient with a restrained blue/cyan radial glow.
- Badge: pale-blue pill.
- H1: dark text, no white gradient text.
- Subtitle: muted dark text.
- CTAs: primary blue and subtle white/pale-blue.

The hero should still preserve large scale and calm rhythm from the current Linear-inspired page.

### Hero Product Stage

The product stage is the key design object.

Outer shell:

- White or translucent white.
- Soft border.
- Large but not theatrical black shadow.
- Optional faint blue glow behind the shell.

Left workflow rail:

- Light surface.
- Active state uses pale primary-blue fill and stronger blue text.

Main preview panel:

- Ink-blue/slate-blue gradient.
- Shows the current goal, evidence, and PRQ status.
- Uses pale evidence chips and subtle separators.
- Must not use near-black as the base.

Right Agent boundary panel:

- Light surface.
- Explains that Agent may assist but not bypass confirmation.
- Uses blue/teal accents instead of dark blocks.

### Proof Strip

Replace the dark proof area with light statistic cards:

- Four light cards over the same page foundation.
- Use real prototype coverage:
  - `3` business workbenches
  - `10` shared business parameters
  - `8` real-time tunable parameters
  - `1` review and audit chain
- Use dark text and muted detail text.

### Agent Differentiator Section

The current "not another backend system" section should become light.

- Keep the four-card rhythm.
- Cards use white/pale-blue surfaces.
- Mock controls and evidence snippets may use ink-blue details, but not full dark cards.
- Headline and body text use dark workbench typography.

### Product Sections

Parameter, log, debugging, and governance sections should use light full-width bands.

- Large headings remain.
- Preview frames use white shells.
- Internal screenshots/mock panels use a mix of light surfaces and small ink-blue evidence zones.
- Feature grids use dark text with blue icons.
- Bottom cards use light cards with subtle shadows.

Section-specific accent glows can remain, but they must be low-volume and should not push the section into a dark theme.

### Footer

Use a light footer:

- White or pale-blue surface.
- Top border.
- Dark brand text.
- Muted links.
- Existing footer columns remain.

## Component And Code Boundaries

Expected implementation scope:

- Update `src/linear-template/linear-template.css`.
- Update `src/linear-template/LinearTemplateHome.tsx` only if class names or minor copy/structure changes are needed to support the new light surfaces.
- Update homepage tests where they depend on class structure or color-mode behavior.

Do not:

- Redesign non-home pages.
- Change app routing, reducer logic, mock data, or workbench components.
- Introduce a new CSS framework or dependency.
- Add fake visual assets, customer logos, or external product screenshots.

## Responsive Behavior

Desktop:

- Hero product stage remains a strong first-viewport signal.
- A hint of the next content should remain visible below the fold where feasible.
- No horizontal overflow.

Mobile:

- Header remains light and compact.
- Hero text wraps cleanly.
- Product stage stacks into readable sections.
- Ink-blue main preview panel should not dominate the entire mobile viewport.
- CTA text must fit without clipping.

## Accessibility And Contrast

- Dark text on light surfaces must meet readable contrast.
- Ink-blue panel text must remain high contrast.
- Focus states should be visible on light backgrounds.
- Reduced-motion behavior from the current template should remain.

## Testing And Verification

Run:

- `npm test`
- `npm run build`

Browser QA:

- `/` desktop viewport around 1440px wide.
- `/` mobile viewport around 390px wide.
- `/parameters` to confirm the workbench shell is unchanged.

Visual checks:

- Homepage first impression is light.
- The ink-blue preview panel feels integrated, not like a black island.
- Header, proof strip, long sections, and footer no longer read as dark theme.
- Transition from `/` to `/parameters` feels visually continuous.
- Existing WiseEff content objects still appear.

## Acceptance Criteria

- The homepage is clearly light-themed in the first viewport.
- The hero still feels premium and product-led.
- The dark/ink treatment is limited and softened.
- The workbench route visual system remains unchanged.
- No old all-black Linear-style page background remains.
- Tests and production build pass.
