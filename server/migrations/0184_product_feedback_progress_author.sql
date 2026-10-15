alter table product_feedback_progress_events
  add column author text not null default 'team' check (author in ('submitter', 'team'));

update product_feedback_progress_events set author = 'submitter' where kind = 'submitted';
