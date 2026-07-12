create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household_id
      and user_id = (select auth.uid())
  );
$$;

create or replace function private.is_household_owner(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members
    where household_id = target_household_id
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

revoke all on function private.is_household_member(uuid) from public;
revoke all on function private.is_household_owner(uuid) from public;
grant execute on function private.is_household_member(uuid) to authenticated;
grant execute on function private.is_household_owner(uuid) to authenticated;

drop policy if exists households_select_members on public.households;
drop policy if exists households_update_owners on public.households;
drop policy if exists household_members_select_members on public.household_members;
drop policy if exists household_members_manage_owners on public.household_members;
drop policy if exists properties_select_members on public.properties;
drop policy if exists properties_manage_owners on public.properties;
drop policy if exists collections_select_members on public.collections;
drop policy if exists reminder_preferences_select_members on public.reminder_preferences;
drop policy if exists reminder_preferences_manage_self on public.reminder_preferences;
drop policy if exists notification_deliveries_select_members
  on public.notification_deliveries;
drop policy if exists sync_runs_select_members on public.sync_runs;

create policy households_select_members
on public.households for select to authenticated
using (private.is_household_member(id));

create policy households_update_owners
on public.households for update to authenticated
using (private.is_household_owner(id))
with check (private.is_household_owner(id));

create policy household_members_select_members
on public.household_members for select to authenticated
using (private.is_household_member(household_id));

create policy household_members_insert_owners
on public.household_members for insert to authenticated
with check (private.is_household_owner(household_id));

create policy household_members_update_owners
on public.household_members for update to authenticated
using (private.is_household_owner(household_id))
with check (private.is_household_owner(household_id));

create policy household_members_delete_owners
on public.household_members for delete to authenticated
using (private.is_household_owner(household_id));

create policy properties_select_members
on public.properties for select to authenticated
using (private.is_household_member(household_id));

create policy properties_insert_owners
on public.properties for insert to authenticated
with check (private.is_household_owner(household_id));

create policy properties_update_owners
on public.properties for update to authenticated
using (private.is_household_owner(household_id))
with check (private.is_household_owner(household_id));

create policy properties_delete_owners
on public.properties for delete to authenticated
using (private.is_household_owner(household_id));

create policy collections_select_members
on public.collections for select to authenticated
using (
  exists (
    select 1 from public.properties
    where properties.id = collections.property_id
      and private.is_household_member(properties.household_id)
  )
);

create policy reminder_preferences_select_self
on public.reminder_preferences for select to authenticated
using (
  user_id = (select auth.uid())
  and private.is_household_member(household_id)
);

create policy reminder_preferences_insert_self
on public.reminder_preferences for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_household_member(household_id)
);

create policy reminder_preferences_update_self
on public.reminder_preferences for update to authenticated
using (
  user_id = (select auth.uid())
  and private.is_household_member(household_id)
)
with check (
  user_id = (select auth.uid())
  and private.is_household_member(household_id)
);

create policy reminder_preferences_delete_self
on public.reminder_preferences for delete to authenticated
using (
  user_id = (select auth.uid())
  and private.is_household_member(household_id)
);

create policy notification_deliveries_select_members
on public.notification_deliveries for select to authenticated
using (private.is_household_member(household_id));

create policy sync_runs_select_members
on public.sync_runs for select to authenticated
using (
  property_id is not null
  and exists (
    select 1 from public.properties
    where properties.id = sync_runs.property_id
      and private.is_household_member(properties.household_id)
  )
);

drop function if exists public.is_household_member(uuid);
drop function if exists public.is_household_owner(uuid);
revoke execute on function public.create_household(text) from anon;

create index if not exists household_members_user_idx
  on public.household_members (user_id);
create index if not exists notification_deliveries_property_idx
  on public.notification_deliveries (property_id);
create index if not exists reminder_preferences_user_idx
  on public.reminder_preferences (user_id);

