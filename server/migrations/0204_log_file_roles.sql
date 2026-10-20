-- NULL applicability marks records that have not yet been assigned by a worker.
alter table log_files
  add column role text check (role is null or (char_length(role) <= 40 and role !~ '[[:cntrl:]]')),
  add column skill_matched boolean;
