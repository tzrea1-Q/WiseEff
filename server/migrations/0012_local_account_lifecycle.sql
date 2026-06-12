create table if not exists user_password_credentials (
  user_id text primary key references users(id) on delete cascade,
  password_hash text not null,
  password_updated_at timestamptz not null default now()
);

create table if not exists auth_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  organization_id text not null references organizations(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);

create index if not exists auth_sessions_user_id_idx
  on auth_sessions (user_id);

create index if not exists auth_sessions_token_hash_active_idx
  on auth_sessions (token_hash, expires_at)
  where revoked_at is null;
