alter table public.users add constraint users_id_organization_identity_unique unique(id,organization_id);
create table public.user_oidc_identities (
  user_id text primary key,
  organization_id text not null,
  issuer text,
  subject text,
  legacy_email text,
  legacy_subject boolean not null default false,
  updated_at timestamptz not null default now(),
  foreign key(user_id,organization_id) references public.users(id,organization_id) on delete cascade,
  unique(organization_id,issuer,subject),
  check ((issuer is null and subject is null) or (length(btrim(issuer))>0 and length(btrim(subject))>0 and issuer is not null and subject is not null))
);
create index user_oidc_legacy_email_idx on public.user_oidc_identities(organization_id,legacy_email) where legacy_email is not null;
insert into public.user_oidc_identities(user_id,organization_id,legacy_email,legacy_subject)
  select id,organization_id,nullif(lower(btrim(email)),''),true from public.users;

create function public.capture_initial_oidc_identity() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  -- ponytail: serialize rare member identity writes per organization; partition further only if onboarding contention becomes material.
  perform pg_advisory_xact_lock(hashtextextended('oidc-identity:'||new.organization_id,0));
  if exists(select 1 from public.user_oidc_identities where organization_id=new.organization_id and
    subject=new.id) then
    raise exception using errcode='23505',message='OIDC identity conflicts with an existing member';
  end if;
  -- New members need explicit OIDC binding; profile email never creates migration authority.
  insert into public.user_oidc_identities(user_id,organization_id) values(new.id,new.organization_id);
  return new;
end; $$;
create trigger capture_initial_oidc_identity after insert on public.users for each row execute function public.capture_initial_oidc_identity();

create function public.preserve_initial_oidc_identity() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.user_id is distinct from old.user_id or new.organization_id is distinct from old.organization_id or new.legacy_email is distinct from old.legacy_email or new.legacy_subject is distinct from old.legacy_subject then
    raise exception using errcode='55000',message='Initial OIDC migration identity is immutable';
  end if;
  return new;
end; $$;
create trigger preserve_initial_oidc_identity before update on public.user_oidc_identities for each row execute function public.preserve_initial_oidc_identity();

-- Mirror credential privileges individually; managers/workers without credential writes gain no identity writes.
do $$ declare identity_grant record; begin
  for identity_grant in select grantee,privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name='user_password_credentials'
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') and grantee<>'PUBLIC'
  loop
    if identity_grant.privilege_type='SELECT' or pg_has_role(identity_grant.grantee,'catalog_publication_coordinator_role','MEMBER') then
      execute format('grant %s on public.user_oidc_identities to %I',identity_grant.privilege_type,identity_grant.grantee);
    end if;
  end loop;
end $$;
