---
name: WiseEff
colors:
  surface: '#f9f9ff'
  surface-dim: '#cedbf2'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f3ff'
  surface-container: '#e7eeff'
  surface-container-high: '#dee9ff'
  surface-container-highest: '#d7e3fb'
  on-surface: '#101c2d'
  on-surface-variant: '#434654'
  inverse-surface: '#253143'
  inverse-on-surface: '#ebf1ff'
  outline: '#737685'
  outline-variant: '#c3c6d6'
  surface-tint: '#0c56d0'
  primary: '#003d9b'
  on-primary: '#ffffff'
  primary-container: '#0052cc'
  on-primary-container: '#c4d2ff'
  inverse-primary: '#b2c5ff'
  secondary: '#00687b'
  on-secondary: '#ffffff'
  secondary-container: '#50dcff'
  on-secondary-container: '#005f71'
  tertiary: '#314367'
  on-tertiary: '#ffffff'
  tertiary-container: '#485b80'
  on-tertiary-container: '#c0d3fe'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2ff'
  primary-fixed-dim: '#b2c5ff'
  on-primary-fixed: '#001848'
  on-primary-fixed-variant: '#0040a2'
  secondary-fixed: '#afecff'
  secondary-fixed-dim: '#48d7f9'
  on-secondary-fixed: '#001f27'
  on-secondary-fixed-variant: '#004e5d'
  tertiary-fixed: '#d7e2ff'
  tertiary-fixed-dim: '#b4c7f1'
  on-tertiary-fixed: '#041b3c'
  on-tertiary-fixed-variant: '#34476a'
  background: '#f9f9ff'
  on-background: '#101c2d'
  surface-variant: '#d7e3fb'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.4'
  body-base:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  data-label:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  data-value:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  space-xs: 4px
  space-sm: 8px
  space-md: 16px
  space-lg: 24px
  space-xl: 48px
  layout-margin: 32px
  layout-gutter: 20px
---

## Brand & Style

The design system is anchored in the concept of "WiseEff"—a dual-natured visual philosophy that balances high-level strategic oversight with granular operational precision. It is designed for enterprise leadership and operations teams who require a platform that feels both visionary and dependable.

The aesthetic merges **Corporate Modern** with **Glassmorphism**. While the core structure relies on a rigorous, clean grid to establish trust and reliability, AI-driven features utilize translucent, frosted-glass layers to represent the fluid and innovative nature of machine intelligence. The interface transitions seamlessly from an expansive, airy "Strategic Mode" for executive summaries to a high-density "Functional Mode" for intensive data management, ensuring that the visual weight always matches the user's cognitive load.

## Colors

The color palette is built on a foundation of "Professional Blue" to evoke institutional stability, paired with "AI Teal" to highlight intelligent insights and interactive automation. 

- **Primary & Secondary:** Used for core branding, primary actions, and AI-led highlights.
- **Surface Tiers:** The design system utilizes a hierarchy of neutral grays to separate content zones. Pure white is reserved for the highest elevation (cards), while subtle off-whites and cool grays define the background and sidebar structures.
- **Semantic Clarity:** Status indicators for risk and progress use high-saturation greens, ambers, and reds, ensuring critical business metrics are scannable at a glance in both high-density tables and strategic dashboards.

## Typography

This design system utilizes **Inter** exclusively to ensure maximum legibility across complex data sets. The typographic scale is divided into two distinct hierarchies:

1.  **Strategic Hierarchy:** Uses large display sizes with tighter letter spacing for headlines to create a modern, editorial feel on home screens.
2.  **Functional Hierarchy:** Prioritizes "Data Labels" and "Data Values." Labels are rendered in uppercase with increased tracking for rapid identification, while values use tabular num settings to ensure vertical alignment in tables and financial reports.

High contrast between font weights (SemiBold for headers vs. Regular for body) is used to maintain order in information-dense workbenches.

## Layout & Spacing

The design system employs a **Fluid 12-Column Grid** with two distinct density profiles:

- **Expressive Layout:** Used for landing pages and executive dashboards. It utilizes `space-xl` for section margins and `space-lg` for card internal padding, creating an open, sophisticated atmosphere that emphasizes key performance indicators.
- **Functional Workbench:** Used for admin panels and data grids. It switches to a compact 4px base unit, reducing gutters to `space-sm` and row heights to their minimum viable size to maximize information density without sacrificing scannability.

Margins and padding are strictly mathematical, ensuring that all components align to a consistent vertical rhythm.

## Elevation & Depth

Visual hierarchy is communicated through a combination of **Tonal Layering** and **Glassmorphism**:

- **The Workbench Base:** Uses flat, low-contrast outlines (`#DFE1E6`) to define table boundaries and input fields, keeping the UI "quiet" so data stands out.
- **Strategic Cards:** Utilize "Ambient Shadows"—diffused, low-opacity shadows (10% opacity) with a slight blue tint—to appear lifted from the background.
- **AI Agent Panel:** This is the highest level of elevation. It uses a `backdrop-filter: blur(12px)` with a semi-transparent white fill and a subtle 1px border. This "glass" effect separates intelligent suggestions from static data, signaling that the AI is an overlay that observes and assists across the entire platform.

## Shapes

The shape language is professional and refined. 

- **Standard Elements:** Buttons, input fields, and small badges use a `0.5rem` (8px) radius to feel modern but structured.
- **Container Elements:** Large cards and the AI Agent panel use `1rem` (16px) or `1.5rem` (24px) for the outer corners to soften the enterprise environment.
- **Indicators:** Progress bars and risk tags utilize pill-shaped (fully rounded) geometry to distinguish them from interactive buttons and structural containers.

## Components

### AI Agent Panel
A floating, persistent component positioned at the bottom-right or as a sidebar overlay. It must feature the glassmorphism effect and use the Secondary Teal for its "active" pulse state.

### Multi-State Buttons
Buttons support four states: Default, Hover, Loading (with a spinner), and Success (a brief transition to a green state with a checkmark). This provides immediate tactile feedback for high-stakes enterprise actions.

### Data Tables & Workbenches
Tables must support "Compact" and "Standard" view toggles. Headers remain sticky during scroll. Hover states on rows should use a subtle light-blue tint (`#F4F5F7`) to guide the eye.

### Risk Badges & Timelines
- **Risk Badges:** Use a "soft-fill" style (light background with dark text) for low priority, and "solid-fill" for high-priority alerts.
- **Progress Timelines:** Horizontal steppers that use Teal for completed stages and Blue for the active stage, showing clear lineage of business processes.

### Input Fields
Inputs use a clear 2px border on focus using the Primary Blue, with floating labels to maintain context even when the field is populated.