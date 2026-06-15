# Admin Local Account Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `/user-permissions` Admin "添加用户" with the local registration account model so Admin-created users receive username/password credentials and can log in.

**Architecture:** Keep the existing `/api/v1/users` governance endpoint, but change its create contract from legacy email-based profile creation to Admin local-account creation. The backend creates `users`, `user_password_credentials`, `user_role_bindings`, and audit evidence in one transaction; the frontend modal collects the same credential fields as registration and no longer requires email.

**Tech Stack:** React/Vite, TypeScript, Vitest, Testing Library, Node HTTP server modules, Postgres SQL via repository/service layer, `playwright-cli` for rendered UI verification.

---

## Files

- Modify: `src/UserPermissionsPage.tsx`
  - Replace Add User modal fields with `姓名`, `用户名`, optional `职务`, `初始密码`, `确认密码`, `初始角色`.
  - Dispatch created users with `username` and no required `email`.
- Modify: `src/App.tsx`
  - Change the `ADD_USER` reducer action from required email to required username.
  - Deduplicate added users by username in mock mode.
- Modify: `src/UserPermissionsPage.test.tsx`
  - Update modal expectations and API-mode create payload tests.
  - Add validation coverage for empty credential fields and password mismatch.
- Modify: `src/reducer.userPermissions.test.ts`
  - Update mock reducer coverage to create users by username and reject duplicate usernames.
- Modify: `src/appReducer.parameterAdmin.test.ts`
  - Update parameter-admin reducer coverage to use username instead of email.
- Modify: `src/infrastructure/http/userGovernanceClient.ts`
  - Change create input and POST body to `name`, `username`, `password`, optional `title`, `roles`.
- Modify: `src/infrastructure/http/userGovernanceClient.test.ts`
  - Assert no `email` is sent for Admin local-account creation.
- Modify: `server/modules/users/schemas.ts`
  - Change create schema to require `username` and `password`, make `title` optional, remove required `email`.
- Modify: `server/modules/users/types.ts`
  - Change `CreateUserInput` to local-account fields.
- Modify: `server/modules/users/service.ts`
  - Validate username/password, check duplicate username, hash password, create local credentials transactionally, and redact password from audit metadata.
- Modify: `server/modules/users/repository.ts`
  - Add a credential insertion helper and username lookup helper, or keep SQL in service if it stays small.
- Modify: `server/modules/users/service.test.ts`
  - Assert credential rows are created and duplicate username is rejected.
- Modify: `server/modules/users/routes.test.ts`
  - Assert API accepts username/password and rejects legacy email-only payloads.
- Modify: `server/modules/contracts/schemaRegistry.ts`
  - Rename or update create request schema reference to local-account semantics.
- Modify: `server/modules/contracts/openapi.test.ts`
  - Assert `users.create` documents the Admin local-account request body.
- Modify: `docs/FRONTEND.md`
  - Document that `/user-permissions` Admin Add User creates local accounts with credentials.
- Modify: `docs/zh-CN/frontend.md`
  - Chinese companion update for the same frontend behavior.
- Modify: `docs/api/authentication.md`
  - Document Admin-created local accounts and credential storage behavior.
- Modify: `docs/zh-CN/api/authentication.md`
  - Chinese companion update.
- Review: `docs/developer/browser-acceptance-coverage-map.md`
- Review: `docs/developer/user-operation-coverage-matrix.md`

---

## Task 1: Lock The Frontend Add User Contract

**Files:**
- Modify: `src/UserPermissionsPage.test.tsx`
- Modify: `src/reducer.userPermissions.test.ts`
- Modify: `src/appReducer.parameterAdmin.test.ts`

- [x] **Step 1: Update the Add User dialog test to expect local-account fields**

Replace the current Add User dispatch/API modal expectations so the dialog contains:

```text
姓名
用户名
职务
初始密码
确认密码
初始角色
```

and does not contain required `邮箱`.

- [x] **Step 2: Add API-mode create payload expectation**

Assert `userGovernanceActions.createUser` receives:

```ts
{
  name: "Demo Engineer",
  username: "demo.engineer",
  title: "Validation Engineer",
  password: "WiseEff@2026",
  roleId: "hardware-user"
}
```

- [x] **Step 3: Add frontend validation tests**

