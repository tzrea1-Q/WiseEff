alter table parameter_definitions
  add column if not exists value_kind text not null default 'scalar';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'parameter_definitions_value_kind_check'
  ) then
    alter table parameter_definitions
      add constraint parameter_definitions_value_kind_check
      check (value_kind in ('scalar', 'complex'));
  end if;
end $$;

update parameter_definitions
set value_kind = 'complex'
where value_kind = 'scalar'
  and (
    config_format ilike 'DTS:%'
    or config_format ilike '%string-list%'
  );
