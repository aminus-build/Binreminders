import { createClient } from 'npm:@supabase/supabase-js@2';

type Collection = {
  date: string;
  type: string;
};

type Property = {
  id: string;
  household_id: string;
  address: string;
  postcode: string;
  uprn: string;
  council_id: string;
};

const serviceTypes = new Map<string, string>([
  ['Domestic Waste Collection Service', 'black'],
  ['Recycling Collection Service', 'blue'],
  ['Garden Waste Collection Service', 'brown'],
  ['Food Collection Service', 'green'],
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function correctErewashDate(date: string) {
  const followingDay = new Date(date + 'T12:00:00Z');
  followingDay.setUTCDate(followingDay.getUTCDate() + 1);
  const londonOffset = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(followingDay)
    .find((part) => part.type === 'timeZoneName')?.value;

  return londonOffset === 'GMT+1'
    ? followingDay.toISOString().slice(0, 10)
    : date;
}

function londonDatePlusDays(days: number) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const date = new Date(today + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fetchCollections(property: Property) {
  const url = new URL(
    'https://ukbinday.co.uk/api/v1/lookup/' + property.uprn,
  );
  url.searchParams.set('council', property.council_id);
  url.searchParams.set('postcode', property.postcode);
  url.searchParams.set('address', property.address);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(
      'UK Bin Day HTTP ' + response.status + ': ' + (await response.text()),
    );
  }

  const result = await response.json();
  if (result.uprn !== property.uprn || result.council !== property.council_id) {
    throw new Error('UK Bin Day returned an unexpected property or council.');
  }
  if (!Array.isArray(result.collections) || !result.collections.length) {
    throw new Error('UK Bin Day returned no collection dates.');
  }

  const normalized = new Map<string, Collection>();
  for (const item of result.collections) {
    const type = serviceTypes.get(item.type);
    if (!type) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      throw new Error('UK Bin Day returned an invalid date.');
    }
    const date =
      property.council_id === 'hacs_erewash_gov_uk'
        ? correctErewashDate(item.date)
        : item.date;
    normalized.set(type + '-' + date, {
      type,
      date,
    });
  }
  if (!normalized.size) {
    throw new Error('UK Bin Day returned no supported collections.');
  }
  return [...normalized.values()];
}

async function sendDueReminders(
  supabase: ReturnType<typeof createClient>,
  property: Property,
  sendTest: boolean,
) {
  const { data: preferences, error: preferenceError } = await supabase
    .from('reminder_preferences')
    .select('id, recipient_email, lead_days')
    .eq('household_id', property.household_id)
    .eq('enabled', true);
  if (preferenceError) throw preferenceError;

  for (const preference of preferences ?? []) {
    const targetDate = londonDatePlusDays(sendTest ? 0 : preference.lead_days);
    const { data: due, error: dueError } = await supabase
      .from('collections')
      .select('collection_type')
      .eq('property_id', property.id)
      .eq('collection_date', targetDate);
    if (dueError) throw dueError;
    if (!sendTest && !due?.length) continue;

    const collectionTypes = sendTest
      ? ['test']
      : due.map((item) => item.collection_type);
    const reminderKind = sendTest ? 'test' : 'scheduled';
    const { data: delivery, error: deliveryError } = await supabase
      .from('notification_deliveries')
      .upsert(
        {
          household_id: property.household_id,
          property_id: property.id,
          recipient_email: preference.recipient_email,
          collection_date: targetDate,
          collection_types: collectionTypes,
          reminder_kind: reminderKind,
          status: 'pending',
        },
        {
          onConflict:
            'household_id,property_id,recipient_email,collection_date,reminder_kind',
          ignoreDuplicates: true,
        },
      )
      .select('id')
      .maybeSingle();
    if (deliveryError) throw deliveryError;
    if (!delivery) continue;

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) throw new Error('RESEND_API_KEY is not configured.');
    const names = sendTest
      ? 'test reminder'
      : collectionTypes.map((type) => type + ' bin').join(' and ');

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + resendKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:
            Deno.env.get('EMAIL_FROM') ??
            'Kerbside <onboarding@resend.dev>',
          to: [preference.recipient_email],
          subject: sendTest
            ? 'Kerbside test email'
            : 'Bin reminder: ' + names + ' tomorrow',
          html: sendTest
            ? '<h1>Kerbside email is working</h1><p>This is a test reminder.</p>'
            : '<h1>Put out your ' +
              names +
              '</h1><p>Collection is tomorrow. Please have bins ready by 7am.</p>',
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      await supabase
        .from('notification_deliveries')
        .update({
          status: 'sent',
          provider_id: result.id,
          sent_at: new Date().toISOString(),
        })
        .eq('id', delivery.id);
    } catch (error) {
      await supabase
        .from('notification_deliveries')
        .update({
          status: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq('id', delivery.id);
      throw error;
    }
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const expectedSecret = Deno.env.get('SYNC_SECRET');
  if (
    !expectedSecret ||
    request.headers.get('x-sync-secret') !== expectedSecret
  ) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Supabase server configuration is missing' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const body = await request.json().catch(() => ({}));
  const sendTest = body.send_test_email === true;
  const { data: properties, error: propertyError } = await supabase
    .from('properties')
    .select('id, household_id, address, postcode, uprn, council_id')
    .eq('enabled', true);
  if (propertyError) return json({ error: propertyError.message }, 500);

  const results = [];
  for (const property of (properties ?? []) as Property[]) {
    const { data: syncRun, error: syncRunError } = await supabase
      .from('sync_runs')
      .insert({ property_id: property.id })
      .select('id')
      .single();
    if (syncRunError) return json({ error: syncRunError.message }, 500);

    try {
      const collections = await fetchCollections(property);
      const rows = collections.map((collection) => ({
        property_id: property.id,
        collection_date: collection.date,
        collection_type: collection.type,
        source_type: 'uk_bin_day',
        source_updated_at: new Date().toISOString(),
      }));
      const { error: upsertError } = await supabase
        .from('collections')
        .upsert(rows, {
          onConflict: 'property_id,collection_date,collection_type',
        });
      if (upsertError) throw upsertError;

      await supabase
        .from('properties')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', property.id);
      await sendDueReminders(supabase, property, sendTest);
      await supabase
        .from('sync_runs')
        .update({
          status: 'succeeded',
          records_received: collections.length,
          finished_at: new Date().toISOString(),
        })
        .eq('id', syncRun.id);
      results.push({ property_id: property.id, collections: collections.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabase
        .from('sync_runs')
        .update({
          status: 'failed',
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq('id', syncRun.id);
      results.push({ property_id: property.id, error: message });
    }
  }

  const failed = results.some((result) => 'error' in result);
  return json({ results }, failed ? 500 : 200);
});

