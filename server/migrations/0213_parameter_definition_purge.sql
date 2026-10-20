-- Platform administrator hard erasure. Source files, parsed source topology,
-- Subjects and other Definitions remain shared; only parameter-owned rows go.
create table parameter_catalog.definition_erasures (
  definition_id text primary key,
  erased_at timestamptz not null default clock_timestamp(),
  erased_by text not null,
  audit_event_id text not null,
  catalog_rewrite jsonb not null default '{}',
  counts jsonb not null default '{}',
  pending_object_refs text[] not null default '{}'
);

-- The capability exists only for exact rows selected by the trusted function,
-- in its current transaction. Runtime roles cannot insert or update it.
create table parameter_catalog.definition_purge_rows (
  transaction_id bigint not null,
  relation_name text not null,
  row_key jsonb not null,
  operation text not null check (operation in ('UPDATE', 'DELETE')),
  primary key (transaction_id, relation_name, row_key, operation)
);
revoke all on parameter_catalog.definition_erasures, parameter_catalog.definition_purge_rows from public;
alter table parameter_catalog.definition_erasures owner to catalog_migration_owner;
alter table parameter_catalog.definition_purge_rows owner to catalog_migration_owner;

create function parameter_catalog.definition_purge_key(p_relation regclass, p_row jsonb)
returns jsonb language sql stable set search_path = pg_catalog as $$
  select jsonb_object_agg(a.attname, p_row -> a.attname)
  from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
  where i.indrelid=p_relation and i.indisprimary;
$$;

create function parameter_catalog.definition_purge_allows_change(p_schema text, p_table text, p_row jsonb, p_operation text)
returns boolean language sql stable security definer
set search_path = pg_catalog, parameter_catalog as $$
  select exists (select 1 from parameter_catalog.definition_purge_rows allowed
    where allowed.transaction_id=txid_current() and allowed.relation_name=p_schema||'.'||p_table
      and allowed.row_key=parameter_catalog.definition_purge_key(to_regclass(p_schema||'.'||p_table),p_row)
      and allowed.operation=p_operation);
$$;
alter function parameter_catalog.definition_purge_allows_change(text,text,jsonb,text) owner to catalog_migration_owner;

create function parameter_catalog.definition_purge_ids(p_targets jsonb, p_relation text)
returns text[] language sql immutable set search_path=pg_catalog as $$
  select coalesce(array_agg(coalesce(item->>'id',item->>'draft_id')), '{}')
  from jsonb_array_elements(coalesce(p_targets->p_relation,'[]')) item;
$$;

create function parameter_catalog.definition_purge_add(p_targets jsonb,p_relation text,p_keys jsonb)
returns jsonb language sql immutable set search_path=pg_catalog as $$
  select case when p_keys is null or p_keys='[]' then p_targets else
    jsonb_set(p_targets,array[p_relation],(
      select jsonb_agg(k order by k::text) from (
        select distinct value k from jsonb_array_elements(coalesce(p_targets->p_relation,'[]')||p_keys)
      ) unique_keys)) end;
$$;

-- Canonical JSON matches the existing Catalog contract serializer, including
-- whitespace inside strings. Used only to identify persisted review groups.
create function parameter_catalog.definition_purge_canonical_json(p_value jsonb)
returns text language plpgsql immutable set search_path=pg_catalog,parameter_catalog as $$
declare result text;
begin
  case jsonb_typeof(p_value)
  when 'object' then select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||parameter_catalog.definition_purge_canonical_json(value),',' order by key),'')||'}' into result from jsonb_each(p_value);
  when 'array' then select '['||coalesce(string_agg(parameter_catalog.definition_purge_canonical_json(value),',' order by ordinal),'')||']' into result from jsonb_array_elements(p_value) with ordinality e(value,ordinal);
  else result:=p_value::text;
  end case;
  return result;
end;
$$;

create function parameter_catalog.definition_purge_review_fingerprint(p_row jsonb)
returns text language sql immutable set search_path=pg_catalog,parameter_catalog as $$
  select 'sha256:'||encode(sha256(convert_to(parameter_catalog.definition_purge_canonical_json(jsonb_build_object(
    'kind','review-item-group','organizationId',p_row->>'organization_id',
    'matcherRevision',p_row->'evidence'->>'matcherRevision',
    'catalogReleaseId',p_row->'evidence'->>'catalogReleaseId',
    'reason',p_row->>'reason','rClass',coalesce(p_row->'r_class',p_row->'evidence'->'rClass'),
    'identityKey',case when coalesce(p_row->'evidence'->'payload'->>'propertyKey','')<>'' then 'property:'||(p_row->'evidence'->'payload'->>'propertyKey')
      else 'source:'||(p_row->'evidence'->>'sourceIdentity') end)), 'UTF8')),'hex');
$$;

