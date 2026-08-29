-- Forward-only repair for databases that already applied 0131 before the
-- cutover ownership index cleanup.  The user-only enablement index conflates
-- User/Agent drafts with the same accountable principal.

drop index if exists parameter_drafts_enablement_user_unique;
