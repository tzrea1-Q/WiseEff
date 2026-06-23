alter table debugging_parameters
  add column if not exists value_kind text not null default 'scalar';

alter table debugging_parameters
  add column if not exists value_format text not null default 'raw';

alter table debugging_parameters
  add column if not exists normalization_mode text not null default 'trim';

alter table debugging_parameters
  add column if not exists max_value_bytes integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'debugging_parameters_value_kind_check'
  ) then
    alter table debugging_parameters
      add constraint debugging_parameters_value_kind_check
      check (value_kind in ('scalar', 'complex'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'debugging_parameters_value_format_check'
  ) then
    alter table debugging_parameters
      add constraint debugging_parameters_value_format_check
      check (value_format in ('raw', 'json', 'dts', 'line-list', 'kv-list'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'debugging_parameters_normalization_mode_check'
  ) then
    alter table debugging_parameters
      add constraint debugging_parameters_normalization_mode_check
      check (normalization_mode in ('exact', 'trim', 'line-ending-normalized', 'json-canonical'));
  end if;
end;
$$;

alter table node_operations
  add column if not exists value_kind text;

alter table node_operations
  add column if not exists value_format text;

alter table node_operations
  add column if not exists normalization_mode text;

alter table node_operations
  add column if not exists requested_value_digest text;

alter table node_operations
  add column if not exists previous_value_digest text;

alter table node_operations
  add column if not exists readback_value_digest text;

alter table node_operations
  add column if not exists value_preview text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'node_operations_value_kind_check'
  ) then
    alter table node_operations
      add constraint node_operations_value_kind_check
      check (value_kind is null or value_kind in ('scalar', 'complex'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'node_operations_value_format_check'
  ) then
    alter table node_operations
      add constraint node_operations_value_format_check
      check (value_format is null or value_format in ('raw', 'json', 'dts', 'line-list', 'kv-list'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'node_operations_normalization_mode_check'
  ) then
    alter table node_operations
      add constraint node_operations_normalization_mode_check
      check (
        normalization_mode is null
        or normalization_mode in ('exact', 'trim', 'line-ending-normalized', 'json-canonical')
      );
  end if;
end;
$$;
