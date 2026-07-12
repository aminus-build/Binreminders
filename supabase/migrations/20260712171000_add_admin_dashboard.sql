create table private.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table private.app_admins enable row level security;
revoke all on table private.app_admins from public, anon, authenticated;

create policy app_admins_deny_direct_access
on private.app_admins for all to authenticated
using (false)
with check (false);

-- Bootstrap the earliest household owner as the initial application admin.
insert into private.app_admins (user_id)
select hm.user_id
from public.household_members hm
where hm.role = 'owner'
order by hm.created_at, hm.user_id
limit 1;

create or replace function private.get_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if not exists (
    select 1
    from private.app_admins
    where user_id = (select auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'households', (select count(*) from public.households),
      'users', (select count(*) from auth.users),
      'properties', (select count(*) from public.properties),
      'active_reminders', (
        select count(*) from public.reminder_preferences where enabled
      )
    ),
    'households', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id,
        'name', h.name,
        'timezone', h.timezone,
        'created_at', h.created_at,
        'member_count', (
          select count(*) from public.household_members hm
          where hm.household_id = h.id
        ),
        'property_count', (
          select count(*) from public.properties p
          where p.household_id = h.id
        ),
        'reminder_count', (
          select count(*) from public.reminder_preferences rp
          where rp.household_id = h.id and rp.enabled
        )
      ) order by h.created_at desc)
      from public.households h
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'confirmed', u.email_confirmed_at is not null,
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'is_admin', exists (
          select 1 from private.app_admins aa where aa.user_id = u.id
        ),
        'memberships', coalesce((
          select jsonb_agg(jsonb_build_object(
            'household_id', hm.household_id,
            'household_name', h.name,
            'role', hm.role
          ) order by h.name)
          from public.household_members hm
          join public.households h on h.id = hm.household_id
          where hm.user_id = u.id
        ), '[]'::jsonb)
      ) order by u.created_at desc)
      from auth.users u
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function private.get_admin_dashboard() from public;
grant execute on function private.get_admin_dashboard() to authenticated;

create or replace function public.get_admin_dashboard()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_admin_dashboard();
$$;

revoke all on function public.get_admin_dashboard() from public;
revoke execute on function public.get_admin_dashboard() from anon;
grant execute on function public.get_admin_dashboard() to authenticated;
