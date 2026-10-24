alter table public.user_oidc_identities
  add column transfer_pending_since timestamptz,
  add column transfer_verified_at timestamptz,
  add constraint oidc_transfer_verification_requires_transfer check
    (transfer_verified_at is null or (transfer_pending_since is not null and transfer_verified_at>=transfer_pending_since));
