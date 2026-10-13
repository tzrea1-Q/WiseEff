# Account and Access

> Chinese: [Chinese](../zh-CN/user-guide/account-and-access.md)

## Who can do this

New users can register only when the deployment enables local self-registration. Guest, hardware user, and software user registrations are immediately usable; hardware/software committer requests need Admin approval. Signed-in local-account users can change their own password. Organization Admins (`admin`) and Platform Admins (`platform-admin`) with `users:manage` can approve requests and reset local passwords in their home Organization. Neither Admin role is available through self-registration.

## Register a local account

1. Open the deployment's app at `/`. In API mode, an unauthenticated visitor sees Sign in (`/`); select Register (`/`). If that tab is absent, ask your administrator for an account rather than attempting self-registration.
2. Enter your name, username, role, password, and password confirmation. Usernames are 3–64 characters using letters, numbers, dots, underscores, or hyphens; passwords must contain at least eight characters. Follow the form's validation messages.
3. Choose guest (`guest`), hardware user (`hardware-user`), software user (`software-user`), hardware committer (`hardware-committer`), or software committer (`software-committer`). The role selector uses English role names; the hints explain immediate access or required approval.
4. Submit. A non-Committer registration signs you in; a Committer request shows the pending-approval result instead.

The screen states which Evaluation Organization the account joins. It is ChargeLab in the seeded profile; otherwise registration requires exactly one available bootstrap Organization. There is no Organization picker, and your profile cannot change your home Organization. If no suitable Organization exists or several are ambiguous, ask the deployment operator to resolve setup. Registration does not verify an email address or accept an invitation.

## Wait for Committer approval

On Register (`/`), requesting either Committer role creates an **inactive** account and a pending role request. The matching base User role is recorded, but does not let you sign in while the account is inactive. No session is issued before approval.

Ask your Organization Admin to review the request. Once approved, return to Sign in (`/`) and use the same username and password. Approval activates the account and assigns the requested Committer role.

## Approve a Committer request

Admins with `users:manage` use the Registration requests queue. Follow [Decide a Committer registration request](organization-and-governance.md#decide-a-committer-registration-request) for the approval procedure and Organization scope. Registration as a Committer is not itself approval.

## Get help when there is no Admin

If Sign in (`/`) shows No administrator account yet, contact the deployment operator. The screen gives the server-side first-Admin setup hint; ordinary users should not try to obtain Admin through registration. Operator procedures belong in the [authentication reference](../api/authentication.md).

## Change your local password

1. From a signed-in workspace, such as My workbench (`/parameter-home`), open the top-bar user menu and choose Profile. This is a dialog, not a separate route.
2. In Change password, enter your current password, a different new password of at least eight characters, and confirmation.
3. Submit the change. **The current local session remains signed in; your other sessions are revoked.** Use the new password when signing in elsewhere.

## Reset a member's local password

As an Admin with `users:manage`, open People management (`/organization/members`) through Organization management (`/organization`). Choose Reset password on the member's row, enter a new password of at least eight characters and its confirmation, and choose Confirm reset.

**All local sessions for that member are revoked**, unlike self-service password change. The member must sign in again with the new password. This action requires an existing local password credential; it does not reset an external identity-provider password.

## Sign in on an OIDC-backed deployment

Use the identity-provider sign-in entry supplied by your deployment operator, then open WiseEff at `/`. WiseEff's browser integration obtains and refreshes the provider's access token; the server resolves the active user, Organization, and effective permissions from WiseEff's records. An identity-provider login alone does not grant a WiseEff role.

There is no dedicated OIDC sign-in button or route in the current WiseEff auth screen. If you still see the local Sign in (`/`) form on an OIDC-backed deployment, ask the operator to check the browser identity integration; do not create a local account as a substitute. Follow your provider's process for external-account passwords. Deployment details remain in the [authentication reference](../api/authentication.md).
