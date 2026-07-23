# Local development demo credentials seed — design

> Date: 2026-07-23  
> Status: approved for implementation  
> Chinese: [`docs/zh-CN/superpowers/specs/2026-07-23-local-demo-credentials-seed-design.md`](../zh-CN/superpowers/specs/2026-07-23-local-demo-credentials-seed-design.md)  
> Branch: `feat/local-demo-credentials-seed`

## Problem

M0 seed creates seven ChargeLab demo users with role bindings, but never writes `user_password_credentials`. Local API mode defaults to `AUTH_MODE=production` + `AUTH_PROVIDER=local`, so those personas cannot log in until someone bootstraps an admin or self-registers and (for Committers) waits for Admin approval. Role-by-role UI testing then requires manual account setup.

## Goals

- After `NODE_ENV=development` M0 seed, each seeded persona can log in with a **fixed username** and a **shared demo password**.
- Keep production / non-development seeds passwordless (no demo credentials written).
- Reuse existing password hashing and login paths; no auth-mode bypass for this feature.

## Non-goals

- Changing mock-mode persona switching (`activeRoleId`).
- Shipping demo passwords into production or customer databases.
- Replacing `admin:bootstrap` for empty non-demo installs.
- Per-user distinct passwords or email-as-login for these personas.
- Auto-approving arbitrary self-registered Committers.

## Design

### Gate

`seedLocalDemoCredentials` runs only when `process.env.NODE_ENV === "development"`. Otherwise M0 logs that demo credentials were skipped and leaves `user_password_credentials` unchanged for those users.

### Accounts

Shared password: `WiseEff-Dev!`

| Username | User ID | Seeded authority (after M0+M1) |
|---|---|---|
| `xu.yun` | `u-xu-yun` | org-level `admin` |
| `zhao.heng` | `u-zhao-heng` | `hardware-user` (per demo project) |
| `liu.min` | `u-liu-min` | `software-user` |
| `wang.jie` | `u-wang-jie` | `hardware-committer` |
| `chen.na` | `u-chen-na` | `software-user` |
| `li.peng` | `u-li-peng` | `hardware-committer` |
| `sun.mei` | `u-sun-mei` | `software-committer` |

Usernames must pass `validateLocalAccountUsername` (`^[a-z0-9._-]{3,64}$`).

### Implementation shape

1. Extract a small helper (preferred: `server/modules/auth/seedLocalDemoCredentials.ts`, callable from `scripts/seed-m0.ts`) that:
   - exports the account table + shared password constant (for docs/tests);
   - hashes via `hashLocalAccountPassword`;
   - upserts into `user_password_credentials (user_id, username, password_hash)` with `on conflict (user_id) do update`.
2. Call it at the end of `seedM0Foundation` after users/roles/admin binding exist.
3. Idempotent on development re-seed: same `user_id` gets username + demo password reset.
4. If another user already owns one of these usernames, the unique index fails the seed with a clear error (local dirty DB → clear credentials or wipe volume).

### Docs

Update bilingual local-development guides with the account table and the development-only gate. Mention in bilingual authentication docs that development M0 seed enables password login for these personas (bootstrap remains for empty non-demo DBs).

### Tests

Extend `server/scripts/seed-m0.test.ts` (or a focused helper test):

- Under `NODE_ENV=development`, M0 issues inserts/upserts for all seven usernames into `user_password_credentials`.
- Under non-development `NODE_ENV`, no credential writes for demo users.
- Username constants satisfy `validateLocalAccountUsername`.

## Acceptance

- Fresh local DB, `NODE_ENV=development`, `db:seed:m0` (+ usual M1+): login `xu.yun` / `WiseEff-Dev!` yields Admin session; `wang.jie` / same password yields hardware-committer capabilities on seeded projects.
- Same seed with `NODE_ENV=production` does not create those credential rows.
- Existing register / bootstrap / OIDC paths remain unchanged.
