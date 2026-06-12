alter table user_password_credentials
  add column if not exists username text;

with username_candidates as (
  select
    user_password_credentials.user_id,
    user_password_credentials.username is null
      or btrim(user_password_credentials.username) = ''
      or btrim(user_password_credentials.username) <> lower(btrim(user_password_credentials.username))
      or lower(btrim(user_password_credentials.username)) !~ '^[a-z0-9._-]{3,64}$' as needs_update,
    base.base_username
  from user_password_credentials
  join users on users.id = user_password_credentials.user_id
  cross join lateral (
    select coalesce(
      nullif(btrim(user_password_credentials.username), ''),
      nullif(users.email, ''),
      user_password_credentials.user_id
    ) as source_identifier
  ) source
  cross join lateral (
    select regexp_replace(
      lower(coalesce(nullif(split_part(source.source_identifier, '@', 1), ''), user_password_credentials.user_id)),
      '[^a-z0-9._-]+',
      '-',
      'g'
    ) as raw_username
  ) raw
  cross join lateral (
    select case
      when length(raw.raw_username) >= 3 then left(raw.raw_username, 64)
      else left(raw.raw_username || '-' || user_password_credentials.user_id, 64)
    end as base_username
  ) base
),
numbered_usernames as (
  select
    user_id,
    needs_update,
    base_username,
    row_number() over (partition by base_username order by needs_update, user_id) as duplicate_number
  from username_candidates
),
local_account_usernames as (
  select
    user_id,
    needs_update or duplicate_number > 1 as should_update,
    case
      when duplicate_number = 1 then base_username
      else left(base_username, 55) || '-' || left(md5(user_id), 8)
    end as username
  from numbered_usernames
)
update user_password_credentials
set username = local_account_usernames.username
from local_account_usernames
where user_password_credentials.user_id = local_account_usernames.user_id
  and local_account_usernames.should_update;

alter table user_password_credentials
  alter column username set not null;

create unique index if not exists user_password_credentials_username_unique_idx
  on user_password_credentials (lower(username));
