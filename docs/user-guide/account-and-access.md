# Account and Access

> Chinese: [Chinese](../zh-CN/user-guide/account-and-access.md)

## Who can do this

Public local registration defaults closed. Platform super administrators can open Experience registration settings in the Organization directory, select one experience Organization and enable its entry. Formal Organizations use invitation links or administrator-created accounts. Closing the entry preserves existing members and pending requests. Guests, hardware users, and software users can sign in immediately after registering; hardware/software committer requests need Admin approval. Once signed in to a local account, you can change your own password. Organization Admins (`admin`) and Platform Admins (`platform-admin`) with `users:manage` can approve requests and reset members' local passwords in the Organization they manage. Neither Admin role is available through self-registration.

## Register a local account

1. Open a protected workflow such as `/parameter-home`, or enter it from the app homepage at `/`. In API mode, visitors who have not signed in see Sign in; select Register and check the displayed experience Organization. If that tab is absent, ask your administrator for an invitation link or account.
2. Enter your name, username, role, password, and password confirmation. Usernames are 3–64 characters using letters, numbers, dots, underscores, or hyphens; passwords must contain at least eight characters. Follow the form's validation messages.
3. Choose guest (`guest`), hardware user (`hardware-user`), software user (`software-user`), hardware committer (`hardware-committer`), or software committer (`software-committer`). The role selector uses English role names; the hints explain immediate access or required approval.
4. Submit. Registering as a guest, hardware user, or software user signs you in; a Committer request shows the pending-approval result.

The screen shows the experience Organization selected in the platform's saved settings or explicit deployment configuration. It does not choose a destination from the number of Organizations or the presence of demo seeds. You cannot select another Organization during registration or change your home Organization in your profile. An unavailable, suspended or deleting destination cannot accept registration. Registration does not verify an email address or accept an invitation.

## Accept an invitation

Open the one-time link supplied by your Organization administrator and check the Organization, roles, Teams and project editing roles. Enter your name, choose a local username and password, then select **Accept invitation and create account**. After success, follow **Go to sign in** and use those credentials. Valid presets take effect together; project participation does not grant independent review, merge or device duties.

An accepted, expired, revoked or replaced link cannot be reused. If the offer's projects, Teams or authority are no longer valid, no partial account is created: ask the administrator to correct and regenerate the invitation. Do not use an invitation to move an existing account to another Organization.

## After an account transfer

Only a platform administrator can preview and confirm a transfer. Your account identifier and local username remain the same, but old sessions, personal pairings and source Organization grants are revoked. Sign in again with your local credentials; source drafts and historical work stay with the original Organization for handover.

On OIDC deployments, the administrator may see **Waiting for identity-system synchronization**. The identity provider must issue a fresh token with the target `organization_id` and the correct explicitly bound subject. Old source claims and tokens issued before revocation remain invalid. Token-supplied roles do not grant WiseEff permissions. The administrator can refresh the synchronization result in member details; a failed check does not mark synchronization complete. Continue to use your deployment's existing identity-provider sign-in entry.

![Local sign-in form](images/account-and-access-sign-in.png)

*Local sign-in reached from a protected workflow with a fresh unauthenticated browser context.*

![Registration form with role selection](images/account-and-access-register.png)

*Registration fields and role selection, available only when self-registration is enabled.*

## Wait for Committer approval

On Register (`/`), requesting either Committer role creates an inactive account and a pending role request. The account records the matching base User role, but remains unable to sign in until an Admin enables it.

Ask your Organization Admin to review the request. They may approve the requested Committer role, reject the promotion while enabling the corresponding ordinary User role, or reject and keep the account disabled. Either enabling outcome lets you return to Sign in (`/`) with the same username and password; only approval grants the Committer role. The decision notification records the actual role and ability to sign in.

## Approve a Committer request

Admins with `users:manage` review applications in the Registration requests queue. Follow [Decide a Committer registration request](organization-and-governance.md#decide-a-committer-registration-request) for the approval procedure and Organization scope. Committer permissions are granted only after approval.

## Get help when there is no Admin

If Sign in (`/`) shows No administrator account yet, contact the deployment operator. The screen explains how to create the first Admin on the server; ordinary users cannot obtain an Admin role through registration. See the [authentication reference](../api/authentication.md) for the operator procedure.

## Edit your profile

Open the top-bar user menu and choose Profile. Local and OIDC users can update their display name and title. Saving these application-owned fields does not change the login identifier, external subject, Organization, or roles.

The dialog checks the deployment's authentication mode before showing password actions. If that check fails, you can still save your profile and retry the capability check. On OIDC deployments, manage your password through your Organization's identity provider; the dialog does not offer local password changes or invent a provider link.

## Change your local password

1. From a signed-in workspace, such as My workbench (`/parameter-home`), open the top-bar user menu and choose Profile. Profile opens as a dialog and has no separate route.
2. In Change password, enter your current password, a different new password of at least eight characters, and confirmation.
3. Submit the change. Your current local session remains signed in; your other sessions are revoked. Use the new password when signing in elsewhere.

## Reset a member's local password

As an Admin with `users:manage`, open People management (`/organization/members`) through Organization management (`/organization`). Choose Reset password on the member's row, enter a new password of at least eight characters and its confirmation, and choose Confirm reset.

Resetting the password revokes all of that member's local sessions. The member must sign in again with the new password. This action requires an existing local password credential; external identity-provider passwords must be reset through the provider's process.

## Sign in on an OIDC-backed deployment

Organization administrators open People management (`/organization/members`) and choose Add user to provision an OIDC member. Enter the exact subject from the configured identity provider; the issuer is read-only. The optional provider email checks legacy migration conflicts. No username or local password is required. To bind an existing member or change a subject, open Member details and save OIDC identity. A conflict preserves your input: check the subject and original migration email, or refresh if another administrator changed the binding. This does not merge accounts or change the internal user ID or roles.

Use the identity-provider sign-in entry supplied by your deployment operator, then open WiseEff at `/`. WiseEff's browser integration obtains and refreshes the provider's access token. The server uses WiseEff's records to check whether the account is active and determine its Organization and effective permissions. WiseEff roles require separate authorization; signing in to the identity provider does not grant them.

OIDC does not automatically create or join members. Existing unbound legacy accounts retain their verified-email migration path using the original migration email. Changing profile email does not grant login access, and an explicitly bound account requires its bound subject.

There is no dedicated OIDC sign-in button or route in the current WiseEff auth screen. If you still see the local Sign in (`/`) form on an OIDC-backed deployment, ask the operator to check the browser identity integration; do not create a local account as a substitute. Follow your provider's process for external-account passwords. See the [authentication reference](../api/authentication.md) for deployment details.
