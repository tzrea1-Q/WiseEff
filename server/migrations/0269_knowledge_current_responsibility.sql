-- Current responsibility can change; the recorded creator and revision authors cannot.
alter table knowledge_entries add column responsible_user_id text references users(id) on delete set null;
alter table knowledge_import_batches add column responsible_user_id text references users(id) on delete set null;

update knowledge_entries e set responsible_user_id=u.id from users u
where u.id=e.created_by_user_id and u.organization_id=e.organization_id;
update knowledge_import_batches b set responsible_user_id=u.id from users u
where u.id=b.created_by_user_id and u.organization_id=b.organization_id;

create function initialize_knowledge_responsibility() returns trigger language plpgsql as $$
begin
  if new.responsible_user_id is null then
    select id into new.responsible_user_id from users
    where id=new.created_by_user_id and organization_id=new.organization_id;
  end if;
  return new;
end; $$;
create trigger initialize_knowledge_responsibility before insert on knowledge_entries
for each row execute function initialize_knowledge_responsibility();
create trigger initialize_knowledge_responsibility before insert on knowledge_import_batches
for each row execute function initialize_knowledge_responsibility();

create index knowledge_entries_responsible_idx on knowledge_entries(organization_id,responsible_user_id) where status='draft';

-- Draft custodianship is separate from the submitted feedback's triage assignee.
alter table product_feedback add column draft_owner_user_id text references users(id) on delete set null;
update product_feedback f set draft_owner_user_id=u.id from users u
where u.id=f.submitter_user_id and u.organization_id=f.organization_id;
create function initialize_feedback_draft_responsibility() returns trigger language plpgsql as $$
begin
  if new.draft_owner_user_id is null then
    select id into new.draft_owner_user_id from users where id=new.submitter_user_id and organization_id=new.organization_id;
  end if;
  return new;
end; $$;
create trigger initialize_feedback_draft_responsibility before insert on product_feedback
for each row execute function initialize_feedback_draft_responsibility();

do $$
declare item record;
begin
  for item in select * from (values ('knowledge_import_batches','created_by_user_id'),
    ('product_feedback','submitter_user_id'),('product_feedback_progress_events','actor_user_id')) as targets(table_name,actor_column)
  loop
    execute format('alter table %I add column historical_attribution jsonb',item.table_name);
    execute format('update %I set historical_attribution=jsonb_build_object(''organization'',knowledge_log_agent_identity_snapshot(organization_id,''organization'',''legacy-current'',organization_id),''actors'',jsonb_build_object(%L,knowledge_log_agent_identity_snapshot(%I,''user'',''legacy-current'',organization_id)))',item.table_name,item.actor_column,item.actor_column);
    execute format('alter table %I alter column historical_attribution set not null',item.table_name);
    execute format('create trigger aa_historical_attribution before insert or update on %I for each row execute function capture_knowledge_log_agent_attribution(%L,'''')',item.table_name,item.actor_column);
  end loop;
end; $$;
