# WiseEff Local Device Bridge — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the Windows Device Bridge with HDC RPC, Windows service lifecycle commands, bridge management UI, and multi-bridge detect polish.

**Architecture:** Extract shared HDC runner logic into `device-command-core`, extend bridge RPC handlers for `protocol=hdc`, add optional Windows service commands to the CLI, expose bridge rename API, and add a lightweight bridge management surface in the frontend.

**Tech Stack:** TypeScript, Node spawn, `ws`, React, Vitest, Playwright.

---

## Source Spec

- `docs/superpowers/specs/2026-06-23-local-device-bridge-design.md` (Phase 2 section)

## Scope

- Windows remains primary platform for service install.
- HDC + ADB both supported in bridge RPC.
- Bridge rename + revoke in UI (revoke API exists).
- Multi-bridge detect UX polish when multiple bridges return targets.

## Out of Scope

- macOS/Linux service install
- Signed Windows installer
- Object-store artifact hosting changes

## Task 1: Shared HDC Command Core

Extract HDC runner/target parsing from `hdcGateway.ts` into `packages/device-command-core` mirroring ADB extraction.

## Task 2: Bridge HDC RPC Handlers

Update `packages/device-bridge/src/rpcHandlers.ts` to support `protocol=hdc` for detect/read/write and accurate `bridge.getCapabilities`.

## Task 3: Windows Service Commands

Add `service install|start|stop|uninstall` to `wiseeff-bridge` CLI using a minimal Windows-only approach (document schtasks or node-windows equivalent; prefer lightweight `sc.exe` + bundled script if no new deps).

## Task 4: Bridge Rename API

Add `PATCH /api/v1/device-bridges/:bridgeId` with `machineLabel` body; repository update + route tests.

## Task 5: Bridge Management UI

Add settings section (or panel on `/node-debugging`) listing user's bridges with rename + revoke; extend `deviceBridgeClient.ts`.

## Task 6: Multi-Bridge Detect Polish

When detect returns multiple bridge-backed targets, show machine labels and require explicit target selection before session create.

## Task 7: Tests, Docs, Acceptance

Update runbooks, FRONTEND/SECURITY docs, extend conditional acceptance for HDC bridge path; run build + targeted tests.

## Documentation Impact Matrix

| Area | Action | Files |
| --- | --- | --- |
| Runbooks | Update | `docs/runbooks/local-device-bridge.md`, zh-CN |
| Frontend | Update | `docs/FRONTEND.md`, zh-CN |
| Environment | Review | `.env.example` |

## Documentation Update Gate

- [x] `npm run docs:check` passes before completion.
