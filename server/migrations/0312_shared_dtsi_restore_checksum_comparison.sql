-- Uploaded immutable versions retain their original bare SHA-256 checksum.
-- Compare that representation with published checksums without rewriting either.
do $$ declare installed text; changed text; begin
  select pg_get_functiondef('public.derive_shared_dtsi_switch_version(text,text,text,text)'::regprocedure) into strict installed;
  changed:=replace(installed,$old$upstream.checksum=member->>'checksum'$old$,
    $new$regexp_replace(upstream.checksum,'^sha256:','')=regexp_replace(member->>'checksum','^sha256:','')$new$);
  if changed=installed then raise exception 'Shared derivation checksum comparison marker unavailable'; end if;
  execute changed;
end $$;
