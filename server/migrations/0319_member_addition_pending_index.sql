create index member_addition_intent_pending_list_idx
  on public.member_addition_intents (organization_id, actor_user_id, created_at desc, id)
  where not acknowledged and actor_user_id is not null;