create function parameter_catalog.definition_purge_closure(p_id text)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,parameter_catalog,public,catalog_publication as $$
declare targets jsonb:='{}'; previous jsonb; keys jsonb; edge record; relation_name text; join_sql text; all_ids text[];
begin
  if not exists(select 1 from parameter_catalog.parameter_definitions where id=p_id) then return targets; end if;
  targets:=jsonb_build_object('parameter_catalog.parameter_definitions',jsonb_build_array(jsonb_build_object('id',p_id)));
  loop
    previous:=targets;
    -- Follow child FKs, never semantic parents such as shared nodes/files.
    -- Excluded edges are provenance links into surviving parameters or shared
    -- snapshots; the erasure function explicitly detaches those instead.
    for edge in
      select fk.*,child_ns.nspname||'.'||child.relname child_name,parent_ns.nspname||'.'||parent.relname parent_name
      from pg_constraint fk join pg_class child on child.oid=fk.conrelid join pg_namespace child_ns on child_ns.oid=child.relnamespace
      join pg_class parent on parent.oid=fk.confrelid join pg_namespace parent_ns on parent_ns.oid=parent.relnamespace
      where fk.contype='f' and child_ns.nspname in ('public','parameter_catalog','catalog_publication')
        and targets ? (parent_ns.nspname||'.'||parent.relname)
        and child.relname not in ('debugging_snapshots','definition_erasures','definition_purge_rows')
        and not (child_ns.nspname='parameter_catalog' and child.relname='project_parameter_values' and fk.conname='project_parameter_value_replacement_source_fk')
        and not (child_ns.nspname='parameter_catalog' and child.relname='binding_history_events' and parent.relname='project_parameter_value_change_requests')
        and not (child.relname='node_operations' and parent.relname in ('debugging_snapshots','node_operations'))
      order by child_name,fk.conname
    loop
      select string_agg(format('c.%I=p.%I',ca.attname,pa.attname),' and ' order by columns.ordinal)
      into join_sql from unnest(edge.conkey,edge.confkey) with ordinality columns(child_att,parent_att,ordinal)
      join pg_attribute ca on ca.attrelid=edge.conrelid and ca.attnum=columns.child_att
      join pg_attribute pa on pa.attrelid=edge.confrelid and pa.attnum=columns.parent_att;
      execute format('select coalesce(jsonb_agg(distinct parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(c))),''[]'') from %s c join %s p on %s where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(p)))',
        edge.child_name,edge.child_name,edge.parent_name,join_sql,edge.parent_name)
      into keys using targets->edge.parent_name;
      targets:=parameter_catalog.definition_purge_add(targets,edge.child_name,keys);
    end loop;
    -- Multi-parameter approvals are indivisible proofs. Remove their approval
    -- copies, preserving the other parameters' actual values and history.
    select coalesce(jsonb_agg(jsonb_build_object('id',request_id)),'[]') into keys
      from public.project_parameter_value_change_targets where id=any(parameter_catalog.definition_purge_ids(targets,'public.project_parameter_value_change_targets'));
    targets:=parameter_catalog.definition_purge_add(targets,'public.project_parameter_value_change_requests',keys);
    select coalesce(jsonb_agg(jsonb_build_object('id',observation_id)),'[]') into keys
      from parameter_catalog.parameter_observation_matches where id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.parameter_observation_matches'));
    targets:=parameter_catalog.definition_purge_add(targets,'parameter_catalog.parameter_observations',keys);
    select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') into keys from public.knowledge_definition_references where definition_id=p_id;
    targets:=parameter_catalog.definition_purge_add(targets,'public.knowledge_definition_references',keys);
    -- Mappings have typed, deliberately non-FK target references.
    select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') into keys from parameter_catalog.legacy_mapping_versions m
      where m.target_id=any(parameter_catalog.definition_purge_ids(targets,case m.target_kind
        when 'parameter-definition' then 'parameter_catalog.parameter_definitions' when 'definition-revision' then 'parameter_catalog.definition_revisions'
        when 'parameter-binding' then 'parameter_catalog.project_parameter_bindings' when 'project-value' then 'parameter_catalog.project_parameter_values'
        when 'binding-history-event' then 'parameter_catalog.binding_history_events' when 'parameter-observation' then 'parameter_catalog.parameter_observations'
        when 'observation-match' then 'parameter_catalog.parameter_observation_matches' when 'review-evidence' then 'parameter_catalog.parameter_review_evidence'
        when 'review-item' then 'parameter_catalog.parameter_review_items' when 'review-resolution' then 'parameter_catalog.parameter_review_resolutions'
        when 'definition-proposal' then 'parameter_catalog.definition_proposals' when 'definition-proposal-revision' then 'parameter_catalog.definition_proposal_revisions'
        when 'publication-intent' then 'parameter_catalog.catalog_publication_intents' else '' end));
    targets:=parameter_catalog.definition_purge_add(targets,'parameter_catalog.legacy_mapping_versions',keys);
    select coalesce(jsonb_agg(jsonb_build_object('id',legacy_identity_id)),'[]') into keys from parameter_catalog.legacy_mapping_versions
      where id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.legacy_mapping_versions'));
    targets:=parameter_catalog.definition_purge_add(targets,'parameter_catalog.legacy_identities',keys);
    for relation_name in select unnest(array['public.parameter_specs','public.parameter_spec_versions','public.parameter_definitions','public.project_parameter_values']) loop
      execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(s))),''[]'') from %s s join parameter_catalog.legacy_identities i on i.source_id=s.id where i.id=any($1) and i.source_kind=$2',relation_name,relation_name)
        into keys using parameter_catalog.definition_purge_ids(targets,'parameter_catalog.legacy_identities'),case relation_name
          when 'public.parameter_specs' then 'parameter-spec' when 'public.parameter_spec_versions' then 'parameter-spec-version'
          when 'public.parameter_definitions' then 'legacy-flat-parameter-definition' else 'legacy-flat-project-parameter-value' end;
      targets:=parameter_catalog.definition_purge_add(targets,relation_name,keys);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('id',parameter_spec_id)),'[]') into keys from public.parameter_spec_versions
      where id=any(parameter_catalog.definition_purge_ids(targets,'public.parameter_spec_versions'));
    targets:=parameter_catalog.definition_purge_add(targets,'public.parameter_specs',keys);
    select coalesce(jsonb_agg(jsonb_build_object('id',legacy_id)),'[]') into keys from public.legacy_parameter_migration_evidence
      where legacy_kind='parameter_definition' and id=any(parameter_catalog.definition_purge_ids(targets,'public.legacy_parameter_migration_evidence'));
    targets:=parameter_catalog.definition_purge_add(targets,'public.parameter_definitions',keys);
    -- Review groups can include several projects/Definitions with the same key.
    -- Remove a group only when none of its evidence survives the erasure.
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id)),'[]') into keys from parameter_catalog.parameter_review_items i
      where exists(select 1 from parameter_catalog.parameter_review_evidence e where e.id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.parameter_review_evidence'))
        and parameter_catalog.definition_purge_review_fingerprint(to_jsonb(e))=i.evidence_fingerprint)
      and not exists(select 1 from parameter_catalog.parameter_review_evidence e where not(e.id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.parameter_review_evidence')))
        and parameter_catalog.definition_purge_review_fingerprint(to_jsonb(e))=i.evidence_fingerprint);
    targets:=parameter_catalog.definition_purge_add(targets,'parameter_catalog.parameter_review_items',keys);
    select coalesce(array_agg(distinct coalesce(k->>'id',k->>'draft_id')),'{}') into all_ids
      from jsonb_each(targets) t cross join jsonb_array_elements(t.value) k;
    select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('parameter_catalog.legacy_identities',to_jsonb(i))),'[]') into keys
      from parameter_catalog.legacy_identities i where i.source_id=any(parameter_catalog.definition_purge_ids(targets,
        case i.source_kind when 'legacy-flat-parameter-definition' then 'public.parameter_definitions'
        when 'legacy-flat-project-parameter-value' then 'public.project_parameter_values'
        when 'parameter-history-entry' then 'public.parameter_history_entries'
        when 'legacy-parameter-migration-evidence' then 'public.legacy_parameter_migration_evidence'
        else 'public.'||replace(i.source_kind,'-','_')||'s' end));
    targets:=parameter_catalog.definition_purge_add(targets,'parameter_catalog.legacy_identities',keys);
    foreach relation_name in array array['public.debugging_parameters','public.node_operations'] loop
      execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))),''[]'') from %s r where r.parameter_definition_id=any($1)',relation_name,relation_name)
      into keys using parameter_catalog.definition_purge_ids(targets,'public.parameter_definitions');
      targets:=parameter_catalog.definition_purge_add(targets,relation_name,keys);
    end loop;
    foreach relation_name in array array['parameter_catalog.catalog_command_idempotency','parameter_catalog.governance_command_idempotency'] loop
      execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))),''[]'') from %s r where r.result_ref=any($1)',relation_name,relation_name)
      into keys using all_ids;
      targets:=parameter_catalog.definition_purge_add(targets,relation_name,keys);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('id',id)),'[]') into keys from public.audit_events where target_id=any(all_ids);
    targets:=parameter_catalog.definition_purge_add(targets,'public.audit_events',keys);
    exit when targets=previous;
  end loop;
  return targets;
