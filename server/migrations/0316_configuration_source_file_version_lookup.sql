-- Current logical-path reads are anchored to an exact immutable file/version,
-- including when unchanged members occur in many historical configurations.
create index dts_config_revision_members_file_version_idx
  on public.dts_config_revision_members (file_id, file_version_id);
