alter table product_feedback
  add column priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high')),
  add column assignee_user_id text references users(id) on delete set null;
