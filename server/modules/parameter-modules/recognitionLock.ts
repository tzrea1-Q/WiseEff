import type { Queryable } from "../../shared/database/client";

export async function lockOrganizationModuleRecognition(db: Queryable, organizationId: string) {
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`parameter-module-recognition:${organizationId}`]);
}

export async function lockOrganizationSubjectRegistration(db: Queryable, organizationId: string) {
  await db.query(`do $$
    declare previous_timeout text := pg_catalog.current_setting('lock_timeout');
    begin
      perform pg_catalog.set_config('lock_timeout', '2s', true);
      begin
        perform pg_catalog.pg_advisory_xact_lock_shared(688004000041::bigint);
      exception when lock_not_available then
        perform pg_catalog.set_config('lock_timeout', previous_timeout, true);
        raise exception using errcode='PCA05', message='catalog current-pointer serialization timed out', detail='PCAT-GUARD-SYNCHRONIZATION-BUSY';
      end;
      perform pg_catalog.set_config('lock_timeout', previous_timeout, true);
    end $$`);
  // ponytail: registration writes serialize per organization; partition by subject if throughput warrants it.
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`subject-registration:${organizationId}`]);
}
