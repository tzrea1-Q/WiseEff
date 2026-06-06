create unique index if not exists users_organization_email_unique_idx
  on users (organization_id, lower(email));

create index if not exists user_role_bindings_user_scope_role_idx
  on user_role_bindings (user_id, organization_id, coalesce(project_id, '__global__'), role_id);

create index if not exists user_role_bindings_organization_role_idx
  on user_role_bindings (organization_id, role_id);
