-- Permanent user deletion keeps durable business/audit rows while removing
-- account-owned security and transient state. Every foreign key to users(id)
-- must have one explicit deletion policy so new user references cannot silently
-- reintroduce a hard-delete blocker.

do $$
declare
  reference_row record;
  reference_key text;
  expected_delete_action "char";
begin
  if exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'users'::regclass
      and (
        array_length(constraint_row.conkey, 1) <> 1
        or array_length(constraint_row.confkey, 1) <> 1
        or (
          select referenced_attribute.attname
          from pg_attribute referenced_attribute
          where referenced_attribute.attrelid = constraint_row.confrelid
            and referenced_attribute.attnum = constraint_row.confkey[1]
        ) <> 'id'
      )
  ) then
    raise exception 'user account deletion migration only supports single-column foreign keys to users(id)';
  end if;

  for reference_row in
    select
      child_namespace.nspname as schema_name,
      child.relname as table_name,
      constraint_row.conname as constraint_name,
      child_attribute.attname as column_name,
      child_attribute.attnotnull as column_not_null,
      constraint_row.confdeltype as delete_action
    from pg_constraint constraint_row
    join pg_class child on child.oid = constraint_row.conrelid
    join pg_namespace child_namespace on child_namespace.oid = child.relnamespace
    join pg_attribute child_attribute
      on child_attribute.attrelid = constraint_row.conrelid
     and child_attribute.attnum = constraint_row.conkey[1]
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'users'::regclass
    order by child_namespace.nspname, child.relname, constraint_row.conname
  loop
    reference_key := reference_row.table_name || '.' || reference_row.column_name;
    expected_delete_action := case
      when reference_key = any (array[
        'auth_sessions.user_id',
        'debug_device_leases.lease_owner_user_id',
        'local_registration_role_requests.user_id',
        'parameter_drafts.user_id',
        'user_notifications.recipient_user_id',
        'user_password_credentials.user_id',
        'user_role_bindings.user_id'
      ]) then 'c'::"char"
      else 'n'::"char"
    end;

    if expected_delete_action = 'n'::"char" and reference_row.column_not_null then
      execute format(
        'alter table %I.%I alter column %I drop not null',
        reference_row.schema_name,
        reference_row.table_name,
        reference_row.column_name
      );
    end if;

    if reference_row.delete_action <> expected_delete_action then
      execute format(
        'alter table %I.%I drop constraint %I',
        reference_row.schema_name,
        reference_row.table_name,
        reference_row.constraint_name
      );
      execute format(
        'alter table %I.%I add constraint %I foreign key (%I) references public.users(id) on delete %s not valid',
        reference_row.schema_name,
        reference_row.table_name,
        reference_row.constraint_name,
        reference_row.column_name,
        case expected_delete_action when 'c'::"char" then 'cascade' else 'set null' end
      );
      execute format(
        'alter table %I.%I validate constraint %I',
        reference_row.schema_name,
        reference_row.table_name,
        reference_row.constraint_name
      );
    end if;
  end loop;
end $$;
