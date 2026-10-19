alter table log_domains add column skill_key text;

-- The identity table also has legacy/direct SQL creators. Generate keys here so
-- every creation path gets the same organization-scoped, stable identity.
create function assign_log_skill_key() returns trigger language plpgsql as $$
declare
  base_key text;
  suffix text;
  attempt integer := 0;
begin
  if new.skill_key is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('log-skill-key:' || new.organization_id, 0));
  base_key := trim(both '-' from regexp_replace(lower(new.name), '[^a-z0-9]+', '-', 'g'));
  if length(base_key) < 2 then base_key := 'skill-' || left(md5(new.id), 8); end if;
  base_key := trim(trailing '-' from left(base_key, 63));
  new.skill_key := base_key;
  while exists (select 1 from log_domains where organization_id = new.organization_id and skill_key = new.skill_key and id <> new.id) loop
    attempt := attempt + 1;
    suffix := '-' || left(md5(new.id), 8) || case when attempt > 1 then '-' || attempt else '' end;
    new.skill_key := trim(trailing '-' from left(base_key, 63 - length(suffix))) || suffix;
  end loop;
  return new;
end $$;
create trigger log_skill_key_default before insert or update of skill_key on log_domains
  for each row execute function assign_log_skill_key();

-- Row ordering makes collision resolution deterministic during backfill.
do $$
declare skill record;
begin
  for skill in select id from log_domains order by created_at, id loop
    update log_domains set skill_key = null where id = skill.id;
  end loop;
end $$;

-- Backfill updates enqueue the existing deferred publication constraint. Drain
-- those events before PostgreSQL permits the following table alterations.
set constraints all immediate;
alter table log_domains alter column skill_key set not null;
alter table log_domains add constraint log_domains_skill_key_format check (skill_key ~ '^[a-z0-9][a-z0-9-]{1,62}$');
alter table log_domains add constraint log_domains_organization_skill_key_unique unique (organization_id, skill_key);