end;
$$;

create function parameter_catalog.preview_parameter_definition_purge(p_id text)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,parameter_catalog,public as $$
declare targets jsonb; entry record; counts jsonb:='{}'; visible_targets jsonb:='{}'; row_digests jsonb:='{}'; definition jsonb; organizations text[]:='{}'; projects text[]:='{}'; part text[]; fingerprint text; rows_json jsonb; plane_archives jsonb; catalog_archives jsonb;
begin
  select jsonb_build_object('id',d.id,'propertyKey',d.property_key,'subjectName',s.canonical_key) into definition
    from parameter_catalog.parameter_definitions d join parameter_catalog.catalog_subjects s on s.id=d.subject_id where d.id=p_id;
  if definition is null then return null; end if;
  targets:=parameter_catalog.definition_purge_closure(p_id);
  for entry in select key relation_name,value keys from jsonb_each(targets) order by key loop
    counts:=counts||jsonb_build_object(entry.relation_name,jsonb_array_length(entry.keys));
    visible_targets:=visible_targets||jsonb_build_object(entry.relation_name,(select jsonb_agg(coalesce(k->>'id',k->>'draft_id',k::text) order by k::text) from jsonb_array_elements(entry.keys) k));
    execute format('select coalesce(array_agg(distinct to_jsonb(r)->>''organization_id'') filter(where to_jsonb(r)->>''organization_id'' is not null),''{}'') from %s r where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',entry.relation_name,entry.relation_name) into part using entry.keys;
    organizations:=organizations||part;
    execute format('select coalesce(array_agg(distinct to_jsonb(r)->>''project_id'') filter(where to_jsonb(r)->>''project_id'' is not null),''{}'') from %s r where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',entry.relation_name,entry.relation_name) into part using entry.keys;
    projects:=projects||part;
    execute format('select coalesce(jsonb_agg(to_jsonb(r) order by parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))::text),''[]'') from %s r where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',entry.relation_name,entry.relation_name,entry.relation_name) into rows_json using entry.keys;
    row_digests:=row_digests||jsonb_build_object(entry.relation_name,rows_json);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into plane_archives from public.project_parameter_plane_archives a;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into catalog_archives from parameter_catalog.parameter_catalog_archives a
    where a.id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.parameter_catalog_archives'));
  fingerprint:='sha256:'||encode(sha256(convert_to((row_digests||jsonb_build_object('planeArchives',plane_archives))::text,'UTF8')),'hex');
  return jsonb_build_object('definition',definition,'counts',counts,'targets',visible_targets,'fingerprint',fingerprint,
    'catalogRelease',(select jsonb_build_object('id',r.id,'digest',r.release_digest) from parameter_catalog.catalog_state s join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id),
    'organizationIds',(select coalesce(jsonb_agg(v order by v),'[]') from (select distinct unnest(organizations) v) a),
    'projectIds',(select coalesce(jsonb_agg(v order by v),'[]') from (select distinct unnest(projects) v) a),
    'affectedOrganizations',(select count(distinct v) from unnest(organizations) v),
    'affectedProjects',(select count(distinct v) from unnest(projects) v),
    'legacySpecIds',to_jsonb(parameter_catalog.definition_purge_ids(targets,'public.parameter_specs')),
    'legacyMappingIds',to_jsonb(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.legacy_mapping_versions')),
    'planeArchives',plane_archives,'catalogArchives',catalog_archives);
end;
$$;

-- Preserve final-state FK ownership checks while allowing the erasure transaction
-- to delete cycles (Definition/head/revision and Binding/current Value).
do $$
declare edge record; definition text;
begin
  for edge in select fk.oid,fk.conrelid::regclass relation_name,fk.conname
    from pg_constraint fk join pg_class child on child.oid=fk.conrelid join pg_namespace ns on ns.oid=child.relnamespace
    join pg_class parent on parent.oid=fk.confrelid join pg_namespace pn on pn.oid=parent.relnamespace
    where fk.contype='f' and (ns.nspname in ('parameter_catalog','catalog_publication')
      or pn.nspname in ('parameter_catalog','catalog_publication')
      or (ns.nspname='public' and (child.relname like 'parameter_%' or child.relname like 'project_parameter_%'
        or child.relname in ('node_operations','debugging_snapshots','debugging_parameters','debugging_events','dts_reload_run_targets','knowledge_parameter_references'))))
  loop
    definition:=regexp_replace(pg_get_constraintdef(edge.oid),'ON DELETE RESTRICT','ON DELETE NO ACTION');
    definition:=regexp_replace(definition,' DEFERRABLE( INITIALLY (DEFERRED|IMMEDIATE))?','');
    execute format('alter table %s drop constraint %I',edge.relation_name,edge.conname);
    execute format('alter table %s add constraint %I %s DEFERRABLE INITIALLY DEFERRED',edge.relation_name,edge.conname,definition);
  end loop;
end;
$$;

-- Reuse each trigger's existing body rather than copy its invariants. The added
-- first branch is usable only for exact keys inserted by this migration's closed
-- erasure function; ordinary writes still execute the original checks unchanged.
do $$
declare routine record; original text; rewritten text;
begin
  for routine in select distinct p.oid from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_language l on l.oid=p.prolang
    where not t.tgisinternal and l.lanname='plpgsql'
      and (n.nspname in ('parameter_catalog','catalog_publication') or (n.nspname='public' and
        (c.relname like 'parameter_%' or c.relname like 'project_parameter_%' or c.relname like 'dts_%'
          or c.relname in ('node_operations','debugging_snapshots','debugging_parameters','debugging_events'))))
  loop
    original:=pg_get_functiondef(routine.oid);
    rewritten:=regexp_replace(original,E'(\\n[ \\t]*)begin([ \\t]*\\n)',E'\\1begin\n  if TG_OP in (''UPDATE'',''DELETE'') and parameter_catalog.definition_purge_allows_change(TG_TABLE_SCHEMA,TG_TABLE_NAME,to_jsonb(OLD),TG_OP) then\n    if TG_OP=''DELETE'' then return OLD; else return NEW; end if;\n  end if;\n','i');
    if rewritten=original then raise exception 'Cannot add targeted erasure boundary to %',routine.oid::regprocedure; end if;
    execute rewritten;
  end loop;
end;
$$;

create function parameter_catalog.definition_purge_mark(p_relation regclass,p_keys jsonb,p_operation text)
returns void language sql security definer set search_path=pg_catalog,parameter_catalog as $$
  insert into parameter_catalog.definition_purge_rows(transaction_id,relation_name,row_key,operation)
  select txid_current(),n.nspname||'.'||c.relname,k,p_operation from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join jsonb_array_elements(coalesce(p_keys,'[]')) k where c.oid=p_relation on conflict do nothing;
$$;

-- Only structured backend records use this helper. Raw DTS/JSON bytes and their
-- parsed indexes never pass through it. Remove an anchored parameter item, not
-- neighbouring items in a shared snapshot.
create function parameter_catalog.definition_purge_json(p_value jsonb,p_ids text[])
returns jsonb language plpgsql immutable set search_path=pg_catalog,parameter_catalog as $$
declare result jsonb; part jsonb; entry record;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value)='object' then
    if exists(select 1 from jsonb_each(p_value) e where e.key=any(array[
      'definitionId','definition_id','parameterDefinitionId','parameter_definition_id','parameterSpecId','parameter_spec_id',
      'bindingId','binding_id','canonicalBindingId','canonical_binding_id','projectParameterBindingId','project_parameter_binding_id',
      'sourceProjectParameterBindingId','projectValueId','project_value_id','currentValueId','current_value_id',
      'sourceProjectValueId','projectParameterValueId','project_parameter_value_id','parameterId','operationId'])
      and jsonb_typeof(e.value)='string' and e.value#>>'{}'=any(p_ids)) then return null; end if;
    result:='{}';
    for entry in select key,value from jsonb_each(p_value) loop
      part:=parameter_catalog.definition_purge_json(entry.value,p_ids);
      if part is not null then result:=result||jsonb_build_object(entry.key,part); end if;
    end loop;
  elsif jsonb_typeof(p_value)='array' then
    result:='[]';
    for entry in select value from jsonb_array_elements(p_value) loop
      part:=parameter_catalog.definition_purge_json(entry.value,p_ids);
      if part is not null then result:=result||jsonb_build_array(part); end if;
    end loop;
  elsif jsonb_typeof(p_value)='string' and p_value#>>'{}'=any(p_ids) then return null;
  else result:=p_value;
  end if;
  return result;
end;
$$;

create function parameter_catalog.reject_erased_parameter_definition()
returns trigger language plpgsql security definer set search_path=pg_catalog,parameter_catalog as $$
begin
  if exists(select 1 from parameter_catalog.definition_erasures where definition_id=new.id) then
    raise exception using errcode='55000',message='Parameter definition was permanently erased',detail=new.id,constraint='definition_erasures_identity';
  end if;
  return new;
end;
$$;
create trigger parameter_definition_erased_identity before insert on parameter_catalog.parameter_definitions
for each row execute function parameter_catalog.reject_erased_parameter_definition();

create function parameter_catalog.lock_parameter_definition_purge(p_id text)
returns void language plpgsql security definer set search_path=pg_catalog,parameter_catalog,catalog_publication,public as $$
begin
  if p_id is null or btrim(p_id)='' then raise exception using errcode='22023',message='Definition id is required'; end if;
  -- ponytail: global maintenance fence; split by Definition only when source
  -- writers and publication can share a narrower erasure protocol.
  perform parameter_catalog.acquire_current_pointer_lock_exclusive();
  perform catalog_publication.acquire_publication_guard_lock();
  lock table parameter_catalog.catalog_state in exclusive mode;
  lock table parameter_catalog.project_parameter_bindings,parameter_catalog.project_parameter_values,
    parameter_catalog.binding_history_events,parameter_catalog.project_parameter_source_occurrences,
    parameter_catalog.project_value_source_pins,public.project_parameter_value_drafts,
    public.project_parameter_value_change_requests,public.project_parameter_value_change_targets,
    public.project_parameter_bindings,public.parameter_specs,public.parameter_spec_versions,
    public.parameter_definitions,public.project_parameter_values in share row exclusive mode;
end;
$$;

create function parameter_catalog.purge_parameter_definition(p_id text,p_plan jsonb,p_actor text,p_audit_id text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,parameter_catalog,public,catalog_publication as $$
declare targets jsonb; entry record; keys jsonb; ids text[]; counts jsonb:='{}';
  revision jsonb; release jsonb; artifact jsonb; control record; changes text; archive_update jsonb; pending_refs text[]:='{}';
begin
  if p_actor is null or btrim(p_actor)='' or p_audit_id is null or btrim(p_audit_id)='' then
    raise exception using errcode='22023',message='Trusted erasure actor and audit id are required';
  end if;
  perform parameter_catalog.lock_parameter_definition_purge(p_id);
  if not exists(select 1 from parameter_catalog.parameter_definitions where id=p_id) then
    return coalesce((select jsonb_build_object('erased',true,'counts',counts,'pendingObjectRefs',to_jsonb(pending_object_refs)) from parameter_catalog.definition_erasures where definition_id=p_id),jsonb_build_object('erased',false,'counts','{}'::jsonb));
  end if;
  if p_plan->>'definitionId' is distinct from p_id or jsonb_typeof(p_plan->'releases')<>'array'
    or jsonb_typeof(p_plan->'artifacts')<>'array' or jsonb_typeof(p_plan->'revisions')<>'array' then
    raise exception using errcode='22023',message='Catalog erasure plan is invalid';
  end if;
  if exists(select 1 from jsonb_array_elements(p_plan->'releases') p where not exists(select 1 from parameter_catalog.catalog_releases r where p->>'id'=r.id and p->>'oldDigest'=r.release_digest))
    or exists(select 1 from parameter_catalog.catalog_release_definition_heads h where h.definition_id=p_id and not exists(select 1 from jsonb_array_elements(p_plan->'releases') p where p->>'id'=h.release_id)) then
    raise exception using errcode='40001',message='Catalog erasure plan is stale';
  end if;
  for artifact in select value from jsonb_array_elements(p_plan->'artifacts') loop
    if coalesce((artifact->>'create')::boolean,false) then
      if not exists(select 1 from parameter_catalog.catalog_releases r where r.id=artifact->>'targetReleaseId'
        and exists(select 1 from jsonb_array_elements(p_plan->'releases') p where p->>'id'=r.id and p->>'oldDigest'=r.release_digest)) then
        raise exception using errcode='40001',message='New artifact erasure source is stale';
      end if;
    elsif not exists(select 1 from catalog_publication.release_artifacts a where a.id=artifact->>'id' and a.artifact_digest=artifact->>'oldDigest') then
      raise exception using errcode='40001',message='Catalog artifact erasure plan is stale';
    end if;
    if 'sha256:'||encode(sha256(decode(artifact->>'artifactBytesBase64','base64')),'hex') is distinct from artifact->>'bytesChecksum' then
      raise exception using errcode='22023',message='Catalog artifact erasure bytes are invalid';
    end if;
  end loop;
  for revision in select value from jsonb_array_elements(p_plan->'revisions') loop
    if not exists(select 1 from parameter_catalog.definition_revisions r where r.id=revision->>'id' and r.definition_id<>p_id and r.content_digest=revision->>'oldContentDigest') then
      raise exception using errcode='40001',message='Catalog revision erasure plan is stale';
    end if;
  end loop;
  set constraints all deferred;
  delete from parameter_catalog.definition_purge_rows where transaction_id<>txid_current();
  targets:=parameter_catalog.definition_purge_closure(p_id);
  for archive_update in select value from jsonb_array_elements(coalesce(p_plan->'archiveErasure'->'planeUpdates','[]')) loop
    if not exists(select 1 from public.project_parameter_plane_archives a where a.id=archive_update->>'id' and a.object_ref=archive_update->>'oldObjectRef')
      or coalesce(archive_update->>'newObjectRef','')='' then
      raise exception using errcode='40001',message='Parameter plane archive erasure plan is stale';
    end if;
    update public.project_parameter_plane_archives set object_ref=archive_update->>'newObjectRef',content_digest=archive_update->>'contentDigest',
      archive_digest=archive_update->>'archiveDigest',counts=archive_update->'counts' where id=archive_update->>'id';
    update parameter_catalog.plane_disposal_runs set archive_digest=archive_update->>'archiveDigest' where archive_id=archive_update->>'id';
    pending_refs:=array_append(pending_refs,archive_update->>'oldObjectRef');
  end loop;
  for archive_update in select value from jsonb_array_elements(coalesce(p_plan->'archiveErasure'->'catalogDeletes','[]')) loop
    if not exists(select 1 from parameter_catalog.parameter_catalog_archives a where a.id=archive_update->>'id' and a.encrypted_object_ref=archive_update->>'oldObjectRef'
      and a.id=any(parameter_catalog.definition_purge_ids(targets,'parameter_catalog.parameter_catalog_archives'))) then
      raise exception using errcode='40001',message='Catalog archive erasure plan is stale';
    end if;
    pending_refs:=array_append(pending_refs,archive_update->>'oldObjectRef');
  end loop;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p_plan->'archiveErasure'->'pendingObjectRefs','[]')) r where not(r=any(pending_refs))) then
    raise exception using errcode='22023',message='Erasure cleanup references are outside the archive plan';
  end if;
  select coalesce(array_agg(distinct coalesce(k->>'id',k->>'draft_id')) filter(where coalesce(k->>'id',k->>'draft_id') is not null),'{}') into ids
    from jsonb_each(targets) t cross join jsonb_array_elements(t.value) k;
  for entry in select key relation_name,value keys from jsonb_each(targets) loop
    perform parameter_catalog.definition_purge_mark(entry.relation_name::regclass,entry.keys,'DELETE');
    counts:=counts||jsonb_build_object(entry.relation_name,jsonb_array_length(entry.keys));
  end loop;
  -- Only provenance is removed from surviving, carried-forward values.
  select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('parameter_catalog.project_parameter_values',to_jsonb(v))),'[]') into keys
    from parameter_catalog.project_parameter_values v where v.definition_id<>p_id and v.replaced_from_definition_id=p_id;
  perform parameter_catalog.definition_purge_mark('parameter_catalog.project_parameter_values',keys,'UPDATE');
  update parameter_catalog.project_parameter_values set replaced_from_value_id=null,replaced_from_definition_id=null
    where definition_id<>p_id and replaced_from_definition_id=p_id;
  select coalesce(jsonb_agg(parameter_catalog.definition_purge_key('parameter_catalog.binding_history_events',to_jsonb(h))),'[]') into keys
    from parameter_catalog.binding_history_events h where h.applied_request_id=any(parameter_catalog.definition_purge_ids(targets,'public.project_parameter_value_change_requests'));
  perform parameter_catalog.definition_purge_mark('parameter_catalog.binding_history_events',keys,'UPDATE');
  update parameter_catalog.binding_history_events set applied_request_id=null where applied_request_id=any(parameter_catalog.definition_purge_ids(targets,'public.project_parameter_value_change_requests'));
  update public.debugging_snapshots set operation_id=null where operation_id=any(parameter_catalog.definition_purge_ids(targets,'public.node_operations'));
  update public.node_operations set related_operation_id=null where related_operation_id=any(parameter_catalog.definition_purge_ids(targets,'public.node_operations'));

  -- Structured snapshots are shared. Leave raw files and parsed_index intact.
  for control in select * from (values
    ('public.project_parameter_initialization_drafts','binding_snapshots'),('public.project_parameter_initialization_drafts','selected_source_binding_ids'),
    ('public.project_parameter_file_candidates','impact'),('public.project_parameter_file_candidates','blockers'),
    ('public.project_parameter_file_candidates','frozen_binding_manifest'),('public.project_parameter_file_candidates','source_revision_context'),
    ('public.debugging_snapshots','entries'),('public.debugging_events','metadata'),('public.node_operations','canonical_pin'),
    ('public.dts_reload_runs','reload_snapshot'),('public.dts_reload_runs','steps'),('public.dts_reload_runs','diagnostics'),
    ('public.dts_reload_device_residue','parameters'),('public.audit_events','metadata'),
    ('public.parameter_definition_reconciliation_runs','report'),('public.parameter_definition_reconciliation_items','evidence'),
    ('public.parameter_spec_review_tasks','source_evidence'),('public.parameter_spec_review_tasks','candidate_schemas'),
    ('public.parameter_spec_versions','reference_rules'),('public.parameter_import_batches','summary'),
    ('parameter_catalog.project_source_member_tombstones','binding_manifest'),('parameter_catalog.project_source_member_tombstones','successor_binding_manifest'),
    ('parameter_catalog.parameter_catalog_cutover_checkpoints','payload'),('parameter_catalog.parameter_catalog_cutover_events','payload'),
    ('parameter_catalog.parameter_catalog_comparison_results','evidence'),('parameter_catalog.parameter_catalog_archives','protected_references'),
    ('catalog_publication.candidates','identity_allocation'),('catalog_publication.candidates','capability_contract')
  ) controls(relation_name,column_name) loop
    if not exists(select 1 from pg_attribute where attrelid=control.relation_name::regclass and attname=control.column_name and not attisdropped) then continue; end if;
    execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))),''[]'') from %s r where r.%I is not null and r.%I is distinct from coalesce(parameter_catalog.definition_purge_json(r.%I,$1),case jsonb_typeof(r.%I) when ''array'' then ''[]''::jsonb else ''{}''::jsonb end)',
      control.relation_name,control.relation_name,control.column_name,control.column_name,control.column_name,control.column_name) into keys using ids;
    perform parameter_catalog.definition_purge_mark(control.relation_name::regclass,keys,'UPDATE');
    execute format('update %s r set %I=coalesce(parameter_catalog.definition_purge_json(r.%I,$1),case jsonb_typeof(r.%I) when ''array'' then ''[]''::jsonb else ''{}''::jsonb end) where $2 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',
      control.relation_name,control.column_name,control.column_name,control.column_name,control.relation_name) using ids,keys;
  end loop;
  update public.project_parameter_initialization_drafts set empty_library=true where binding_snapshots='[]';
  -- FK constraints are deferred; every selected row is deleted exactly once.
  for entry in select key relation_name,value keys from jsonb_each(targets) order by key loop
    execute format('delete from %s r where $1 @> jsonb_build_array(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r)))',entry.relation_name,entry.relation_name) using entry.keys;
  end loop;

  -- Mark the remaining Catalog metadata that must be rewritten consistently.
  foreach changes in array array['parameter_catalog.catalog_releases','parameter_catalog.catalog_materializations',
    'parameter_catalog.catalog_activation_receipts','catalog_publication.release_artifacts','catalog_publication.candidates',
    'catalog_publication.publication_authorizations','catalog_publication.publication_jobs','parameter_catalog.definition_revisions'] loop
    execute format('select coalesce(jsonb_agg(parameter_catalog.definition_purge_key(%L::regclass,to_jsonb(r))),''[]'') from %s r',changes,changes) into keys;
    perform parameter_catalog.definition_purge_mark(changes::regclass,keys,'UPDATE');
  end loop;
  for revision in select value from jsonb_array_elements(p_plan->'revisions') loop
    update parameter_catalog.definition_revisions set content=revision->'content',content_digest=revision->>'contentDigest' where id=revision->>'id';
  end loop;
  for release in select value from jsonb_array_elements(p_plan->'releases') loop
    update parameter_catalog.catalog_releases set release_digest=release->>'newDigest',compiled_model_digest=release->>'compiledModelDigest',toolchain_digest=release->>'toolchainDigest' where id=release->>'id';
    update parameter_catalog.catalog_materializations set compiled_fingerprint=release->>'materializationFingerprint',database_fingerprint=release->>'materializationFingerprint' where release_id=release->>'id';
    update parameter_catalog.catalog_activation_receipts set release_digest=release->>'newDigest' where release_id=release->>'id';
    update parameter_catalog.catalog_activation_receipts set predecessor_release_digest=release->>'newDigest' where predecessor_release_id=release->>'id';
    update catalog_publication.candidates set expected_base_release_digest=release->>'newDigest' where expected_base_release_id=release->>'id';
    update catalog_publication.publication_authorizations set expected_base_release_digest=release->>'newDigest' where expected_base_release_id=release->>'id';
  end loop;
  for artifact in select value from jsonb_array_elements(p_plan->'artifacts') loop
    if coalesce((artifact->>'create')::boolean,false) then
      insert into catalog_publication.release_artifacts(id,artifact_digest,bytes_checksum,artifact_bytes,source_kind,target_release_id,target_release_digest,predecessor_release_id,predecessor_release_digest,toolchain)
      values(artifact->>'id',artifact->>'newDigest',artifact->>'bytesChecksum',decode(artifact->>'artifactBytesBase64','base64'),'repository-bundle',artifact->>'targetReleaseId',
        (select r.release_digest from parameter_catalog.catalog_releases r where r.id=artifact->>'targetReleaseId'),artifact->>'predecessorReleaseId',artifact->>'predecessorReleaseDigest',artifact->'toolchain');
    else
      update catalog_publication.release_artifacts set artifact_digest=artifact->>'newDigest',bytes_checksum=artifact->>'bytesChecksum',artifact_bytes=decode(artifact->>'artifactBytesBase64','base64'),
        target_release_digest=(select r.release_digest from parameter_catalog.catalog_releases r where r.id=artifact->>'targetReleaseId'),
        predecessor_release_id=artifact->>'predecessorReleaseId',predecessor_release_digest=artifact->>'predecessorReleaseDigest' where id=artifact->>'id';
    end if;
    update catalog_publication.candidates set artifact_digest=artifact->>'newDigest' where artifact_id=artifact->>'id';
    update catalog_publication.publication_authorizations a set artifact_digest=artifact->>'newDigest'
      where a.candidate_id in(select c.id from catalog_publication.candidates c where c.artifact_id=artifact->>'id');
  end loop;
  -- Original approvals never authorize the rebuilt bytes. Cancel outstanding
  -- jobs and append an explicit revocation while keeping completed history.
  update catalog_publication.publication_jobs set status='cancelled',lease_owner=null,lease_until=null,
    last_error_class='definition-erasure',last_error_reason='Catalog bytes were rebuilt after a permanent Definition erasure',updated_at=clock_timestamp()
    where status<>'active' and candidate_id in(select c.id from catalog_publication.candidates c join jsonb_array_elements(p_plan->'artifacts') a on c.artifact_id=a->>'id' where a->>'oldDigest' is distinct from a->>'newDigest');
  insert into catalog_publication.publication_authorizations(id,event_kind,candidate_id,artifact_digest,expected_base_release_id,expected_base_release_digest,
    proposal_revision_id,impact_report_digest,capability_contract_digest,policy_revision,actor_principal_id,approved_authorization_id)
  select 'cauth_erasure_'||md5(p_audit_id||a.id),'revoke',a.candidate_id,a.artifact_digest,a.expected_base_release_id,a.expected_base_release_digest,
    a.proposal_revision_id,a.impact_report_digest,a.capability_contract_digest,a.policy_revision,p_actor,a.id
  from catalog_publication.publication_authorizations a where a.event_kind='approve'
    and a.candidate_id in(select c.id from catalog_publication.candidates c join jsonb_array_elements(p_plan->'artifacts') item on c.artifact_id=item->>'id' where item->>'oldDigest' is distinct from item->>'newDigest')
    and not exists(select 1 from catalog_publication.publication_authorizations revoked where revoked.event_kind='revoke' and revoked.approved_authorization_id=a.id);
  insert into parameter_catalog.definition_erasures(definition_id,erased_by,audit_event_id,counts,pending_object_refs,catalog_rewrite)
    values(p_id,p_actor,p_audit_id,counts,pending_refs,jsonb_build_object('releases',p_plan->'releases','artifacts',(
      select coalesce(jsonb_agg(item-'artifactBytesBase64'-'toolchain'),'[]') from jsonb_array_elements(p_plan->'artifacts') item),
      'revisions',(select coalesce(jsonb_agg(item-'content'),'[]') from jsonb_array_elements(p_plan->'revisions') item)));
  return jsonb_build_object('erased',true,'counts',counts,'pendingObjectRefs',to_jsonb(pending_refs));
