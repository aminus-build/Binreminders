create or replace function private.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_household_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  insert into public.households (name)
  values (household_name)
  returning id into new_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (new_household_id, (select auth.uid()), 'owner');

  return new_household_id;
end;
$$;

revoke all on function private.create_household(text) from public;
grant execute on function private.create_household(text) to authenticated;

create or replace function public.create_household(household_name text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_household(household_name);
$$;

revoke all on function public.create_household(text) from public;
revoke execute on function public.create_household(text) from anon;
grant execute on function public.create_household(text) to authenticated;