Add tests for:

```text
姓名、用户名和初始密码不能为空。
两次输入的密码不一致。
```

- [x] **Step 4: Run frontend test and verify RED**

Update reducer tests so `ADD_USER` uses `username` and duplicate username rejection instead of email validation.

Run:

```bash
npm test -- src/UserPermissionsPage.test.tsx src/reducer.userPermissions.test.ts src/appReducer.parameterAdmin.test.ts
```

Expected: FAIL because current component still renders `邮箱` and sends legacy payload.

---

## Task 2: Lock The HTTP Client Contract

**Files:**
- Modify: `src/infrastructure/http/userGovernanceClient.test.ts`

- [x] **Step 1: Update create user client test**

Change the test payload to:

```ts
await client.createUser({
  name: "Demo Engineer",
  username: "demo.engineer",
  title: "Validation Engineer",
  password: "WiseEff@2026",
  roleId: "hardware-user",
  projectId: "aurora"
});
```

Expected POST body:

```json
{
  "name": "Demo Engineer",
  "username": "demo.engineer",
  "title": "Validation Engineer",
  "password": "WiseEff@2026",
  "roles": [{ "projectId": "aurora", "roleId": "hardware-user" }]
}
```

- [x] **Step 2: Run client test and verify RED**

Run:

```bash
npm test -- src/infrastructure/http/userGovernanceClient.test.ts
```

Expected: FAIL because current client requires/sends `email`.

---

## Task 3: Lock The Backend Local Credential Contract

**Files:**
- Modify: `server/modules/users/service.test.ts`
- Modify: `server/modules/users/routes.test.ts`
- Modify: `server/modules/contracts/openapi.test.ts`

- [x] **Step 1: Update service create test**

Assert `createUser`:

- accepts `username` and `password`,
- inserts into `user_password_credentials`,
- stores a `scrypt$` password hash instead of plaintext,
- writes audit metadata with `username` and roles but no password.

- [x] **Step 2: Add duplicate username test**

Assert existing username lookup causes:

```text
Username is already registered.
```

- [x] **Step 3: Update route create test**

POST `/api/v1/users` with `username` and `password`; assert `201`, returned user has `email: null` or omitted on client mapping, and credential insert happened.

- [x] **Step 4: Add route validation test for legacy email-only body**

POST body with `email` but no `username/password`; assert `400 VALIDATION_FAILED`.

- [x] **Step 5: Update OpenAPI contract expectation**

Assert `schemaRegistry["users.create"].requestBody` is `CreateLocalAccountUserRequest`.

- [x] **Step 6: Run backend tests and verify RED**

Run:

```bash
npm test -- server/modules/users/service.test.ts server/modules/users/routes.test.ts server/modules/contracts/openapi.test.ts
```

Expected: FAIL because schema/service still use legacy `email`.

---

## Task 4: Implement Backend Account Creation

**Files:**
- Modify: `server/modules/users/schemas.ts`
- Modify: `server/modules/users/types.ts`
- Modify: `server/modules/users/service.ts`
- Modify: `server/modules/users/repository.ts`
- Modify: `server/modules/contracts/schemaRegistry.ts`

- [x] **Step 1: Change create schema**

Use:

```ts
export const createUserBodySchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3).max(64),
  password: z.string().min(8),
  title: z.string().optional(),
  roles: z.array(roleBindingSchema).min(1)
});
```

- [x] **Step 2: Change create input type**

Use:

```ts
export type CreateUserInput = {
  name: string;
  username: string;
  password: string;
  title?: string;
  roles: Array<{ projectId?: string | null; roleId: BackendRoleId }>;
};
```

- [x] **Step 3: Add username/password helpers**

Keep validation consistent with local auth:

```ts
function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function requireUsername(username: string) {
  if (!username) throw new ApiError("VALIDATION_FAILED", "Username is required.", 400);
  if (username.length < 3 || username.length > 64) throw new ApiError("VALIDATION_FAILED", "Username must be 3 to 64 characters.", 400);
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new ApiError("VALIDATION_FAILED", "Username can only contain letters, numbers, dots, underscores, or hyphens.", 400);
  }
}
```

Password must be at least 8 characters.

- [x] **Step 4: Hash password with scrypt**

