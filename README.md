# WiseEff

WiseEff is a local front-end prototype for an AI-assisted enterprise efficiency platform. It is built as a Vite, React, TypeScript single-page application with mocked business data and interactive workflow states.

## Requirements

- Node.js 22 LTS or newer compatible runtime
- npm 11 or compatible npm version

Vite 7 requires Node.js `^20.19.0 || >=22.12.0`. This repository includes `.nvmrc` with Node 22 as the recommended setup target.

## Quick Start

```bash
npm ci
npm run dev
```

The dev server binds to `127.0.0.1`. Vite will print the actual local URL, usually:

```text
http://127.0.0.1:5173/
```

## Useful Scripts

```bash
npm run dev
```

Starts the local Vite dev server.

```bash
npm test
```

Runs the Vitest test suite once.

```bash
npm run build
```

Runs TypeScript project checks and creates the production build in `dist/`.

```bash
npm run preview
```

Serves the built production output locally after `npm run build`.

## Project Structure

```text
src/
  App.tsx                         Main prototype UI and interaction logic
  styles.css                      Application styling
  mockData.ts                     Mock domain data
  appConfig.ts                    Navigation and application configuration
  powerManagementConfig.ts        Power-management configuration helpers
  config/power-management.json    Editable prototype configuration data
  test/setup.ts                   Vitest DOM test setup

PRD.md                            Product requirements and prototype scope
stitch_ai_driven_business_synergy_platform/
                                  Design reference exports and screenshots
```

## Notes for New Development Machines

1. Clone the repository.
2. Use Node 22 or a compatible runtime listed above.
3. Run `npm ci` from the repository root.
4. Run `npm test` and `npm run build` to verify the environment.
5. Run `npm run dev` and open the printed local URL.

No external API keys or backend services are required for the current prototype.

## Repository Hygiene

Generated folders such as `node_modules/`, `dist/`, local dev logs, Codex scratch state, and visual QA screenshots are intentionally ignored by Git. Commit source files, configuration, tests, product/design docs, and lockfiles.
