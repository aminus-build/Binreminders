-- Run only after SYNC_SECRET is configured on the Edge Function.
-- Replace the placeholder with the same random secret, execute this once,
-- and do not commit a completed copy.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

select vault.create_secret(
  '<SYNC_SECRET>',
  'kerbside_sync_secret',
  'Authenticates the scheduled Kerbside sync'
);

select cron.schedule(
  'kerbside-daily-sync',
  '15 17 * * *',
  $$
  select net.http_post(
    url := 'https://liicfwhbrgcuugvlfnof.supabase.co/functions/v1/sync-collections',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'kerbside_sync_secret'
      )
    ),
    body := '{"send_test_email": false}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