Use Node `crypto.scrypt` and the same `scrypt$<salt>$<hash>` format as local registration.

- [x] **Step 5: Insert credential transactionally**

Inside `createUser`, before inserting credentials:

```sql
select user_id as id
from user_password_credentials
where lower(username) = lower($1)
limit 1
```

Then insert:

```sql
insert into user_password_credentials (user_id, username, password_hash)
values ($1, $2, $3)
```

- [x] **Step 6: Preserve organization and activation semantics**

Use `auth.organization.id`; created users are active immediately, including MDE roles, because this is an Admin action.

- [x] **Step 7: Update audit metadata**

Use:

```ts
metadata: { username, roles }
```

Do not include password or password hash.

- [x] **Step 8: Update schema registry**

Change `users.create` request body reference to `CreateLocalAccountUserRequest`.

- [x] **Step 9: Run backend tests and verify GREEN**

Run:

```bash
npm test -- server/modules/users/service.test.ts server/modules/users/routes.test.ts server/modules/contracts/openapi.test.ts
```

Expected: PASS.

---

## Task 5: Implement Frontend Account Creation

**Files:**
- Modify: `src/UserPermissionsPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/infrastructure/http/userGovernanceClient.ts`

- [x] **Step 1: Change user governance action type**

Use:

```ts
createUser(input: {
  name: string;
  username: string;
  title: string;
  password: string;
  roleId: PlatformRoleId;
}): Promise<User | void>;
```

- [x] **Step 2: Replace email state with username/password state**

Add:

```ts
const [username, setUsername] = useState("");
const [password, setPassword] = useState("");
const [confirmPassword, setConfirmPassword] = useState("");
```

Remove Add User modal email state.

- [x] **Step 3: Update form validation**

Use:

```ts
if (!trimmedName || !trimmedUsername || !password) {
  setAddUserError("姓名、用户名和初始密码不能为空。");
  return;
}
if (password !== confirmPassword) {
  setAddUserError("两次输入的密码不一致。");
  return;
}
```

- [x] **Step 4: Update submit payload and dispatch**

Send `username/password/title/roleId`; dispatch `ADD_USER` with `username` and no required `email`.

- [x] **Step 5: Update modal fields**

Render:

```text
姓名
用户名
职务
初始密码
确认密码
初始角色
```

Both password fields use `type="password"` and `minLength={8}`.

- [x] **Step 6: Update HTTP client input and POST body**

Send `username` and `password`; do not send `email`.

- [x] **Step 7: Update reducer action**

Change `ADD_USER` to require `username` instead of `email`, normalize username to lowercase, reject duplicate usernames, and set `username` on the created user record.

- [x] **Step 8: Run frontend/client tests and verify GREEN**

Run:

```bash
npm test -- src/UserPermissionsPage.test.tsx src/reducer.userPermissions.test.ts src/appReducer.parameterAdmin.test.ts src/infrastructure/http/userGovernanceClient.test.ts
```

Expected: PASS.

---

## Task 6: Update Documentation

**Files:**
- Modify: `docs/FRONTEND.md`
- Modify: `docs/zh-CN/frontend.md`
- Modify: `docs/api/authentication.md`
- Modify: `docs/zh-CN/api/authentication.md`

- [x] **Step 1: Update frontend docs**

Document that `/user-permissions` Admin Add User now creates a local account with username/password and the current Admin organization.

- [x] **Step 2: Update auth/API docs**

Document that Admin-created local accounts use the same `user_password_credentials` storage and are active immediately.

- [x] **Step 3: Keep bilingual docs separate**

English content goes only in English docs; Chinese content goes only in Chinese docs.

---

## Task 7: Full Verification

**Files:**
- Review all changed files.

- [x] **Step 1: Run targeted tests**

Run:

```bash
npm test -- src/UserPermissionsPage.test.tsx src/infrastructure/http/userGovernanceClient.test.ts server/modules/users/service.test.ts server/modules/users/routes.test.ts server/modules/contracts/openapi.test.ts
```

Expected: PASS.

- [x] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [x] **Step 3: Run docs check**

Run:

```bash
npm run docs:check
```

Expected: PASS.

- [x] **Step 4: Run diff check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

---

## Task 8: Browser Verification

**Files:**
- No source edits expected unless QA finds an issue.

