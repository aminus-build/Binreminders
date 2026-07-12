-- Replace every value wrapped in angle brackets before running this file.
-- Do not commit a completed copy containing private property or email data.

begin;

insert into public.households (id, name)
values ('<HOUSEHOLD_UUID>', 'Home');

insert into public.household_members (household_id, user_id, role)
values ('<HOUSEHOLD_UUID>', '<AUTH_USER_UUID>', 'owner');

insert into public.properties (
  household_id,
  label,
  address,
  postcode,
  uprn,
  council_id
)
values (
  '<HOUSEHOLD_UUID>',
  'Home',
  '<PRIVATE_ADDRESS>',
  '<PRIVATE_POSTCODE>',
  '<PRIVATE_UPRN>',
  'hacs_erewash_gov_uk'
);

insert into public.reminder_preferences (
  household_id,
  user_id,
  recipient_email,
  lead_days,
  send_time
)
values (
  '<HOUSEHOLD_UUID>',
  '<AUTH_USER_UUID>',
  '<RECIPIENT_EMAIL>',
  1,
  '18:00'
);

commit;

