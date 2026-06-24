create index if not exists agent_sessions_xiaoze_actor_idx
  on agent_sessions (organization_id, actor_user_id, page_key, status, updated_at desc)
  where page_key = 'xiaoze';
