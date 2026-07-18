-- Persist typed edit intent through the formal submission/review/merge workflow.
-- Existing rows predate typed delete and are therefore explicit set operations.

alter table parameter_drafts
  add column if not exists action text not null default 'set';

alter table parameter_drafts
  drop constraint if exists parameter_drafts_action_check;

alter table parameter_drafts
  add constraint parameter_drafts_action_check
  check (action in ('set', 'delete'));

alter table parameter_submission_items
  add column if not exists action text not null default 'set';

alter table parameter_submission_items
  drop constraint if exists parameter_submission_items_action_check;

alter table parameter_submission_items
  add constraint parameter_submission_items_action_check
  check (action in ('set', 'delete'));

alter table parameter_change_requests
  add column if not exists action text not null default 'set';

alter table parameter_change_requests
  drop constraint if exists parameter_change_requests_action_check;

alter table parameter_change_requests
  add constraint parameter_change_requests_action_check
  check (action in ('set', 'delete'));