end;
$$;

create function parameter_catalog.read_parameter_definition_erasure(p_id text)
returns jsonb language sql stable security definer set search_path=pg_catalog,parameter_catalog as $$
  select jsonb_build_object('definition_id',definition_id,'counts',counts,'pending_object_refs',to_jsonb(pending_object_refs),
    'erased_at',erased_at,'erased_by',erased_by,'audit_event_id',audit_event_id)
  from parameter_catalog.definition_erasures where definition_id=p_id;
$$;

create function parameter_catalog.finish_parameter_definition_erasure_object(p_id text,p_ref text)
returns void language sql security definer set search_path=pg_catalog,parameter_catalog as $$
  update parameter_catalog.definition_erasures set pending_object_refs=array_remove(pending_object_refs,p_ref)
  where definition_id=p_id and p_ref=any(pending_object_refs);
$$;

grant select,insert,update,delete on all tables in schema public,parameter_catalog,catalog_publication to catalog_migration_owner;
do $$
declare routine record;
begin
  for routine in select p.oid::regprocedure name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='parameter_catalog' and (p.proname like 'definition_purge_%' or p.proname in ('preview_parameter_definition_purge','lock_parameter_definition_purge','purge_parameter_definition','reject_erased_parameter_definition','read_parameter_definition_erasure','finish_parameter_definition_erasure_object'))
  loop
    execute format('alter function %s owner to catalog_migration_owner',routine.name);
    execute format('revoke all on function %s from public',routine.name);
  end loop;
end;
$$;
-- Trigger wrappers may run as ordinary table owners; this boolean capability
-- query reveals no values and is false outside the marked transaction.
grant execute on function parameter_catalog.definition_purge_allows_change(text,text,jsonb,text) to public;
grant execute on function parameter_catalog.preview_parameter_definition_purge(text),
  parameter_catalog.lock_parameter_definition_purge(text),
  parameter_catalog.purge_parameter_definition(text,jsonb,text,text),
  parameter_catalog.read_parameter_definition_erasure(text),
  parameter_catalog.finish_parameter_definition_erasure_object(text,text) to parameter_governance_writer_role;
grant select on parameter_catalog.definition_erasures to catalog_baseline_reader_role;
