-- pg_net is not relocatable, so recreate it to change its owning schema.
-- Its runtime objects remain in the net schema; existing net.http_* calls
-- and pg_cron command text therefore continue to work unchanged.
create schema if not exists extensions;

do $migration$
declare
  current_schema text;
begin
  select n.nspname
    into current_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_net';

  if current_schema = 'public' then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  elsif current_schema is null then
    create extension pg_net with schema extensions;
  end if;
end
$migration$;