- [x] **Step 1: Ensure dev servers are running**

Use existing dev server if available; otherwise start API and frontend in API mode.

- [x] **Step 2: Verify `/user-permissions` desktop**

Use:

```bash
playwright-cli -s=wiseeff-admin-account open http://127.0.0.1:5174/user-permissions
playwright-cli -s=wiseeff-admin-account resize 1440 900
playwright-cli -s=wiseeff-admin-account snapshot
playwright-cli -s=wiseeff-admin-account screenshot --filename=work/ui-checks/user-permissions-add-account-1440.png
playwright-cli -s=wiseeff-admin-account console error
```

Open Add User and verify local account fields.

- [x] **Step 3: Verify tablet and mobile**

Use:

```bash
playwright-cli -s=wiseeff-admin-account resize 768 1024
playwright-cli -s=wiseeff-admin-account snapshot
playwright-cli -s=wiseeff-admin-account screenshot --filename=work/ui-checks/user-permissions-add-account-768.png
playwright-cli -s=wiseeff-admin-account resize 390 844
playwright-cli -s=wiseeff-admin-account snapshot
playwright-cli -s=wiseeff-admin-account screenshot --filename=work/ui-checks/user-permissions-add-account-390.png
playwright-cli -s=wiseeff-admin-account console error
playwright-cli -s=wiseeff-admin-account close
```

Expected: no blank page, no visible overlay, no clipped modal controls, no relevant console errors.

---

## Documentation Impact Matrix

| Area | Decision | Files |
| --- | --- | --- |
| Repository maps | No change | `AGENTS.md`, `docs/README.md` |
| Planning docs | Update | `docs/exec-plans/active/2026-06-15-admin-local-account-create.md` |
| Product specs | Review | `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` |
| Architecture docs | Review | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` |
| API docs | Update | `docs/api/authentication.md`, `docs/zh-CN/api/authentication.md` |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/README.md` |
| Frontend docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` |
| Quality/testing docs | Review | `docs/design-docs/testing-strategy.md`, `docs/zh-CN/design-docs/testing-strategy.md` |
| Reliability/runbooks | No change | `docs/RELIABILITY.md`, `docs/runbooks/README.md` |
| Generated artifacts | No change | `docs/generated/` |
| References | Review | `docs/references/productization-api-contract-draft.md` |

## Documentation Update Gate

- [x] Apply every `Update` row in the Documentation Impact Matrix.
- [x] Review every `Review` row and record unchanged evidence in the final implementation notes.
- [x] Run `npm run docs:check`.
- [x] Do not move this plan to completed until the gate passes or deferred work is recorded in `docs/exec-plans/tech-debt-tracker.md`.

## UI Interaction Automation Review

- Affected route: `/user-permissions`.
- Affected behavior: Admin Add User modal and `POST /api/v1/users` payload.
- Existing related coverage:
  - `src/UserPermissionsPage.test.tsx` covers modal interaction and dispatch/API action payload.
  - Rendered browser verification is required by `AGENTS.md`.
- Browser acceptance map and operation matrix must be reviewed before completion:
  - `docs/developer/browser-acceptance-coverage-map.md`
  - `docs/developer/user-operation-coverage-matrix.md`
- If no acceptance requirement ID exists for Admin local-account creation, record that this PR remains covered by component tests plus manual `playwright-cli` evidence rather than adding broad e2e automation in this focused fix.

## Final Implementation Notes

- Implemented `/user-permissions` Admin Add User as local account creation with `name`, `username`, optional job title, initial password, and initial role.
- `POST /api/v1/users` now creates the user row, salted `scrypt` password credential, role binding, and audit event in one transaction, and rejects legacy email-only payloads.
- Admin-created users are active immediately in the current Admin organization; response/audit metadata does not include plaintext passwords or password hashes.
- Reviewed product, architecture, security, testing, acceptance coverage, operation matrix, and API reference docs listed above. The durable behavior change required updates only to frontend/API docs and generated OpenAPI; broader docs already describe local accounts, user governance, `users:manage`, audit, and browser evidence gates.
- Browser evidence was captured for `/user-permissions` with the Add User modal at `1440x900`, `768x1024`, and `390x844`; the validation path showed `两次输入的密码不一致。` without submitting a create request.
