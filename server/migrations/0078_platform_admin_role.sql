insert into roles (id, name, level, permissions) values
  (
    'platform-admin',
    'Platform Super Admin',
    'admin',
    array[
      'parameter:view',
      'parameter:edit',
      'parameter:edit-critical',
      'debugging:use',
      'debugging:view',
      'debugging:read',
      'debugging:write',
      'debugging:rollback',
      'debugging:admin',
      'logs:view',
      'logs:upload',
      'logs:feedback',
      'logs:analyze',
      'logs:archive',
      'parameter:review',
      'admin:access',
      'users:manage',
      'platform:access',
      'platform:schema-promote'
    ]
  )
on conflict (id) do update set
  name = excluded.name,
  level = excluded.level,
  permissions = excluded.permissions;

alter table audit_events alter column organization_id drop not null;
