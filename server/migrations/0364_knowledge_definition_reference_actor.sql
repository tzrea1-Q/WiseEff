-- The entry is scoped by its composite foreign key. The historical creator can
-- be a platform administrator whose account belongs to another organization.
alter table knowledge_definition_references
  drop constraint knowledge_definition_referenc_created_by_user_id_organizat_fkey,
  add constraint knowledge_definition_references_created_by_user_id_fkey
    foreign key (created_by_user_id) references users (id) on delete set null;
