-- A package may arrive as a first draft, without publishing unreviewed content.
-- Existing publications still cannot be removed or changed (0187 immutability).
create or replace function require_log_skill_published_revision() returns trigger language plpgsql as $$
declare
  target_id text;
begin
  if tg_table_name = 'log_domains' then target_id := new.id;
  elsif tg_op = 'DELETE' then target_id := old.skill_id;
  else target_id := new.skill_id;
  end if;
  if exists (select 1 from log_domains where id = target_id)
    and not exists (select 1 from log_skill_revisions where skill_id = target_id and status = 'published')
    and (not exists (select 1 from log_skill_revisions where skill_id = target_id and status = 'draft')
      or exists (select 1 from log_skill_revisions where skill_id = target_id and status = 'superseded')) then
    raise exception 'A skill requires a published revision or an initial draft';
  end if;
  return null;
end $$;
