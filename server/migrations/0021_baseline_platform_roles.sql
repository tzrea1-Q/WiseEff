-- Baseline platform roles and local-registration organizations required before
-- local account registration or admin bootstrap on a fresh deployment.

insert into organizations (id, name)
values
  ('org-hardware-department', '硬件部'),
  ('org-software-department', '软件部')
on conflict (id) do update set name = excluded.name;

insert into roles (id, name, level, permissions) values
  ('guest', 'Guest', 'guest', array['parameter:view','logs:view']),
  ('hardware-user', 'Hardware User', 'user', array['parameter:view','parameter:edit','debugging:use','debugging:view','debugging:read','logs:view','logs:upload','logs:feedback']),
  ('software-user', 'Software User', 'user', array['parameter:view','parameter:edit','debugging:use','debugging:view','debugging:read','logs:view','logs:upload','logs:feedback']),
  ('hardware-committer', 'Hardware Committer', 'committer', array['parameter:view','parameter:edit','debugging:use','debugging:view','debugging:read','debugging:write','debugging:rollback','logs:view','logs:upload','logs:feedback','parameter:review']),
  ('software-committer', 'Software Committer', 'committer', array['parameter:view','parameter:edit','debugging:use','debugging:view','debugging:read','debugging:write','debugging:rollback','logs:view','logs:upload','logs:feedback','parameter:review']),
  ('admin', 'Admin', 'admin', array['parameter:view','parameter:edit','debugging:use','debugging:view','debugging:read','debugging:write','debugging:rollback','debugging:admin','logs:view','logs:upload','logs:feedback','logs:analyze','logs:archive','parameter:review','admin:access','users:manage'])
on conflict (id) do update set
  name = excluded.name,
  level = excluded.level,
  permissions = excluded.permissions;
