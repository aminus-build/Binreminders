create extension if not exists pgcrypto;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  timezone text not null default 'Europe/London',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  label text not null default 'Home',
  address text not null,
  postcode text not null,
  uprn text not null unique,
  council_id text not null default 'hacs_erewash_gov_uk',
  enabled boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collections (
  id bigint generated always as identity primary key,
  property_id uuid not null references public.properties(id) on delete cascade,
  collection_date date not null,
  collection_type text not null check (
    collection_type in ('black', 'blue', 'brown', 'green')
  ),
  source_type text not null,
  source_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (property_id, collection_date, collection_type)
);

create table public.reminder_preferences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  lead_days smallint not null default 1 check (lead_days between 0 and 14),
  send_time time not null default '18:00',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, user_id, recipient_email)
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  recipient_email text not null,
  collection_date date not null,
  collection_types text[] not null,
  reminder_kind text not null default 'scheduled' check (
    reminder_kind in ('scheduled', 'test')
  ),
  status text not null check (status in ('pending', 'sent', 'failed')),
  provider_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (
    household_id,
    property_id,
    recipient_email,
    collection_date,
    reminder_kind
  )
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (
    status in ('running', 'succeeded', 'failed')
  ),
  records_received integer not null default 0,
  error_message text
);

create index collections_property_date_idx
  on public.collections (property_id, collection_date);
create index properties_household_idx
  on public.properties (household_id);
create index reminder_preferences_household_idx
  on public.reminder_preferences (household_id)
  where enabled;
create index notification_deliveries_household_date_idx
  on public.notification_deliveries (household_id, collection_date);
create index sync_runs_property_started_idx
  on public.sync_runs (property_id, started_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger households_set_updated_at
before update on public.households
for each row execute function public.set_updated_at();
create trigger properties_set_updated_at
before update on public.properties
for each row execute function public.set_updated_at();
create trigger reminder_preferences_set_updated_at
before update on public.reminder_preferences
for each row execute function public.set_updated_at();

create or replace function public.is_household_member(target_household_id uuid)
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

create or replace function public.is_household_owner(target_household_id uuid)
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

create or replace function public.create_household(household_name text)
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

revoke all on function public.create_household(text) from public;
grant execute on function public.create_household(text) to authenticated;
revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;
revoke all on function public.is_household_owner(uuid) from public;
grant execute on function public.is_household_owner(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.properties enable row level security;
alter table public.collections enable row level security;
alter table public.reminder_preferences enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.sync_runs enable row level security;

create policy households_select_members
on public.households for select to authenticated
using (public.is_household_member(id));

create policy households_update_owners
on public.households for update to authenticated
using (public.is_household_owner(id))
with check (public.is_household_owner(id));

create policy household_members_select_members
on public.household_members for select to authenticated
using (public.is_household_member(household_id));

create policy household_members_manage_owners
on public.household_members for all to authenticated
using (public.is_household_owner(household_id))
with check (public.is_household_owner(household_id));

create policy properties_select_members
on public.properties for select to authenticated
using (public.is_household_member(household_id));

create policy properties_manage_owners
on public.properties for all to authenticated
using (public.is_household_owner(household_id))
with check (public.is_household_owner(household_id));

create policy collections_select_members
on public.collections for select to authenticated
using (
  exists (
    select 1 from public.properties
    where properties.id = collections.property_id
      and public.is_household_member(properties.household_id)
  )
);

create policy reminder_preferences_select_members
on public.reminder_preferences for select to authenticated
using (public.is_household_member(household_id));

create policy reminder_preferences_manage_self
on public.reminder_preferences for all to authenticated
using (
  user_id = (select auth.uid())
  and public.is_household_member(household_id)
)
with check (
  user_id = (select auth.uid())
  and public.is_household_member(household_id)
);

create policy notification_deliveries_select_members
on public.notification_deliveries for select to authenticated
using (public.is_household_member(household_id));

create policy sync_runs_select_members
on public.sync_runs for select to authenticated
using (
  property_id is not null
  and exists (
    select 1 from public.properties
    where properties.id = sync_runs.property_id
      and public.is_household_member(properties.household_id)
  )
);

grant usage on schema public to authenticated;
grant select, update on public.households to authenticated;
grant select, insert, update, delete on public.household_members to authenticated;
grant select, insert, update, delete on public.properties to authenticated;
grant select on public.collections to authenticated;
grant select, insert, update, delete on public.reminder_preferences to authenticated;
grant select on public.notification_deliveries to authenticated;
grant select on public.sync_runs to authenticated;
grant usage, select on all sequences in schema public to authenticated;

