# Supabase backend

Kerbside has a Supabase backend deployed to the existing EU West project. The current GitHub Pages and JSON workflow remain active while the database is configured and populated.

## Deployed resources

- Seven PostgreSQL tables with foreign keys, checks, unique constraints, and indexes.
- Row Level Security on every public table.
- Private authorization helper functions.
- An authenticated household-creation RPC.
- A deployed `sync-collections` Edge Function.
- Zero findings from the Supabase security advisor after hardening.

The database is currently empty. No private address, postcode, UPRN, email address, or API key was inserted during deployment.

## Tables

| Table | Purpose |
|---|---|
| `households` | Top-level tenant and timezone |
| `household_members` | User membership and owner/member role |
| `properties` | Private address, postcode, UPRN and council configuration |
| `collections` | Normalized future collection dates |
| `reminder_preferences` | Recipient, lead time and preferred send time |
| `notification_deliveries` | Idempotent email delivery and failure history |
| `sync_runs` | Operational history for each property refresh |

## Security model

The browser uses Supabase Auth. RLS policies allow authenticated users to read records only for households they belong to.

- Household owners can manage properties and members.
- Members can read their household and collections.
- Users can manage only their own reminder preferences.
- Collection, delivery, and sync writes are server-only.
- Anonymous users have no table access.
- The service-role key is used only inside the Edge Function.

The Edge Function has platform JWT verification disabled because database Cron cannot provide a user JWT. It instead requires an `x-sync-secret` header and returns HTTP 401 when the header is missing or incorrect.

## Required Edge Function secrets

Configure these in **Supabase Dashboard → Edge Functions → Secrets**:

| Secret | Purpose |
|---|---|
| `SYNC_SECRET` | Long random value authenticating Cron requests |
| `RESEND_API_KEY` | Resend delivery API key |
| `EMAIL_FROM` | Verified Resend sender address |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied automatically by Supabase.

Generate `SYNC_SECRET` with a password manager or cryptographically secure random generator. Do not reuse a password and do not commit the value.

## Initial setup

1. Create the first user in **Authentication → Users**.
2. Copy the user UUID.
3. Copy `supabase/seed.example.sql` to a temporary private file.
4. Replace the placeholders with a newly generated household UUID, the Auth user UUID, and private property/reminder values.
5. Run the completed SQL in the Supabase SQL editor.
6. Delete the completed temporary file.
7. Configure the Edge Function secrets.
8. Invoke the function manually and confirm a successful `sync_runs` record.
9. Configure database Cron from `supabase/cron.example.sql`.

Never edit the example files to contain real private values.

## Edge Function behavior

`sync-collections`:

1. authenticates the request using `SYNC_SECRET`;
2. loads every enabled property using the server-only service role;
3. retrieves UK Bin Day data;
4. applies the Erewash BST correction;
5. validates, deduplicates and upserts collection dates;
6. evaluates reminder preferences;
7. creates an idempotent pending delivery record;
8. sends email through Resend;
9. records success or failure;
10. writes a `sync_runs` audit record.

The unique delivery constraint prevents a scheduled reminder being sent twice for the same household, property, recipient and collection date.

## Manual invocation

After configuring and seeding the project:

```bash
curl -X POST \
  "https://liicfwhbrgcuugvlfnof.supabase.co/functions/v1/sync-collections" \
  -H "Content-Type: application/json" \
  -H "x-sync-secret: YOUR_PRIVATE_SYNC_SECRET" \
  -d '{"send_test_email": false}'
```

To test email delivery, set `send_test_email` to `true`. Resend’s testing sender can deliver only to the email associated with the Resend account until a domain is verified.

## Migrations

Migrations are stored in `supabase/migrations` and have already been applied to the connected project:

1. Initial relational schema and RLS.
2. Private helper functions, optimized policies, and missing indexes.
3. Hardened household-creation RPC.

New database changes should always be added as a new migration rather than editing an already-applied migration.

## Cutover plan

The existing JSON workflow remains the production source. Recommended next steps:

1. Seed and test Supabase.
2. Add login to the frontend.
3. Read collections through the authenticated Supabase client.
4. Run JSON and Supabase synchronization in parallel temporarily.
5. Compare schedules and reminder delivery.
6. Disable the GitHub sync only after Supabase is proven.

